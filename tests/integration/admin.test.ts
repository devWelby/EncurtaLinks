import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertLinkWithUniqueSlug } from '../../src/server/domain/links.ts';
import { createSession } from '../../src/server/domain/sessions.ts';
import { handleAdminApi } from '../../src/server/handlers/admin-api.ts';
import { handleAuthCallback, handleAuthStart, handleLogout, SESSION_COOKIE } from '../../src/server/handlers/admin-auth.ts';
import type { AdminDeps } from '../../src/server/handlers/context.ts';
import { handleCreateLink } from '../../src/server/handlers/create-link.ts';
import { handleLegal } from '../../src/server/handlers/legal.ts';
import {
  ADMIN_ORIGIN,
  adminDeps,
  closeTestDb,
  jsonRequest,
  PUBLIC_ORIGIN,
  publicDeps,
  requestContext,
  resetDb,
  testDb,
  VALID_ANTIBOT,
} from '../helpers/harness.ts';

const db = testDb();
const ADMIN_ID = 1001;

async function login(githubId = ADMIN_ID): Promise<{ cookie: string; csrf: string; token: string }> {
  const { token, session } = await createSession(db, { githubId, login: 'admin-teste' }, 3600);
  return { cookie: `${SESSION_COOKIE}=${token}`, csrf: session.csrfToken, token };
}

interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  csrf?: string;
  origin?: string | null;
  host?: string;
  headers?: Record<string, string>;
  deps?: AdminDeps;
}

