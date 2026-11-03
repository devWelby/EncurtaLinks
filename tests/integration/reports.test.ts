import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { insertLinkWithUniqueSlug } from '../../src/server/domain/links.ts';
import { updateSettings } from '../../src/server/domain/settings.ts';
import { handleLegal } from '../../src/server/handlers/legal.ts';
import { handleReport } from '../../src/server/handlers/report.ts';
import { closeTestDb, jsonRequest, PUBLIC_ORIGIN, publicDeps, requestContext, resetDb, testDb, VALID_ANTIBOT } from '../helpers/harness.ts';

const db = testDb();

async function report(body: Record<string, unknown>, options: { ip?: string; env?: Record<string, string> } = {}) {
  const ctx = requestContext(options.ip ?? '203.0.113.50');
  const response = await handleReport(
    jsonRequest(`${PUBLIC_ORIGIN}/api/reports`, { reason: 'phishing', turnstileToken: VALID_ANTIBOT, ...body }, { headers: { origin: PUBLIC_ORIGIN } }),
    ctx,
    publicDeps(db, {}, options.env ?? {}),
  );
  await ctx.settle();
  return { response, json: (await response.json()) as { error?: { code: string } } };
}

async function newLink(): Promise<string> {
  return (await insertLinkWithUniqueSlug(db, { destinationUrl: 'https://example.com/', destinationHost: 'example.com', expiresInSeconds: null, creatorIpHash: null })).slug;
}

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await closeTestDb();
});

describe('POST /api/reports', () => {
  it('registra a denúncia pelo link completo ou pelo código', async () => {
    const slug = await newLink();
    expect((await report({ link: `${PUBLIC_ORIGIN}/s/${slug}`, details: 'Página falsa de banco', contactEmail: 'Pessoa@Example.com' })).response.status).toBe(201);
    expect((await report({ link: slug, reason: 'spam' }, { ip: '203.0.113.51' })).response.status).toBe(201);
    const { rows } = await db.query<{ reason: string; contact_email: string | null; reporter_ip_hash: Buffer; status: string }>(
      'SELECT reason, contact_email, reporter_ip_hash, status FROM app.reports ORDER BY id',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ reason: 'phishing', contact_email: 'pessoa@example.com', status: 'open' });
    expect(rows[0]?.reporter_ip_hash).toHaveLength(32);
  });

  it('link inexistente → 404; link inválido → 422', async () => {
    expect((await report({ link: 'ZZZZZZZZZZ' })).response.status).toBe(404);
    expect((await report({ link: 'https://x.example/<script>' })).response.status).toBe(422);
  });

  it('recusa desafio inválido, motivo inválido e e-mail inválido', async () => {
    const slug = await newLink();
    expect((await report({ link: slug, turnstileToken: 'falso' })).response.status).toBe(403);
    expect((await report({ link: slug, reason: 'outro-motivo' })).response.status).toBe(400);
    expect((await report({ link: slug, contactEmail: 'não é email' })).response.status).toBe(400);
  });

  it('bloqueia automaticamente após denúncias de origens distintas, com auditoria', async () => {
    const slug = await newLink();
    const env = { REPORT_AUTO_BLOCK_THRESHOLD: '3' };
    // A mesma origem repetida não conta como origens distintas.
    for (let i = 0; i < 3; i += 1) await report({ link: slug }, { env, ip: '198.51.100.9' });
    expect((await db.query<{ status: string }>('SELECT status FROM app.links WHERE slug = $1', [slug])).rows[0]?.status).toBe('active');
    await report({ link: slug }, { env, ip: '198.51.100.10' });
    await report({ link: slug }, { env, ip: '198.51.100.11' });
    expect((await db.query<{ status: string }>('SELECT status FROM app.links WHERE slug = $1', [slug])).rows[0]?.status).toBe('blocked');
    const audit = await db.query<{ action: string; admin_login: string }>('SELECT action, admin_login FROM app.admin_audit_log');
    expect(audit.rows).toEqual([{ action: 'link.auto_block', admin_login: 'sistema' }]);
  });

  it('limite por origem e interruptor de denúncias', async () => {
    const slug = await newLink();
    const env = { RATE_LIMIT_REPORT_PER_IP_HOURLY: '2' };
    expect((await report({ link: slug }, { env })).response.status).toBe(201);
    expect((await report({ link: slug }, { env })).response.status).toBe(201);
    const limited = await report({ link: slug }, { env });
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get('retry-after')).not.toBeNull();

    await updateSettings(db, { reportsEnabled: false }, 'teste');
    expect((await report({ link: slug }, { ip: '198.51.100.99' })).json.error?.code).toBe('reports_disabled');
  });
});

describe('GET /api/legal/:kind', () => {
  it('devolve termos e privacidade com cache curto na CDN', async () => {
    for (const kind of ['terms', 'privacy']) {
      const response = await handleLegal(new Request(`${PUBLIC_ORIGIN}/api/legal/${kind}`), requestContext(), publicDeps(db));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { kind: string; body: string };
      expect(body.kind).toBe(kind);
      expect(body.body).toContain('PREENCHER');
      expect(response.headers.get('netlify-cdn-cache-control')).toMatch(/max-age=\d+/);
    }
    const missing = await handleLegal(new Request(`${PUBLIC_ORIGIN}/api/legal/outro`), requestContext(), publicDeps(db));
    expect(missing.status).toBe(404);
  });
});
