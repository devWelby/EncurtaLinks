import { mkdtempSync, readdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '../../src/server/domain/cleanup.ts';
import { insertLinkWithUniqueSlug } from '../../src/server/domain/links.ts';
import { runMigrations } from '../../src/server/db/migrate.ts';
import { handleInterstitial } from '../../src/server/handlers/interstitial.ts';
import { getAdminRuntime, getPublicRuntime, resetRuntimeCaches } from '../../src/server/runtime.ts';
import { checkRateLimits } from '../../src/server/security/rate-limit.ts';
import { baseEnv, closeTestDb, PUBLIC_ORIGIN, requestContext, resetDb, testDb } from '../helpers/harness.ts';

const db = testDb();
const MIGRATIONS = resolve(import.meta.dirname, '..', '..', 'db', 'migrations');

beforeEach(async () => {
  await resetDb(db);
  resetRuntimeCaches();
});
afterAll(async () => {
  resetRuntimeCaches();
  await closeTestDb();
});

function copyMigrations(): string {
  const dir = mkdtempSync(join(tmpdir(), 'encurtalinks-mig-'));
  for (const file of readdirSync(MIGRATIONS)) copyFileSync(join(MIGRATIONS, file), join(dir, file));
  return dir;
}

describe('migrações', () => {
  it('são idempotentes', async () => {
    const report = await runMigrations(db, MIGRATIONS);
    expect(report.applied).toEqual([]);
    expect(report.alreadyApplied).toEqual(['0001', '0002']);
  });

  it('detectam migração já aplicada que foi editada', async () => {
    const dir = copyMigrations();
    try {
      writeFileSync(join(dir, '0002_default_data.sql'), '-- editada\nSELECT 1;');
      await expect(runMigrations(db, dir)).rejects.toThrow(/alterada depois de aplicada/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migração com erro não aplica nada (tudo ou nada)', async () => {
    const dir = copyMigrations();
    try {
      writeFileSync(join(dir, '0003_ok.sql'), 'CREATE TABLE app.tabela_temporaria_teste (id int);');
      writeFileSync(join(dir, '0004_quebrada.sql'), 'ISTO NÃO É SQL;');
      await expect(runMigrations(db, dir)).rejects.toThrow();
      const { rows } = await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'tabela_temporaria_teste'");
      expect(rows).toHaveLength(0);
      const versions = await db.query<{ version: string }>('SELECT version FROM app.schema_migrations ORDER BY version');
      expect(versions.rows.map((r) => r.version)).toEqual(['0001', '0002']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('código anterior (rollback) roda contra banco mais novo sem falhar', async () => {
    await db.query("INSERT INTO app.schema_migrations (version, name, checksum) VALUES ('0099', 'futura', 'x')");
    try {
      const report = await runMigrations(db, MIGRATIONS);
      expect(report.unknownApplied).toEqual(['0099']);
      expect(report.applied).toEqual([]);
    } finally {
      await db.query("DELETE FROM app.schema_migrations WHERE version = '0099'");
    }
  });

  it('tabelas ficam no schema app com RLS ativo e sem acesso de PUBLIC', async () => {
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relkind = 'r'",
    );
    expect(rls.rows.length).toBeGreaterThanOrEqual(12);
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
    const grants = await db.query("SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'app' AND grantee = 'PUBLIC'");
    expect(grants.rows).toHaveLength(0);
  });
});

describe('limites distribuídos', () => {
  it('janela fixa com Retry-After coerente e regras independentes', async () => {
    const rules = [
      { name: 'teste:a', subject: 's1', limit: 2, windowSeconds: 60 },
      { name: 'teste:b', subject: 's1', limit: 100, windowSeconds: 3600 },
    ];
    expect((await checkRateLimits(db, rules)).allowed).toBe(true);
    expect((await checkRateLimits(db, rules)).allowed).toBe(true);
    const third = await checkRateLimits(db, rules);
    expect(third).toMatchObject({ allowed: false, rule: 'teste:a' });
    if (!third.allowed) {
      expect(third.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(third.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
    expect((await checkRateLimits(db, [{ name: 'teste:a', subject: 's2', limit: 2, windowSeconds: 60 }])).allowed).toBe(true);
  });
});

describe('retenção e limpeza', () => {
  it('remove dados vencidos e mantém o slug reservado', async () => {
    const hash = Buffer.alloc(32, 1);
    const old = await insertLinkWithUniqueSlug(db, { destinationUrl: 'https://example.com/velho', destinationHost: 'example.com', expiresInSeconds: 60, creatorIpHash: hash });
    const recent = await insertLinkWithUniqueSlug(db, { destinationUrl: 'https://example.com/novo', destinationHost: 'example.com', expiresInSeconds: null, creatorIpHash: hash });
    await db.query(
      "UPDATE app.links SET created_at = now() - interval '400 days', expires_at = now() - interval '200 days' WHERE slug = $1",
      [old.slug],
    );
    await db.query(
      "INSERT INTO app.reports (link_id, slug, reason, contact_email, reporter_ip_hash, status, created_at, resolved_at, resolved_by) SELECT id, slug, 'spam', 'a@example.com', $2, 'resolved', now() - interval '300 days', now() - interval '200 days', 'admin' FROM app.links WHERE slug = $1",
      [recent.slug, hash],
    );

    const report = await runCleanup(db);
    expect(report.expiredLinksPurged).toBe(1);
    expect(report.linkIpHashes).toBe(1);
    expect(report.reportEmails).toBe(1);
    expect(report.reportIpHashes).toBe(1);

    const { rows } = await db.query<{ slug: string; status: string; destination_url: string | null; creator_ip_hash: Buffer | null }>(
      'SELECT slug, status, destination_url, creator_ip_hash FROM app.links ORDER BY id',
    );
    expect(rows[0]).toMatchObject({ slug: old.slug, status: 'deleted', destination_url: null, creator_ip_hash: null });
    expect(rows[1]).toMatchObject({ slug: recent.slug, status: 'active', destination_url: 'https://example.com/novo' });
    expect(rows[1]?.creator_ip_hash).toHaveLength(32);
  });
});

describe('runtime e persistência', () => {
  it('dados persistem após "redeploy" (novo runtime e novo pool)', async () => {
    const created = await insertLinkWithUniqueSlug(db, { destinationUrl: 'https://example.com/persistente', destinationHost: 'example.com', expiresInSeconds: null, creatorIpHash: null });
    const env = baseEnv();
    const first = getPublicRuntime({ deploy: { context: 'dev' } }, env);
    expect(first.ok).toBe(true);
    resetRuntimeCaches();
    const second = getPublicRuntime({ deploy: { context: 'dev' } }, { ...env, DATABASE_URL: `${env.DATABASE_URL}?application_name=redeploy` });
    if (!second.ok) throw new Error('runtime inválido');
    const response = await handleInterstitial(new Request(`${PUBLIC_ORIGIN}/s/${created.slug}`), requestContext(), second.deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('example.com');
    await second.deps.db.end();
  });

  it('configuração inválida responde 503 genérico, sem revelar detalhes', async () => {
    const result = getPublicRuntime({ deploy: { context: 'production' } }, { ANTIBOT_MODE: 'test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const json = result.response('json');
      expect(json.status).toBe(503);
      const text = await json.text();
      expect(text).not.toMatch(/ANTIBOT|DATABASE|IP_HASH/);
      expect(result.response('html').status).toBe(503);
    }
    const admin = getAdminRuntime({ deploy: { context: 'production' } }, {});
    expect(admin.ok).toBe(false);
  });
});
