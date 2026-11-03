import { expect, test } from '@playwright/test';
import { ADMIN, DESTINATION_HOST, PUBLIC, adminLogin, createLink, destinationUrl } from './support.ts';

/** Rotas diretas, fallback da SPA e persistência após um novo deploy. */

test('rotas diretas do site público carregam a página certa (200)', async ({ page }) => {
  const routes: Array<[string, RegExp]> = [
    ['/', /Encurte um link/],
    ['/denunciar', /Denunciar um link/],
    ['/termos', /Termos/],
    ['/privacidade', /Privacidade/i],
    ['/preferencias', /Preferências de anúncios/],
  ];
  for (const [path, heading] of routes) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveText(heading);
  }
});

test('fallback: páginas inexistentes dão 404 e não capturam API nem links curtos', async ({ request, page }) => {
  const missing = await page.goto('/pagina-que-nao-existe');
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Página não encontrada');

  const api = await request.get(`${PUBLIC}/api/rota-inexistente`);
  expect(api.status()).toBe(404);
  expect(api.headers()['content-type']).toContain('application/json');

  // /s/* é sempre tratado pela função (nunca devolve o index.html da SPA).
  const short = await request.get(`${PUBLIC}/s/AAAAAAAAAA`);
  expect(short.status()).toBe(404);
  expect(await short.text()).toContain('Link não encontrado');

  // Rotas de API exigem os métodos corretos.
  expect((await request.get(`${PUBLIC}/api/links`)).status()).toBe(405);
});

test('rotas diretas do painel servem a SPA; desconhecidas dão 404', async ({ request }) => {
  for (const path of ['/', '/links', '/denuncias', '/dominios', '/configuracoes', '/documentos', '/auditoria']) {
    const response = await request.get(`${ADMIN}${path}`);
    expect(response.status(), path).toBe(200);
    expect(await response.text(), path).toContain('<div id="root">');
  }
  const missing = await request.get(`${ADMIN}/nao-existe`);
  expect(missing.status()).toBe(404);
  const api = await request.get(`${ADMIN}/api/nao-existe`);
  expect(api.status()).toBe(404);
});

test('links e sessões persistem após um novo deploy das funções', async ({ request, page }) => {
  const destination = destinationUrl('redeploy');
  const link = await createLink(request, destination);
  const admin = await adminLogin(request);

  // Recarrega os módulos das funções e descarta pools e caches (como um deploy novo).
  const redeploy = await request.post(`${PUBLIC}/__e2e/redeploy`);
  expect(redeploy.status()).toBe(204);

  const session = await admin.get('session');
  expect(session.status()).toBe(200);
  const search = await admin.get(`links?q=${link.slug}`);
  expect(await search.text()).toContain(link.slug);

  await page.goto(`/s/${link.slug}`);
  await expect(page.locator('[data-destination-host]')).toHaveText(DESTINATION_HOST);
  await page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` }).click();
  await expect(page).toHaveURL(destination);
});
