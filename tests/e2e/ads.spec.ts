import { expect, test, type BrowserContext } from '@playwright/test';
import { DESTINATION_HOST, PUBLIC, adminLogin, createLink, destinationUrl, type AdminClient } from './support.ts';

/**
 * Publicidade SIMULADA (scripts locais; nunca anúncios reais em testes):
 * o espaço primário carrega um banner falso e o secundário aponta para um
 * script que responde 503 (provedor fora do ar).
 */
test.describe.configure({ mode: 'serial' });

let admin: AdminClient;
let disposeAdmin: () => Promise<void>;

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext();
  disposeAdmin = () => api.dispose();
  admin = await adminLogin(api);
  await admin.setSettings({ adsEnabled: true });
});

test.afterAll(async () => {
  await admin.setSettings({ adsEnabled: false });
  await disposeAdmin();
});

function grantConsent(context: BrowserContext): Promise<void> {
  return context.addCookies([{ name: 'el_ads_consent', value: 'granted', url: PUBLIC }]);
}

test('pede consentimento e não carrega scripts de anúncio antes da permissão', async ({ page, request }) => {
  const adRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/__mock-ads/')) adRequests.push(r.url());
  });
  const link = await createLink(request, destinationUrl('consentimento'));
  await page.goto(`/s/${link.slug}`);

  const area = page.getByRole('complementary', { name: 'Publicidade' });
  await expect(area).toBeVisible();
  await expect(area.getByRole('button', { name: 'Permitir anúncios' })).toBeVisible();
  await expect(area.getByRole('button', { name: 'Não permitir' })).toBeVisible();
  await expect(page.locator('[data-ad-slot]')).toHaveCount(0);
  expect(adRequests).toEqual([]);
});

test('com permissão: banner identificado abaixo do botão, provedor com falha não quebra a página', async ({ page, request }) => {
  const destination = destinationUrl('anuncios');
  const link = await createLink(request, destination);
  await page.goto(`/s/${link.slug}`);
  await page.getByRole('button', { name: 'Permitir anúncios' }).click();
  await expect(page).toHaveURL(`${PUBLIC}/s/${link.slug}`);

  const area = page.getByRole('complementary', { name: 'Publicidade' });
  await expect(area.getByText('Publicidade', { exact: true })).toBeVisible();
  await expect(page.locator('[data-ad-slot="primary"] [data-mock-ad="banner"]')).toBeVisible();
  // O script do espaço secundário falha (503): o espaço é recolhido após o tempo limite.
  await expect(page.locator('[data-ad-slot="secondary"]')).toHaveClass(/ad-slot--empty/, { timeout: 15_000 });
  await expect(page.locator('[data-ad-slot="primary"]')).not.toHaveClass(/ad-slot--empty/);

  // Anúncios ficam depois do botão de continuar (nunca no lugar dele).
  const continueButton = page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` });
  const adsAfterButton = await continueButton.evaluate((button) => {
    const ads = document.querySelector('.ad-area');
    return ads !== null && Boolean(button.compareDocumentPosition(ads) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(adsAfterButton).toBe(true);
  // Um único botão de continuar na página.
  await expect(page.getByRole('button', { name: /Continuar/ })).toHaveCount(1);

  await continueButton.click();
  await expect(page).toHaveURL(destination);
});

test('recusa do consentimento: nenhum script de anúncio e acesso normal', async ({ page, request }) => {
  const adRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/__mock-ads/')) adRequests.push(r.url());
  });
  const destination = destinationUrl('recusa');
  const link = await createLink(request, destination);
  await page.goto(`/s/${link.slug}`);
  await page.getByRole('button', { name: 'Não permitir' }).click();
  await expect(page.getByText('Você optou por não ver anúncios.')).toBeVisible();
  await expect(page.locator('[data-ad-slot]')).toHaveCount(0);

  await page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` }).click();
  await expect(page).toHaveURL(destination);
  expect(adRequests).toEqual([]);
});

test('bloqueador de anúncios: espaços recolhidos e continuação funcionando', async ({ page, context, request }) => {
  await grantConsent(context);
  await page.route('**/__mock-ads/**', (route) => route.abort('blockedbyclient'));
  const destination = destinationUrl('bloqueador');
  const link = await createLink(request, destination);
  await page.goto(`/s/${link.slug}`);

  await expect(page.locator('[data-ad-slot="primary"]')).toHaveClass(/ad-slot--empty/, { timeout: 15_000 });
  await expect(page.locator('[data-ad-slot="secondary"]')).toHaveClass(/ad-slot--empty/);
  await page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` }).click();
  await expect(page).toHaveURL(destination);
});

test('preferências: revogar a permissão remove os anúncios', async ({ page, context, request }) => {
  await grantConsent(context);
  const link = await createLink(request, destinationUrl('revogacao'));
  await page.goto('/preferencias');
  await expect(page.getByRole('status')).toContainText('Anúncios permitidos');
  await page.getByRole('button', { name: 'Recusar anúncios' }).click();
  await expect(page.getByRole('status')).toContainText('Anúncios recusados');

  await page.goto(`/s/${link.slug}`);
  await expect(page.getByText('Você optou por não ver anúncios.')).toBeVisible();
  await expect(page.locator('[data-ad-slot]')).toHaveCount(0);
});

test('interruptor de emergência no painel retira os anúncios sem novo deploy', async ({ page, context, request }) => {
  await grantConsent(context);
  const link = await createLink(request, destinationUrl('interruptor'));
  const before = await page.goto(`/s/${link.slug}`);
  await expect(page.locator('[data-ad-slot]')).toHaveCount(2);
  expect(before?.headers()['content-security-policy']).toContain('http://localhost:8898');

  await admin.setSettings({ adsEnabled: false });
  const after = await page.goto(`/s/${link.slug}`);
  await expect(page.locator('.ad-area')).toHaveCount(0);
  // Sem anúncios, a CSP volta a permitir apenas o script inline com nonce.
  expect(after?.headers()['content-security-policy']).not.toContain('http://localhost:8898');
  await admin.setSettings({ adsEnabled: true });
});
