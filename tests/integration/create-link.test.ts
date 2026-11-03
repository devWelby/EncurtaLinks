import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { handleCreateLink } from '../../src/server/handlers/create-link.ts';
import { updateSettings } from '../../src/server/domain/settings.ts';
import {
  closeTestDb,
  failingDb,
  jsonRequest,
  PUBLIC_ORIGIN,
  publicDeps,
  requestContext,
  resetDb,
  testDb,
  VALID_ANTIBOT,
} from '../helpers/harness.ts';

const db = testDb();
const URL_CREATE = `${PUBLIC_ORIGIN}/api/links`;

async function create(body: Record<string, unknown>, options: { ip?: string; env?: Record<string, string>; headers?: Record<string, string>; generateSlug?: () => string } = {}) {
  const ctx = requestContext(options.ip ?? '203.0.113.10');
  const deps = publicDeps(db, options.generateSlug ? { generateSlug: options.generateSlug } : {}, options.env ?? {});
  const response = await handleCreateLink(
    jsonRequest(URL_CREATE, { turnstileToken: VALID_ANTIBOT, ...body }, { headers: { origin: PUBLIC_ORIGIN, ...(options.headers ?? {}) } }),
    ctx,
    deps,
  );
  await ctx.settle();
  const json = (await response.json()) as Record<string, unknown> & { error?: { code: string; message: string } };
  return { response, json };
}

const linkCount = async () => Number((await db.query<{ n: string }>('SELECT count(*)::text AS n FROM app.links')).rows[0]?.n);

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await closeTestDb();
});

describe('POST /api/links — criação', () => {
  it('cria e persiste o link com slug aleatório', async () => {
    const { response, json } = await create({ url: 'https://example.com/pagina?x=1' });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(json.slug).toMatch(/^[2-9A-HJ-NP-Za-km-z]{10}$/);
    expect(json.shortUrl).toBe(`${PUBLIC_ORIGIN}/s/${String(json.slug)}`);
    expect(json.destinationHost).toBe('example.com');
    expect(json.expiresAt).toBeNull();

    const { rows } = await db.query<{ destination_url: string; status: string; creator_ip_hash: Buffer; expires_at: Date | null }>(
      'SELECT destination_url, status, creator_ip_hash, expires_at FROM app.links WHERE slug = $1',
      [json.slug],
    );
    expect(rows[0]).toMatchObject({ destination_url: 'https://example.com/pagina?x=1', status: 'active', expires_at: null });
    // O IP é guardado apenas como HMAC (32 bytes), nunca em texto.
    expect(rows[0]?.creator_ip_hash).toHaveLength(32);
    const dump = await db.query<{ t: string }>("SELECT row_to_json(l)::text AS t FROM app.links l");
    expect(dump.rows.map((r) => r.t).join('')).not.toContain('203.0.113.10');
  });

  it('respeita a validade escolhida (sem expiração curta imposta)', async () => {
    const { response, json } = await create({ url: 'https://example.com', expiresIn: '7d' });
    expect(response.status).toBe(201);
    const expires = new Date(String(json.expiresAt)).getTime();
    expect(expires - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(expires - Date.now()).toBeLessThan(7.1 * 86_400_000);
  });

  it('em colisão de slug, tenta outro código', async () => {
    const first = await create({ url: 'https://example.com/1' }, { generateSlug: () => 'AAAAAAAAAA' });
    expect(first.response.status).toBe(201);
    const sequence = ['AAAAAAAAAA', 'AAAAAAAAAA', 'BBBBBBBBBB'];
    const second = await create({ url: 'https://example.com/2' }, { generateSlug: () => sequence.shift() ?? 'CCCCCCCCCC' });
    expect(second.response.status).toBe(201);
    expect(second.json.slug).toBe('BBBBBBBBBB');
    expect(await linkCount()).toBe(2);
  });

  it('desiste após tentativas limitadas e não sobrescreve o link existente', async () => {
    await create({ url: 'https://example.com/original' }, { generateSlug: () => 'AAAAAAAAAA' });
    const { response, json } = await create({ url: 'https://evil.example.org/' }, { generateSlug: () => 'AAAAAAAAAA' });
    expect(response.status).toBe(503);
    expect(json.error?.code).toBe('slug_unavailable');
    const { rows } = await db.query<{ destination_url: string }>("SELECT destination_url FROM app.links WHERE slug = 'AAAAAAAAAA'");
    expect(rows[0]?.destination_url).toBe('https://example.com/original');
  });

  it('criações concorrentes geram slugs distintos', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => create({ url: `https://example.com/${i}` }, { ip: `198.51.100.${i + 1}` })),
    );
    expect(results.every((r) => r.response.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.json.slug)).size).toBe(20);
    expect(await linkCount()).toBe(20);
  });
});

