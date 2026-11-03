import { describe, expect, it, vi } from 'vitest';
import { loadAdminConfig, loadPublicConfig, resolveRuntimeFlags } from '../../src/server/config.ts';
import { verifyTurnstile } from '../../src/server/integrations/turnstile.ts';
import { generateSlug, randomToken, safeEqual } from '../../src/server/security/crypto.ts';
import { extractSlug, isValidSlug, SLUG_ALPHABET } from '../../src/shared/slug.ts';

const PROD_ENV = {
  DATABASE_URL: 'postgres://u:p@db.example.com/app',
  IP_HASH_SECRET: 'x'.repeat(40),
  PUBLIC_SITE_URL: 'https://encurtalinks.netlify.app',
  ADMIN_SITE_URL: 'https://encurtalinks-admin.netlify.app',
  TURNSTILE_SECRET_KEY: 'real-secret-value',
};

describe('detecção de produção e modos de teste', () => {
  it('o contexto de deploy "production" sempre é produção, mesmo com APP_ENV=test', () => {
    const flags = resolveRuntimeFlags({ APP_ENV: 'test' }, 'production');
    expect(flags.isProduction).toBe(true);
    expect(flags.allowTestModes).toBe(false);
  });

  it('modos de teste só existem localmente (contexto dev)', () => {
    expect(resolveRuntimeFlags({ APP_ENV: 'test' }, 'dev').allowTestModes).toBe(true);
    expect(resolveRuntimeFlags({ APP_ENV: 'test' }, 'deploy-preview').allowTestModes).toBe(false);
    expect(resolveRuntimeFlags({ APP_ENV: 'development' }, 'branch-deploy').allowTestModes).toBe(false);
    expect(resolveRuntimeFlags({ APP_ENV: 'production' }, 'dev').allowTestModes).toBe(false);
  });

  it('recusa ANTIBOT_MODE=test em produção e em previews', () => {
    for (const context of ['production', 'deploy-preview', 'branch-deploy']) {
      const result = loadPublicConfig({ ...PROD_ENV, ANTIBOT_MODE: 'test' }, context);
      expect(result.ok, context).toBe(false);
    }
  });

  it('recusa chave secreta de teste do Turnstile em produção', () => {
    const result = loadPublicConfig({ ...PROD_ENV, TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' }, 'production');
    expect(result.ok).toBe(false);
  });

  it('exige IP_HASH_SECRET forte e TLS no banco em produção', () => {
    expect(loadPublicConfig({ ...PROD_ENV, IP_HASH_SECRET: '' }, 'production').ok).toBe(false);
    expect(loadPublicConfig({ ...PROD_ENV, IP_HASH_SECRET: 'curto' }, 'production').ok).toBe(false);
    expect(loadPublicConfig({ ...PROD_ENV, DATABASE_SSL: 'disable' }, 'production').ok).toBe(false);
    expect(loadPublicConfig({ ...PROD_ENV, PUBLIC_SITE_URL: 'http://encurtalinks.netlify.app' }, 'production').ok).toBe(false);
  });

  it('aceita uma configuração de produção completa, com anúncios desligados por padrão', () => {
    const result = loadPublicConfig(PROD_ENV, 'production');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.antibot.mode).toBe('turnstile');
      expect(result.config.antibot.allowDummySecret).toBe(false);
      expect(result.config.ads.envEnabled).toBe(false);
      expect(result.config.ads.devPlaceholder).toBe(false);
    }
  });

  it('o painel exige login GitHub configurado em produção, sem senha padrão', () => {
    expect(loadAdminConfig(PROD_ENV, 'production').ok).toBe(false);
    const ok = loadAdminConfig(
      { ...PROD_ENV, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret', ADMIN_GITHUB_USER_IDS: '123, 456' },
      'production',
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect([...(ok.config.github?.allowedUserIds ?? [])]).toEqual([123, 456]);
      expect(ok.config.github?.require2fa).toBe(true);
    }
    expect(
      loadAdminConfig({ ...PROD_ENV, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', ADMIN_GITHUB_USER_IDS: 'octocat' }, 'production').ok,
    ).toBe(false);
  });
});

describe('verificação do Turnstile', () => {
  const base = { mode: 'turnstile' as const, secretKey: 'segredo', expectedHostname: 'encurtalinks.netlify.app', allowDummySecret: false };
  const reply = (body: unknown, status = 200) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

  it('aceita resposta válida com hostname e ação corretos', async () => {
    const fetchImpl = reply({ success: true, hostname: 'encurtalinks.netlify.app', action: 'create_link' });
    await expect(verifyTurnstile('tok', 'create_link', { ...base, fetchImpl })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('recusa hostname ou ação divergentes', async () => {
    await expect(
      verifyTurnstile('tok', 'create_link', { ...base, fetchImpl: reply({ success: true, hostname: 'evil.example', action: 'create_link' }) }),
    ).resolves.toEqual({ ok: false, reason: 'mismatch' });
    await expect(
      verifyTurnstile('tok', 'create_link', {
        ...base,
        fetchImpl: reply({ success: true, hostname: 'encurtalinks.netlify.app', action: 'report_link' }),
      }),
    ).resolves.toEqual({ ok: false, reason: 'mismatch' });
  });

  it('recusa token ausente, inválido e falha fechada se o serviço cair', async () => {
    await expect(verifyTurnstile('', 'create_link', base)).resolves.toEqual({ ok: false, reason: 'missing' });
    await expect(verifyTurnstile('tok', 'create_link', { ...base, fetchImpl: reply({ success: false }) })).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    await expect(verifyTurnstile('tok', 'create_link', { ...base, fetchImpl: reply({}, 500) })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    const throwing = vi.fn(() => Promise.reject(new Error('rede')));
    await expect(verifyTurnstile('tok', 'create_link', { ...base, fetchImpl: throwing })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('chave de teste da Cloudflare só é aceita quando permitido', async () => {
    const dummy = '1x0000000000000000000000000000000AA';
    await expect(verifyTurnstile('tok', 'create_link', { ...base, secretKey: dummy })).resolves.toEqual({ ok: false, reason: 'misconfigured' });
  });

  it('modo de teste aceita somente o token de teste', async () => {
    await expect(verifyTurnstile('qualquer', 'create_link', { ...base, mode: 'test' })).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(verifyTurnstile('test-antibot-pass', 'create_link', { ...base, mode: 'test' })).resolves.toEqual({ ok: true });
  });
});

describe('slugs e tokens', () => {
  it('gera slugs de 10 caracteres do alfabeto sem ambiguidades', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const slug = generateSlug();
      expect(slug).toHaveLength(10);
      expect([...slug].every((c) => SLUG_ALPHABET.includes(c))).toBe(true);
      expect(isValidSlug(slug)).toBe(true);
      seen.add(slug);
    }
    expect(seen.size).toBe(2000);
    expect(SLUG_ALPHABET).not.toMatch(/[01lIO]/);
  });

  it('valida e extrai slugs', () => {
    expect(isValidSlug('abc')).toBe(false);
    expect(isValidSlug('abcdefghi0')).toBe(false); // "0" não pertence ao alfabeto
    expect(extractSlug('https://encurtalinks.netlify.app/s/abcdefghij')).toBe('abcdefghij');
    expect(extractSlug('abcdefghij')).toBe('abcdefghij');
    expect(extractSlug('https://x/s/<script>')).toBeNull();
  });

  it('tokens aleatórios têm 256 bits e a comparação é segura', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
