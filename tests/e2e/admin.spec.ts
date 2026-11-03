import { expect, test, type Page } from '@playwright/test';
import { ADMIN, DESTINATION_HOST, PUBLIC, adminLogin, createLink, destinationUrl, trackOrigins } from './support.ts';

/** Painel administrativo: autenticação, CSRF, isolamento e moderação. */

async function loginInBrowser(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/__dev/admin-login`);
  await expect(page).toHaveURL(`${ADMIN}/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible();
}

test('sem sessão: o painel mostra apenas o login e a API responde 401', async ({ page, request }) => {
  await page.goto(`${ADMIN}/links`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Painel do EncurtaLinks');
  await expect(page.getByRole('link', { name: 'Entrar com GitHub' })).toHaveAttribute('href', '/auth/github/start');

  expect((await request.get(`${ADMIN}/api/admin/session`)).status()).toBe(401);
  expect((await request.get(`${ADMIN}/api/admin/links`)).status()).toBe(401);
  const mutation = await request.post(`${ADMIN}/api/admin/settings`, { headers: { origin: ADMIN }, data: { linkCreationEnabled: false } });
  expect([401, 403]).toContain(mutation.status());
  // Cookie forjado também é recusado.
  const forged = await request.get(`${ADMIN}/api/admin/session`, { headers: { cookie: '__Host-el_admin=forjado' } });
  expect(forged.status()).toBe(401);
});

test('mutações exigem token CSRF e Origin do próprio painel', async ({ request }) => {
  const admin = await adminLogin(request);
  const url = `${ADMIN}/api/admin/settings`;
  const body = { linkCreationEnabled: true };
  const cases: Array<[string, Record<string, string>]> = [
    ['sem token CSRF', { cookie: admin.cookie, origin: ADMIN }],
    ['token CSRF errado', { cookie: admin.cookie, origin: ADMIN, 'x-csrf-token': 'x'.repeat(43) }],
    ['Origin do site público', { cookie: admin.cookie, origin: PUBLIC, 'x-csrf-token': admin.csrfToken }],
    ['sem Origin', { cookie: admin.cookie, 'x-csrf-token': admin.csrfToken }],
    ['requisição entre sites', { cookie: admin.cookie, origin: ADMIN, 'x-csrf-token': admin.csrfToken, 'sec-fetch-site': 'cross-site' }],
  ];
  for (const [label, headers] of cases) {
    const response = await request.post(url, { headers, data: body });
    expect(response.status(), label).toBe(403);
  }
  expect((await admin.post('settings', body)).status()).toBe(200);
});

test('hostname alternativo não acessa a API do painel, mesmo com cookie válido', async ({ request }) => {
  const admin = await adminLogin(request);
  const alternate = await request.get('http://localhost:8899/api/admin/session', { headers: { cookie: admin.cookie } });
  expect(alternate.status()).toBe(404);
  // O site público não expõe nenhuma rota administrativa.
  const onPublic = await request.get(`${PUBLIC}/api/admin/session`, { headers: { cookie: admin.cookie } });
  expect(onPublic.status()).toBe(404);
  expect(onPublic.headers()['content-type']).toContain('application/json');
});

test('isolamento: painel sem scripts de terceiros, CSP estrita e cookie restrito ao host', async ({ page, context }) => {
  const origins = trackOrigins(page);
  await loginInBrowser(page);
  for (const section of ['Links', 'Denúncias', 'Domínios bloqueados', 'Configurações', 'Termos e privacidade', 'Auditoria']) {
    await page.getByRole('navigation', { name: 'Seções do painel' }).getByRole('link', { name: section }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect([...origins]).toEqual([ADMIN]);
  await expect(page.locator('script[src]:not([src^="/"])')).toHaveCount(0);

  const index = await page.request.get(`${ADMIN}/`);
  const csp = index.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(index.headers()['x-robots-tag']).toContain('noindex');

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === '__Host-el_admin');
  expect(session).toMatchObject({ domain: '127.0.0.1', path: '/', httpOnly: true, secure: true, sameSite: 'Strict' });
  expect(await context.cookies(PUBLIC)).toEqual([]);
  // Nenhum token administrativo no armazenamento do navegador.
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).toBe('{"local":{},"session":{}}');
});

test('bloquear pela interface: o link passa a mostrar a página de bloqueio', async ({ page, request, browser }) => {
  const link = await createLink(request, destinationUrl('bloqueio-ui'));
  await loginInBrowser(page);
  await page.getByRole('navigation', { name: 'Seções do painel' }).getByRole('link', { name: 'Links' }).click();
  await page.getByLabel('Buscar por código ou domínio').fill(link.slug);
  await page.getByRole('button', { name: 'Buscar' }).click();
  const row = page.getByRole('row').filter({ hasText: link.slug });
  await expect(row).toHaveCount(1);

  page.on('dialog', (dialog) => void (dialog.type() === 'prompt' ? dialog.accept('teste E2E') : dialog.accept()));
  await row.getByRole('button', { name: 'Bloquear' }).click();
  await expect(page.getByText(`Link ${link.slug}: ação "Bloquear" concluída.`)).toBeVisible();
  await expect(row.getByText('Motivo: teste E2E')).toBeVisible();

  const visitor = await browser.newPage();
  const response = await visitor.goto(`${PUBLIC}/s/${link.slug}`);
  expect(response?.status()).toBe(403);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Este link foi bloqueado');
  await visitor.close();
});

test('bloqueio aplicado depois da abertura da página intermediária impede a continuação', async ({ page, request }) => {
  const admin = await adminLogin(request);
  const link = await createLink(request, destinationUrl('bloqueio-tardio'));
  await page.goto(`${PUBLIC}/s/${link.slug}`);
  await expect(page.locator('[data-destination-host]')).toHaveText(DESTINATION_HOST);

  const blocked = await admin.post(`links/${link.slug}/block`, { reason: 'bloqueio durante a visita' });
  expect(blocked.status()).toBe(200);

  await page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Este link foi bloqueado');
  expect(new URL(page.url()).origin).toBe(PUBLIC);
});

test('desligar a criação de links no painel impede novas criações', async ({ page, request, playwright }) => {
  const api = await playwright.request.newContext();
  const admin = await adminLogin(api);
  try {
    await loginInBrowser(page);
    await page.getByRole('navigation', { name: 'Seções do painel' }).getByRole('link', { name: 'Configurações' }).click();
    const toggle = page.getByRole('checkbox', { name: /Criação de links/ });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(page.getByText('Configuração salva.')).toBeVisible();
    await expect(page.getByText('Criação de links — desligado')).toBeVisible();

    const response = await request.post(`${PUBLIC}/api/links`, {
      headers: { origin: PUBLIC },
      data: { url: destinationUrl('criacao-desligada'), turnstileToken: 'test-antibot-pass' },
    });
    expect(response.status()).toBe(503);

    await toggle.check();
    await expect(page.getByText('Criação de links — ligado')).toBeVisible();
    await createLink(request, destinationUrl('criacao-religada'));
  } finally {
    // Nunca deixa a criação desligada para os testes seguintes.
    await admin.setSettings({ linkCreationEnabled: true });
    await api.dispose();
  }
});

test('sair encerra a sessão no servidor', async ({ page, context }) => {
  await loginInBrowser(page);
  const cookie = (await context.cookies()).find((c) => c.name === '__Host-el_admin');
  expect(cookie).toBeDefined();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Painel do EncurtaLinks');

  const reuse = await page.request.get(`${ADMIN}/api/admin/session`, { headers: { cookie: `${cookie?.name}=${cookie?.value}` } });
  expect(reuse.status()).toBe(401);
});
