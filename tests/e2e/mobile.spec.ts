import { expect, test, type Page } from '@playwright/test';
import { ADMIN, DESTINATION_HOST, createLink, destinationUrl } from './support.ts';

/** Telas pequenas (projeto "mobile": Pixel 5, toque). */

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('páginas públicas cabem na largura do celular', async ({ page }) => {
  for (const path of ['/', '/denunciar', '/termos', '/privacidade', '/preferencias', '/pagina-inexistente']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test('página intermediária no celular: botão visível sem rolar e toque continua', async ({ page, request }) => {
  const destination = destinationUrl('celular');
  const link = await createLink(request, destination);
  await page.goto(`/s/${link.slug}`);
  await expectNoHorizontalScroll(page);
  const button = page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` });
  await expect(button).toBeInViewport();
  const box = await button.boundingBox();
  // Alvo de toque confortável (≥ 44 px de altura).
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await button.tap();
  await expect(page).toHaveURL(destination);
});

test('painel no celular: login e tabela sem estourar a largura da página', async ({ page }) => {
  await page.goto(`${ADMIN}/`);
  await expectNoHorizontalScroll(page);
  await page.goto(`${ADMIN}/__dev/admin-login`);
  await expect(page.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Seções do painel' }).getByRole('link', { name: 'Links' }).tap();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Links');
  await expectNoHorizontalScroll(page);
});
