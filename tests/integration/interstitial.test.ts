import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeLinkStatus, insertLinkWithUniqueSlug } from '../../src/server/domain/links.ts';
import { updateSettings } from '../../src/server/domain/settings.ts';
import { handleConsent } from '../../src/server/handlers/consent.ts';
import { handleInterstitial } from '../../src/server/handlers/interstitial.ts';
import type { PublicDeps } from '../../src/server/handlers/context.ts';
import { closeTestDb, extractTicket, failingDb, formRequest, PUBLIC_ORIGIN, publicDeps, requestContext, resetDb, testDb } from '../helpers/harness.ts';

const db = testDb();

async function newLink(destination = 'https://example.com/destino?a=1', expiresInSeconds: number | null = null): Promise<string> {
  const created = await insertLinkWithUniqueSlug(db, {
    destinationUrl: destination,
    destinationHost: new URL(destination).hostname,
    expiresInSeconds,
    creatorIpHash: null,
  });
  return created.slug;
}

async function open(slug: string, deps: PublicDeps = publicDeps(db), headers: Record<string, string> = {}) {
  const ctx = requestContext();
  const response = await handleInterstitial(new Request(`${PUBLIC_ORIGIN}/s/${slug}`, { headers }), ctx, deps);
  await ctx.settle();
  return { response, html: await response.text() };
}

async function continueWith(slug: string, ticket: string, options: { deps?: PublicDeps; query?: string; extra?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const ctx = requestContext();
  const response = await handleInterstitial(
    formRequest(`${PUBLIC_ORIGIN}/s/${slug}/continue${options.query ?? ''}`, { ticket, ...(options.extra ?? {}) }, { origin: PUBLIC_ORIGIN, ...(options.headers ?? {}) }),
    ctx,
    options.deps ?? publicDeps(db),
  );
  await ctx.settle();
  return response;
}

const metric = async (name: string) =>
  Number((await db.query<{ n: string }>('SELECT COALESCE(sum(count), 0)::text AS n FROM app.daily_metrics WHERE metric = $1', [name])).rows[0]?.n);

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await closeTestDb();
});