describe('POST /api/links — validação e segurança', () => {
  it.each([
    ['javascript:alert(1)', 'invalid_url:unsupported_protocol'],
    ['data:text/html;base64,PHNjcmlwdD4=', 'invalid_url:unsupported_protocol'],
    ['ftp://example.com', 'invalid_url:unsupported_protocol'],
    ['example.com', 'invalid_url:missing_scheme'],
    ['http://127.0.0.1/', 'invalid_url:private_address'],
    ['http://[::1]/', 'invalid_url:private_address'],
    ['http://[::ffff:169.254.169.254]/', 'invalid_url:private_address'],
    ['http://169.254.169.254/latest/meta-data/', 'invalid_url:private_address'],
    ['http://localhost/', 'invalid_url:invalid_host'],
    ['http://app.localhost/', 'invalid_url:reserved_host'],
    ['https://example.com:8080/', 'invalid_url:port_not_allowed'],
    ['https://a:b@example.com/', 'invalid_url:credentials_not_allowed'],
    ['https://example.com/\r\nSet-Cookie: x=y', 'invalid_url:invalid_characters'],
    [`${PUBLIC_ORIGIN}/s/abcdefghij`, 'invalid_url:port_not_allowed'],
  ])('recusa %j com %s', async (url, code) => {
    const { response, json } = await create({ url });
    expect(response.status).toBe(422);
    expect(json.error?.code).toBe(code);
    expect(await linkCount()).toBe(0);
  });

  it('recusa laço para o próprio serviço', async () => {
    const { response, json } = await create({ url: 'https://encurtalinks.netlify.app/s/abcdefghij' }, { env: { PUBLIC_SITE_URL: 'https://encurtalinks.netlify.app' } });
    expect(response.status).toBe(422);
    expect(json.error?.code).toBe('invalid_url:self_reference');
  });

  it('recusa domínios bloqueados e seus subdomínios (sem cache)', async () => {
    expect((await create({ url: 'https://bit.ly/abc' })).json.error?.code).toBe('blocked_domain');
    expect((await create({ url: 'https://www.bit.ly/abc' })).json.error?.code).toBe('blocked_domain');
    expect((await create({ url: 'https://malicioso.example.org/' })).response.status).toBe(201);
    await db.query("INSERT INTO app.blocked_domains (domain) VALUES ('example.org')");
    expect((await create({ url: 'https://malicioso.example.org/' })).json.error?.code).toBe('blocked_domain');
  });

  it('armazena texto de injeção SQL como dado, sem efeito', async () => {
    const { response, json } = await create({ url: "https://example.com/?q=';DROP%20TABLE%20app.links;--" });
    expect(response.status).toBe(201);
    const { rows } = await db.query<{ destination_url: string }>('SELECT destination_url FROM app.links WHERE slug = $1', [json.slug]);
    expect(rows[0]?.destination_url).toContain('DROP');
    expect(await linkCount()).toBe(1);
  });

  it('recusa desafio antiautomação inválido, sem criar link', async () => {
    const { response, json } = await create({ url: 'https://example.com', turnstileToken: 'token-falso' });
    expect(response.status).toBe(403);
    expect(json.error?.code).toBe('antibot_failed');
    expect(await linkCount()).toBe(0);
  });

  it('desafio indisponível falha fechado (503)', async () => {
    const ctx = requestContext();
    const deps = publicDeps(db, { fetchImpl: () => Promise.reject(new Error('rede')) }, { ANTIBOT_MODE: 'turnstile', TURNSTILE_SECRET_KEY: 'segredo-real' });
    const response = await handleCreateLink(jsonRequest(URL_CREATE, { url: 'https://example.com', turnstileToken: 'x' }), ctx, deps);
    expect(response.status).toBe(503);
    expect(await linkCount()).toBe(0);
  });

  it('confere hostname e ação do Turnstile no servidor', async () => {
    const reply = (hostname: string, action: string) => () =>
      Promise.resolve(new Response(JSON.stringify({ success: true, hostname, action }), { headers: { 'content-type': 'application/json' } }));
    const env = { ANTIBOT_MODE: 'turnstile', TURNSTILE_SECRET_KEY: 'segredo-real' };
    const run = async (fetchImpl: typeof fetch) =>
      handleCreateLink(jsonRequest(URL_CREATE, { url: 'https://example.com', turnstileToken: 'x' }), requestContext(), publicDeps(db, { fetchImpl }, env));
    expect((await run(reply('localhost', 'report_link'))).status).toBe(403);
    expect((await run(reply('evil.example', 'create_link'))).status).toBe(403);
    expect((await run(reply('localhost', 'create_link'))).status).toBe(201);
  });

  it('valida método, Content-Type e tamanho do corpo', async () => {
    const deps = publicDeps(db);
    expect((await handleCreateLink(new Request(URL_CREATE), requestContext(), deps)).status).toBe(405);
    const text = new Request(URL_CREATE, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect((await handleCreateLink(text, requestContext(), deps)).status).toBe(415);
    const big = jsonRequest(URL_CREATE, { url: `https://example.com/${'a'.repeat(9000)}`, turnstileToken: VALID_ANTIBOT });
    expect((await handleCreateLink(big, requestContext(), deps)).status).toBe(413);
    const invalid = new Request(URL_CREATE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nao-json' });
    expect((await handleCreateLink(invalid, requestContext(), deps)).status).toBe(400);
  });

  it('recusa origem cruzada', async () => {
    const { response } = await create({ url: 'https://example.com' }, { headers: { origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
    const { response: crossSite } = await create({ url: 'https://example.com' }, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
  });

  it('respeita o interruptor de criação (efeito imediato)', async () => {
    await updateSettings(db, { linkCreationEnabled: false }, 'teste');
    const { response, json } = await create({ url: 'https://example.com' });
    expect(response.status).toBe(503);
    expect(json.error?.code).toBe('creation_disabled');
  });

  it('falha do banco devolve 503 sem detalhes internos', async () => {
    const ctx = requestContext();
    const response = await handleCreateLink(
      jsonRequest(URL_CREATE, { url: 'https://example.com', turnstileToken: VALID_ANTIBOT }),
      ctx,
      { config: publicDeps(db).config, db: failingDb() },
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toMatch(/ECONNREFUSED|stack|at \w+ \(/);
  });
});

describe('POST /api/links — limites de uso', () => {
  it('limita por origem com 429 e Retry-After, antes do desafio', async () => {
    const env = { RATE_LIMIT_CREATE_PER_IP_10MIN: '3' };
    for (let i = 0; i < 3; i += 1) expect((await create({ url: `https://example.com/${i}` }, { env })).response.status).toBe(201);
    const blocked = await create({ url: 'https://example.com/4', turnstileToken: 'token-invalido' }, { env });
    expect(blocked.response.status).toBe(429);
    expect(Number(blocked.response.headers.get('retry-after'))).toBeGreaterThan(0);
    // Outra origem continua liberada.
    expect((await create({ url: 'https://example.com/5' }, { env, ip: '198.51.100.77' })).response.status).toBe(201);
  });

  it('IPv6 do mesmo /64 compartilha o limite', async () => {
    const env = { RATE_LIMIT_CREATE_PER_IP_10MIN: '2' };
    expect((await create({ url: 'https://example.com/a' }, { env, ip: '2001:db8:1:2::1' })).response.status).toBe(201);
    expect((await create({ url: 'https://example.com/b' }, { env, ip: '2001:db8:1:2::ffff' })).response.status).toBe(201);
    expect((await create({ url: 'https://example.com/c' }, { env, ip: '2001:db8:1:2:abcd::9' })).response.status).toBe(429);
  });

  it('aplica limite global', async () => {
    const env = { RATE_LIMIT_CREATE_GLOBAL_HOURLY: '2' };
    expect((await create({ url: 'https://example.com/a' }, { env, ip: '198.51.100.1' })).response.status).toBe(201);
    expect((await create({ url: 'https://example.com/b' }, { env, ip: '198.51.100.2' })).response.status).toBe(201);
    expect((await create({ url: 'https://example.com/c' }, { env, ip: '198.51.100.3' })).response.status).toBe(429);
  });

  it('é distribuído e atômico sob concorrência', async () => {
    const env = { RATE_LIMIT_CREATE_PER_IP_10MIN: '5' };
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => create({ url: `https://example.com/${i}` }, { env })));
    expect(results.filter((r) => r.response.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.response.status === 429)).toHaveLength(10);
  });

  it('não confia em cabeçalhos de IP enviados pelo cliente', async () => {
    const env = { RATE_LIMIT_CREATE_PER_IP_10MIN: '1' };
    expect((await create({ url: 'https://example.com/a' }, { env })).response.status).toBe(201);
    const spoofed = await create(
      { url: 'https://example.com/b' },
      { env, headers: { 'x-forwarded-for': '198.51.100.200', 'x-real-ip': '198.51.100.201', 'x-nf-client-connection-ip': '198.51.100.202' } },
    );
    expect(spoofed.response.status).toBe(429);
  });
});