async function call(path: string, options: CallOptions = {}) {
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrf) headers['x-csrf-token'] = options.csrf;
  const origin = options.origin === undefined ? ADMIN_ORIGIN : options.origin;
  if (origin !== null && method !== 'GET') headers.origin = origin;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(`${options.host ?? ADMIN_ORIGIN}/api/admin/${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const response = await handleAdminApi(request, requestContext('203.0.113.80'), options.deps ?? adminDeps(db));
  const text = await response.text();
  return { response, status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown> & { error?: { code: string } }) : {} };
}

async function newLink(destination = 'https://example.com/'): Promise<string> {
  return (await insertLinkWithUniqueSlug(db, { destinationUrl: destination, destinationHost: new URL(destination).hostname, expiresInSeconds: null, creatorIpHash: null })).slug;
}

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await closeTestDb();
});

describe('autorização do painel', () => {
  const endpoints: Array<[string, string, unknown?]> = [
    ['GET', 'session'],
    ['GET', 'links'],
    ['POST', 'links/ABCDEFGHJK/block', {}],
    ['GET', 'reports'],
    ['POST', 'reports/1/resolve', {}],
    ['GET', 'domains'],
    ['POST', 'domains', { domain: 'x.com' }],
    ['GET', 'metrics'],
    ['GET', 'settings'],
    ['POST', 'settings', { adsEnabled: true }],
    ['GET', 'legal/terms'],
    ['GET', 'audit'],
    ['POST', 'sessions/revoke-all', {}],
  ];

  it.each(endpoints)('%s %s sem sessão → 401', async (method, path, body) => {
    expect((await call(path, { method, body })).status).toBe(401);
  });

  it('cookie inválido ou forjado → 401', async () => {
    expect((await call('session', { cookie: `${SESSION_COOKIE}=${'A'.repeat(43)}` })).status).toBe(401);
    expect((await call('session', { cookie: `${SESSION_COOKIE}=nao-e-token` })).status).toBe(401);
  });

  it('sessão válida devolve o token CSRF', async () => {
    const { cookie, csrf } = await login();
    const { status, json } = await call('session', { cookie });
    expect(status).toBe(200);
    expect(json).toMatchObject({ admin: { githubId: ADMIN_ID, login: 'admin-teste' }, csrfToken: csrf });
  });

  it('alterações exigem token CSRF correto', async () => {
    const { cookie, csrf } = await login();
    expect((await call('settings', { cookie, body: { adsEnabled: true } })).json.error?.code).toBe('bad_csrf');
    expect((await call('settings', { cookie, csrf: 'x'.repeat(43), body: { adsEnabled: true } })).status).toBe(403);
    expect((await call('settings', { cookie, csrf, body: { adsEnabled: true } })).status).toBe(200);
  });

  it('alterações exigem Origin do painel', async () => {
    const { cookie, csrf } = await login();
    expect((await call('settings', { cookie, csrf, origin: null, body: { adsEnabled: true } })).json.error?.code).toBe('bad_origin');
    expect((await call('settings', { cookie, csrf, origin: PUBLIC_ORIGIN, body: { adsEnabled: true } })).status).toBe(403);
    expect((await call('settings', { cookie, csrf, origin: 'https://evil.example', body: { adsEnabled: true } })).status).toBe(403);
  });

  it('recusa requisições entre sites (Sec-Fetch-Site)', async () => {
    const { cookie } = await login();
    expect((await call('session', { cookie, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await call('session', { cookie, headers: { 'sec-fetch-site': 'same-site' } })).status).toBe(403);
  });

  it('URLs alternativas do deploy não dão acesso, mesmo com cookie válido', async () => {
    const deps = adminDeps(db, {}, { ADMIN_SITE_URL: 'https://encurtalinks-admin.netlify.app' });
    const { cookie } = await login();
    for (const host of [
      'https://69a1b2c3d4--encurtalinks-admin.netlify.app',
      'https://deploy-preview-7--encurtalinks-admin.netlify.app',
      'https://encurtalinks.netlify.app',
      'http://encurtalinks-admin.netlify.app',
    ]) {
      expect((await call('session', { cookie, host, deps })).status, host).toBe(404);
    }
    expect((await call('session', { cookie, host: 'https://encurtalinks-admin.netlify.app', deps })).status).toBe(200);
  });

  it('administrador removido da allowlist perde o acesso e a sessão é revogada', async () => {
    const { cookie, token } = await login(2002);
    expect((await call('session', { cookie })).status).toBe(401);
    const { rows } = await db.query<{ revoked: boolean }>(
      "SELECT revoked_at IS NOT NULL AS revoked FROM app.admin_sessions WHERE token_hash = sha256(convert_to($1, 'UTF8'))",
      [token],
    );
    expect(rows[0]?.revoked).toBe(true);
  });

  it('sessão expira por inatividade e por prazo absoluto', async () => {
    const idle = await login();
    await db.query("UPDATE app.admin_sessions SET last_seen_at = now() - interval '2 hours'");
    expect((await call('session', { cookie: idle.cookie })).status).toBe(401);

    const absolute = await login();
    await db.query(
      "UPDATE app.admin_sessions SET created_at = now() - interval '10 hours', expires_at = now() - interval '1 second' WHERE token_hash = sha256(convert_to($1, 'UTF8'))",
      [absolute.token],
    );
    expect((await call('session', { cookie: absolute.cookie })).status).toBe(401);
  });

  it('logout e "encerrar todas as sessões" revogam no servidor', async () => {
    const a = await login();
    const logout = await handleLogout(
      new Request(`${ADMIN_ORIGIN}/auth/logout`, { method: 'POST', headers: { cookie: a.cookie, 'x-csrf-token': a.csrf, origin: ADMIN_ORIGIN } }),
      requestContext(),
      adminDeps(db),
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toMatch(/__Host-el_admin=;.*Max-Age=0/);
    expect((await call('session', { cookie: a.cookie })).status).toBe(401);

    const b = await login();
    const c = await login();
    expect((await call('sessions/revoke-all', { cookie: b.cookie, csrf: b.csrf, body: {} })).json).toMatchObject({ revoked: 2 });
    expect((await call('session', { cookie: c.cookie })).status).toBe(401);
  });

  it('limita requisições por sessão', async () => {
    const deps = adminDeps(db, {}, { RATE_LIMIT_ADMIN_API_PER_SESSION_10MIN: '10' });
    const { cookie } = await login();
    const statuses = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await call('session', { cookie, deps })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('rotas e métodos desconhecidos', async () => {
    const { cookie } = await login();
    expect((await call('nao-existe', { cookie })).status).toBe(404);
    expect((await call('links', { cookie, method: 'DELETE' })).status).toBe(405);
  });
});

describe('operações administrativas', () => {
  it('busca paginada de links, com injeção SQL tratada como texto', async () => {
    for (let i = 0; i < 7; i += 1) await newLink(`https://site${i}.example.com/`);
    const { cookie } = await login();
    const page1 = await call('links?pageSize=5', { cookie });
    expect(page1.json).toMatchObject({ page: 1, pageSize: 5, hasMore: true });
    expect((page1.json.items as unknown[]).length).toBe(5);
    const page2 = await call('links?pageSize=5&page=2', { cookie });
    expect((page2.json.items as unknown[]).length).toBe(2);
    expect(page2.json.hasMore).toBe(false);

    const search = await call(`links?q=${encodeURIComponent('site3')}`, { cookie });
    expect((search.json.items as Array<{ destinationHost: string }>).map((i) => i.destinationHost)).toEqual(['site3.example.com']);
    const injection = await call(`links?q=${encodeURIComponent("%' OR 1=1 --")}`, { cookie });
    expect(injection.status).toBe(200);
    expect(injection.json.items).toEqual([]);
    expect((await call('links?status=qualquer', { cookie })).status).toBe(400);
  });

  it('bloqueia, desbloqueia e exclui links com auditoria; slug excluído não é reutilizado', async () => {
    const slug = await newLink();
    const { cookie, csrf } = await login();
    expect((await call(`links/${slug}/block`, { cookie, csrf, body: { reason: 'phishing confirmado' } })).json).toMatchObject({ status: 'blocked' });
    expect((await call(`links/${slug}/block`, { cookie, csrf, body: {} })).status).toBe(409);
    expect((await call(`links/${slug}/unblock`, { cookie, csrf, body: {} })).json).toMatchObject({ status: 'active' });
    expect((await call(`links/${slug}/delete`, { cookie, csrf, body: {} })).json).toMatchObject({ status: 'deleted' });
    expect((await call(`links/${slug}/unblock`, { cookie, csrf, body: {} })).status).toBe(409);
    expect((await call('links/ZZZZZZZZZZ/block', { cookie, csrf, body: {} })).status).toBe(404);

    const { rows } = await db.query<{ destination_url: string | null; status: string }>('SELECT destination_url, status FROM app.links WHERE slug = $1', [slug]);
    expect(rows[0]).toEqual({ destination_url: null, status: 'deleted' });
    await expect(
      insertLinkWithUniqueSlug(db, { destinationUrl: 'https://outro.example.com/', destinationHost: 'outro.example.com', expiresInSeconds: null, creatorIpHash: null }, { generate: () => slug, maxAttempts: 2 }),
    ).rejects.toThrow();

    const audit = await call('audit', { cookie });
    expect((audit.json.items as Array<{ action: string }>).map((i) => i.action)).toEqual(['link.delete', 'link.unblock', 'link.block']);
  });

  it('alterações concorrentes de estado são serializadas', async () => {
    const slug = await newLink();
    const { cookie, csrf } = await login();
    const results = await Promise.all(Array.from({ length: 8 }, () => call(`links/${slug}/block`, { cookie, csrf, body: {} })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
  });

  it('trata denúncias e pode bloquear o link na mesma operação', async () => {
    const slug = await newLink();
    await db.query("INSERT INTO app.reports (link_id, slug, reason) SELECT id, slug, 'phishing' FROM app.links WHERE slug = $1", [slug]);
    const { cookie, csrf } = await login();
    const list = await call('reports', { cookie });
    const items = list.json.items as Array<{ id: number; status: string; linkStatus: string }>;
    expect(items).toHaveLength(1);
    const id = items[0]?.id ?? 0;
    const resolved = await call(`reports/${id}/resolve`, { cookie, csrf, body: { note: 'confirmado', blockLink: true } });
    expect(resolved.json).toMatchObject({ status: 'resolved', linkBlocked: true });
    expect((await call(`reports/${id}/dismiss`, { cookie, csrf, body: {} })).status).toBe(409);
    expect((await call('reports/999/resolve', { cookie, csrf, body: {} })).status).toBe(404);
    expect((await call('reports?status=resolved', { cookie })).json.items).toHaveLength(1);
  });

  it('bloqueio de domínio vale imediatamente para novas criações', async () => {
    const { cookie, csrf } = await login();
    expect((await call('domains', { cookie, csrf, body: { domain: 'https://Golpe.Example.com/qualquer', reason: 'phishing' } })).json).toEqual({ domain: 'golpe.example.com' });
    expect((await call('domains', { cookie, csrf, body: { domain: 'golpe.example.com' } })).status).toBe(409);
    expect((await call('domains', { cookie, csrf, body: { domain: 'não é domínio' } })).status).toBe(400);

    const createReq = () =>
      handleCreateLink(jsonRequest(`${PUBLIC_ORIGIN}/api/links`, { url: 'https://www.golpe.example.com/', turnstileToken: VALID_ANTIBOT }), requestContext(), publicDeps(db));
    expect((await createReq()).status).toBe(422);
    expect((await call(`domains/${encodeURIComponent('golpe.example.com')}/delete`, { cookie, csrf, body: {} })).status).toBe(200);
    expect((await createReq()).status).toBe(201);
  });

  it('interruptor de criação de links tem efeito imediato no site público', async () => {
    const { cookie, csrf } = await login();
    expect((await call('settings', { cookie, csrf, body: { linkCreationEnabled: false } })).json).toMatchObject({ linkCreationEnabled: false });
    const response = await handleCreateLink(
      jsonRequest(`${PUBLIC_ORIGIN}/api/links`, { url: 'https://example.com/', turnstileToken: VALID_ANTIBOT }),
      requestContext(),
      publicDeps(db),
    );
    expect(response.status).toBe(503);
    expect((await call('settings', { cookie, csrf, body: {} })).status).toBe(400);
    expect((await call('settings', { cookie, csrf, body: { desconhecido: true } })).status).toBe(400);
  });

  it('edita termos/privacidade com campos do responsável', async () => {
    const { cookie, csrf } = await login();
    const saved = await call('legal/privacy', {
      cookie,
      csrf,
      body: { title: 'Política de Privacidade', body: '# Seção\n\nTexto revisado.', responsibleName: 'Fulano', responsibleContact: 'contato@example.com', responsibleDocument: '' },
    });
    expect(saved.json).toMatchObject({ kind: 'privacy', responsibleName: 'Fulano', responsibleDocument: null });
    const publicResponse = await handleLegal(new Request(`${PUBLIC_ORIGIN}/api/legal/privacy`), requestContext(), publicDeps(db));
    expect(((await publicResponse.json()) as { body: string }).body).toContain('Texto revisado.');
  });

  it('métricas agregadas separam aberturas e continuações confirmadas', async () => {
    const { cookie } = await login();
    await db.query("INSERT INTO app.daily_metrics (day, metric, count) VALUES ((now() AT TIME ZONE 'UTC')::date, 'interstitial_view', 10), ((now() AT TIME ZONE 'UTC')::date, 'continuation', 4)");
    const { json } = await call('metrics?days=7', { cookie });
    const days = json.days as Array<{ interstitialView: number; continuation: number }>;
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ interstitialView: 10, continuation: 4 });
    expect(json.totals).toMatchObject({ activeLinks: 0, blockedDomains: 16 });
  });
});