describe('GET /s/:slug', () => {
  it('mostra a página intermediária com o domínio de destino, sem cache', async () => {
    const slug = await newLink();
    const { response, html } = await open(slug);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('location')).toBeNull();
    expect(html).toContain('example.com');
    expect(extractTicket(html)).toHaveLength(43);
    expect(await metric('interstitial_view')).toBe(1);
  });

  it('não guarda o ticket em texto no banco', async () => {
    const slug = await newLink();
    const ticket = extractTicket((await open(slug)).html);
    const { rows } = await db.query<{ t: string }>('SELECT row_to_json(t)::text AS t FROM app.continuation_tickets t');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.t).not.toContain(ticket);
  });

  it('escapa a URL de destino (XSS)', async () => {
    const slug = await newLink('https://example.com/%22%3E%3Cscript%3Ealert(1)%3C/script%3E?a="><img src=x onerror=alert(1)>');
    const { html } = await open(slug);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(1)');
  });

  it('HEAD não emite ticket', async () => {
    const slug = await newLink();
    const response = await handleInterstitial(new Request(`${PUBLIC_ORIGIN}/s/${slug}`, { method: 'HEAD' }), requestContext(), publicDeps(db));
    expect(response.status).toBe(200);
    const { rows } = await db.query('SELECT 1 FROM app.continuation_tickets');
    expect(rows).toHaveLength(0);
  });

  it.each<[string, number, () => Promise<string>]>([
    ['inexistente', 404, () => Promise.resolve('ZZZZZZZZZZ')],
    ['formato inválido', 404, () => Promise.resolve('abc')],
    ['com caracteres especiais', 404, () => Promise.resolve('%3Cscript%3E')],
    ['expirado', 410, async (): Promise<string> => {
      const slug = await newLink();
      await db.query("UPDATE app.links SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE slug = $1", [slug]);
      return slug;
    }],
    ['bloqueado', 403, async (): Promise<string> => {
      const slug = await newLink();
      await changeLinkStatus(db, slug, 'block', 'teste');
      return slug;
    }],
    ['excluído', 410, async (): Promise<string> => {
      const slug = await newLink();
      await changeLinkStatus(db, slug, 'delete', 'teste');
      return slug;
    }],
    ['com domínio bloqueado', 403, async (): Promise<string> => {
      const slug = await newLink('https://sub.perigoso.example.net/');
      await db.query("INSERT INTO app.blocked_domains (domain) VALUES ('perigoso.example.net')");
      return slug;
    }],
  ])('link %s → %i, sem redirecionar', async (_label, status, setup) => {
    const slug = await setup();
    const { response, html } = await open(slug);
    expect(response.status).toBe(status);
    expect(response.headers.get('location')).toBeNull();
    expect(html).not.toContain('name="ticket"');
  });

  it('recusa métodos não suportados', async () => {
    const slug = await newLink();
    const response = await handleInterstitial(new Request(`${PUBLIC_ORIGIN}/s/${slug}`, { method: 'PUT' }), requestContext(), publicDeps(db));
    expect(response.status).toBe(405);
    const getContinue = await handleInterstitial(new Request(`${PUBLIC_ORIGIN}/s/${slug}/continue`), requestContext(), publicDeps(db));
    expect(getContinue.status).toBe(405);
  });

  it('falha do banco mostra 503 e nunca redireciona', async () => {
    const response = await handleInterstitial(new Request(`${PUBLIC_ORIGIN}/s/ABCDEFGHJK`), requestContext(), {
      config: publicDeps(db).config,
      db: failingDb(),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('POST /s/:slug/continue', () => {
  it('consome o ticket e redireciona com 303 para o destino armazenado', async () => {
    const slug = await newLink('https://example.com/destino?a=1');
    const ticket = extractTicket((await open(slug)).html);
    const response = await continueWith(slug, ticket);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://example.com/destino?a=1');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await metric('continuation')).toBe(1);
  });

  it('ignora destino manipulado pelo cliente (?url= e campos extras)', async () => {
    const slug = await newLink('https://example.com/legitimo');
    const ticket = extractTicket((await open(slug)).html);
    const response = await continueWith(slug, ticket, {
      query: '?url=https://evil.example/',
      extra: { url: 'https://evil.example/', destination: 'https://evil.example/' },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://example.com/legitimo');
  });

  it('não permite reutilizar o ticket', async () => {
    const slug = await newLink();
    const ticket = extractTicket((await open(slug)).html);
    expect((await continueWith(slug, ticket)).status).toBe(303);
    const again = await continueWith(slug, ticket);
    expect(again.status).toBe(409);
    expect(again.headers.get('location')).toBeNull();
    expect(await again.text()).toContain('já foi utilizado');
  });

  it('consumo concorrente do mesmo ticket redireciona uma única vez', async () => {
    const slug = await newLink();
    const ticket = extractTicket((await open(slug)).html);
    const results = await Promise.all(Array.from({ length: 12 }, () => continueWith(slug, ticket)));
    expect(results.filter((r) => r.status === 303)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(11);
    expect(await metric('continuation')).toBe(1);
  });

  it('recusa ticket adulterado, ausente ou de outro link', async () => {
    const slug = await newLink();
    const other = await newLink('https://example.org/');
    const ticket = extractTicket((await open(slug)).html);
    const tampered = `${ticket.slice(0, -1)}${ticket.endsWith('A') ? 'B' : 'A'}`;
    expect((await continueWith(slug, tampered)).status).toBe(409);
    expect((await continueWith(slug, 'curto')).status).toBe(400);
    expect((await continueWith(other, ticket)).status).toBe(409);
    // O ticket legítimo continua válido para o link certo.
    expect((await continueWith(slug, ticket)).status).toBe(303);
  });

  it('recusa ticket expirado e oferece um novo', async () => {
    const slug = await newLink();
    const ticket = extractTicket((await open(slug)).html);
    await db.query("UPDATE app.continuation_tickets SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 second'");
    const response = await continueWith(slug, ticket);
    expect(response.status).toBe(409);
    const html = await response.text();
    expect(html).toContain('aberta por muito tempo');
    expect(extractTicket(html)).not.toBe(ticket);
  });

  it('bloqueio aplicado depois de abrir a página impede o redirecionamento', async () => {
    const slug = await newLink();
    const ticket = extractTicket((await open(slug)).html);
    await changeLinkStatus(db, slug, 'block', 'denúncia');
    const response = await continueWith(slug, ticket);
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
  });

  it('bloqueio de domínio e expiração depois de abrir a página também impedem', async () => {
    const a = await newLink('https://alvo.example.com/');
    const ticketA = extractTicket((await open(a)).html);
    await db.query("INSERT INTO app.blocked_domains (domain) VALUES ('example.com')");
    expect((await continueWith(a, ticketA)).status).toBe(403);

    const b = await newLink('https://example.org/');
    const ticketB = extractTicket((await open(b)).html);
    await db.query("UPDATE app.links SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE slug = $1", [b]);
    expect((await continueWith(b, ticketB)).status).toBe(410);
  });

  it('respeita a espera mínima configurada, validada no servidor', async () => {
    const deps = publicDeps(db, {}, { CONTINUE_MIN_WAIT_SECONDS: '5' });
    const slug = await newLink();
    const { html } = await open(slug, deps);
    expect(html).toContain('data-wait="5"');
    const ticket = extractTicket(html);
    const early = await continueWith(slug, ticket, { deps });
    expect(early.status).toBe(409);
    await db.query("UPDATE app.continuation_tickets SET created_at = now() - interval '6 seconds'");
    expect((await continueWith(slug, ticket, { deps })).status).toBe(303);
  });

  it('recusa POST de outra origem', async () => {
    const slug = await newLink();
    const ticket = extractTicket((await open(slug)).html);
    const response = await continueWith(slug, ticket, { headers: { origin: 'https://evil.example' } });
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('falha do banco na continuação devolve 503 sem redirecionar', async () => {
    const slug = await newLink();
    const ticket = extractTicket((await open(slug)).html);
    const response = await continueWith(slug, ticket, { deps: { config: publicDeps(db).config, db: failingDb() } });
    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
  });

  it('falha ao gravar métricas não impede a continuação', async () => {
    const slug = await newLink();
    const ticket = extractTicket((await open(slug)).html);
    await db.query('ALTER TABLE app.link_daily_metrics RENAME TO link_daily_metrics_off');
    try {
      const response = await continueWith(slug, ticket);
      expect(response.status).toBe(303);
    } finally {
      await db.query('ALTER TABLE app.link_daily_metrics_off RENAME TO link_daily_metrics');
    }
  });

  it('limita continuações por origem', async () => {
    const deps = publicDeps(db, {}, { RATE_LIMIT_CONTINUE_PER_IP_MINUTE: '2' });
    const slug = await newLink();
    const tickets = [];
    for (let i = 0; i < 3; i += 1) tickets.push(extractTicket((await open(slug)).html));
    expect((await continueWith(slug, tickets[0] ?? '', { deps })).status).toBe(303);
    expect((await continueWith(slug, tickets[1] ?? '', { deps })).status).toBe(303);
    const limited = await continueWith(slug, tickets[2] ?? '', { deps });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
  });
});

describe('publicidade na página intermediária', () => {
  // Em testes, só são aceitas tags simuladas servidas pela própria origem local.
  const SNIPPET = '<script src="http://localhost:8888/__mock-ads/banner.js"></script>';
  const adsEnv = { ADS_ENABLED: 'true', ADSTERRA_SLOT_PRIMARY_HTML: SNIPPET, ADS_DEV_PLACEHOLDER: 'false' };

  it('desligada por padrão: nenhuma tag é inserida', async () => {
    const slug = await newLink();
    const { html, response } = await open(slug, publicDeps(db, {}, { ADS_DEV_PLACEHOLDER: 'false' }));
    expect(html).not.toContain('__mock-ads');
    expect(response.headers.get('content-security-policy')).toContain("frame-src 'none'");
  });

  it('sem consentimento, não carrega scripts de anúncio', async () => {
    await updateSettings(db, { adsEnabled: true }, 'teste');
    const slug = await newLink();
    const { html } = await open(slug, publicDeps(db, {}, adsEnv));
    expect(html).not.toContain('__mock-ads');
    expect(html).toContain('action="/consent"');
  });

  it('com consentimento, insere a tag e libera somente sua origem na CSP', async () => {
    await updateSettings(db, { adsEnabled: true }, 'teste');
    const slug = await newLink();
    const { html, response } = await open(slug, publicDeps(db, {}, adsEnv), { cookie: 'el_ads_consent=granted' });
    expect(html).toContain('__mock-ads/banner.js');
    expect(html).toContain('Publicidade');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('http://localhost:8888');
    // O anúncio fica depois do único botão de continuar.
    expect(html.indexOf('id="continuar"')).toBeLessThan(html.indexOf('__mock-ads'));
  });

  it('consentimento recusado: sem anúncios e a navegação funciona', async () => {
    await updateSettings(db, { adsEnabled: true }, 'teste');
    const slug = await newLink();
    const deps = publicDeps(db, {}, adsEnv);
    const { html } = await open(slug, deps, { cookie: 'el_ads_consent=denied' });
    expect(html).not.toContain('__mock-ads');
    expect((await continueWith(slug, extractTicket(html), { deps })).status).toBe(303);
  });

  it('interruptor de emergência no banco desliga os anúncios imediatamente', async () => {
    await updateSettings(db, { adsEnabled: true }, 'teste');
    const slug = await newLink();
    const deps = publicDeps(db, {}, adsEnv);
    expect((await open(slug, deps, { cookie: 'el_ads_consent=granted' })).html).toContain('__mock-ads');
    await updateSettings(db, { adsEnabled: false }, 'teste');
    expect((await open(slug, deps, { cookie: 'el_ads_consent=granted' })).html).not.toContain('__mock-ads');
  });

  it('tag inválida desliga a publicidade sem derrubar a página', async () => {
    await updateSettings(db, { adsEnabled: true }, 'teste');
    const slug = await newLink();
    const deps = publicDeps(db, {}, { ADS_ENABLED: 'true', ADSTERRA_SLOT_PRIMARY_HTML: '<iframe src="https://x.example"></iframe>', ADS_DEV_PLACEHOLDER: 'false' });
    const { response, html } = await open(slug, deps, { cookie: 'el_ads_consent=granted' });
    expect(response.status).toBe(200);
    expect(html).not.toContain('<iframe');
    expect((await continueWith(slug, extractTicket(html), { deps })).status).toBe(303);
  });
});

describe('POST /consent', () => {
  const consent = (fields: Record<string, string>, headers: Record<string, string> = { origin: PUBLIC_ORIGIN }) =>
    handleConsent(formRequest(`${PUBLIC_ORIGIN}/consent`, fields, headers), requestContext(), publicDeps(db));

  it('grava a escolha e volta à página do link', async () => {
    const response = await consent({ choice: 'granted', return: '/s/ABCDEFGHJK' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/s/ABCDEFGHJK');
    expect(response.headers.get('set-cookie')).toMatch(/^el_ads_consent=granted;.*SameSite=Lax/);
  });

  it('permite revogar', async () => {
    const response = await consent({ choice: 'denied', return: '/preferencias' });
    expect(response.headers.get('set-cookie')).toContain('el_ads_consent=denied');
  });

  it('não permite redirecionamento aberto', async () => {
    for (const target of ['https://evil.example/', '//evil.example', '/s/../../x', '/\\evil.example']) {
      const response = await consent({ choice: 'granted', return: target });
      expect(response.headers.get('location')).toBe('/preferencias');
    }
  });

  it('recusa origem cruzada e escolha inválida', async () => {
    expect((await consent({ choice: 'granted' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await consent({ choice: 'talvez' })).status).toBe(400);
  });
});