describe('login com GitHub (OAuth + PKCE)', () => {
  const startLogin = async (deps = adminDeps(db)) => {
    const response = await handleAuthStart(new Request(`${ADMIN_ORIGIN}/auth/github/start`), requestContext(), deps);
    const location = new URL(response.headers.get('location') ?? '');
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    return { response, location, cookie };
  };

  function githubMock(user: Record<string, unknown>) {
    return vi.fn((input: string | URL | Request, _init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === 'https://github.com/login/oauth/access_token') {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'gho_teste', token_type: 'bearer', scope: 'read:user' }), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url === 'https://api.github.com/user') {
        return Promise.resolve(new Response(JSON.stringify(user), { headers: { 'content-type': 'application/json' } }));
      }
      return Promise.reject(new Error(`URL inesperada: ${url}`));
    });
  }

  const finish = async (state: string, cookie: string, fetchImpl: typeof fetch, issuer: string | null = 'https://github.com/login/oauth') => {
    const query = new URLSearchParams({ code: 'codigo', state });
    if (issuer !== null) query.set('iss', issuer);
    const callback = new Request(`${ADMIN_ORIGIN}/auth/github/callback?${query.toString()}`, { headers: { cookie } });
    const response = await handleAuthCallback(callback, requestContext(), adminDeps(db, { fetchImpl }));
    return { response, location: response.headers.get('location') ?? '', setCookies: response.headers.getSetCookie() };
  };

  it('inicia com PKCE S256, state e cookie temporário __Host-', async () => {
    const { response, location, cookie } = await startLogin();
    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get('scope')).toBe('read:user');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ADMIN_ORIGIN}/auth/github/callback`);
    expect(cookie).toMatch(/^__Host-el_oauth=/);
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly.*Secure.*SameSite=Lax|SameSite=Lax/);
  });

  it('administrador autorizado com 2FA recebe sessão', async () => {
    const { location, cookie } = await startLogin();
    const fetchImpl = githubMock({ id: ADMIN_ID, login: 'dono', two_factor_authentication: true });
    const result = await finish(location.searchParams.get('state') ?? '', cookie, fetchImpl);
    expect(result.response.status).toBe(303);
    expect(result.location).toBe(`${ADMIN_ORIGIN}/`);
    const session = result.setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/SameSite=Strict/);
    expect(session).not.toMatch(/Domain=/i);
    // O código de troca enviou o code_verifier (PKCE).
    const tokenCall = fetchImpl.mock.calls.find(([input]) => (input instanceof Request ? input.url : input.toString()).includes('access_token'));
    const sentBody = tokenCall?.[1]?.body;
    expect(sentBody instanceof URLSearchParams ? sentBody.toString() : sentBody).toContain('code_verifier=');
    // O token de acesso do GitHub não é armazenado.
    const dump = await db.query<{ t: string }>('SELECT row_to_json(s)::text AS t FROM app.admin_sessions s');
    expect(dump.rows.map((r) => r.t).join('')).not.toContain('gho_teste');
    const sessionCookie = session.split(';')[0] ?? '';
    expect((await call('session', { cookie: sessionCookie })).status).toBe(200);
  });

  it.each([
    ['fora da allowlist', { id: 9999, login: 'intruso', two_factor_authentication: true }, 'nao_autorizado'],
    ['sem 2FA', { id: ADMIN_ID, login: 'dono', two_factor_authentication: false }, 'sem_2fa'],
    ['sem informação de 2FA', { id: ADMIN_ID, login: 'dono' }, 'sem_2fa'],
  ])('recusa conta %s', async (_label, user, code) => {
    const { location, cookie } = await startLogin();
    const result = await finish(location.searchParams.get('state') ?? '', cookie, githubMock(user));
    expect(result.location).toContain(`erro=${code}`);
    expect(result.setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect((await db.query('SELECT 1 FROM app.admin_sessions')).rows).toHaveLength(0);
  });

  it('recusa state divergente e callback sem o cookie temporário', async () => {
    const { cookie } = await startLogin();
    const mismatch = await finish('state-forjado', cookie, githubMock({ id: ADMIN_ID, login: 'dono', two_factor_authentication: true }));
    expect(mismatch.location).toContain('erro=falha_no_login');
    const noCookie = await finish('qualquer', '', githubMock({ id: ADMIN_ID, login: 'dono', two_factor_authentication: true }));
    expect(noCookie.location).toContain('erro=sessao_expirada');
    expect((await db.query('SELECT 1 FROM app.admin_sessions')).rows).toHaveLength(0);
  });

  it.each([null, 'https://github.com', 'https://outro-provedor.example'])('recusa emissor ausente ou incorreto: %s', async (issuer) => {
    const { location, cookie } = await startLogin();
    const fetchImpl = githubMock({ id: ADMIN_ID, login: 'dono', two_factor_authentication: true });
    const result = await finish(location.searchParams.get('state') ?? '', cookie, fetchImpl, issuer);
    expect(result.location).toContain('erro=falha_no_login');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await db.query('SELECT 1 FROM app.admin_sessions')).rows).toHaveLength(0);
  });

  it('login só pelo host oficial do painel', async () => {
    const response = await handleAuthStart(new Request('https://abc123--encurtalinks-admin.netlify.app/auth/github/start'), requestContext(), adminDeps(db, {}, { ADMIN_SITE_URL: 'https://encurtalinks-admin.netlify.app' }));
    expect(response.status).toBe(404);
  });
});
