import { expect, test, type Locator, type Page } from '@playwright/test';
import { DESTINATION_HOST, PUBLIC, createLink, destinationUrl } from './support.ts';

/** Navegação apenas pelo teclado, com foco visível. */

async function tabUntil(page: Page, target: Locator, maxPresses = 25): Promise<void> {
  for (let i = 0; i < maxPresses; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function expectVisibleFocus(target: Locator): Promise<void> {
  const outline = await target.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThan(0);
}

test('criar e copiar um link somente com o teclado', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PUBLIC });
  await page.goto('/');

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Pular para o conteúdo' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();

  const field = page.getByLabel('Endereço (URL) a encurtar');
  await tabUntil(page, field);
  await page.keyboard.type(destinationUrl('teclado'));
  const submit = page.getByRole('button', { name: 'Encurtar link' });
  await tabUntil(page, submit);
  await expectVisibleFocus(submit);
  await page.keyboard.press('Enter');

  const result = page.getByLabel('Link curto', { exact: true });
  await expect(result).toBeFocused();
  const copy = page.getByRole('button', { name: 'Copiar link' });
  await tabUntil(page, copy);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Copiado!' })).toBeVisible();
});

test('página intermediária: pular para o conteúdo e continuar pelo teclado', async ({ page, request }) => {
  const destination = destinationUrl('teclado-continuar');
  const link = await createLink(request, destination);
  await page.goto(`/s/${link.slug}`);

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
  const button = page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` });
  await tabUntil(page, button);
  await expectVisibleFocus(button);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(destination);
});

test('painel: a navegação por seções funciona pelo teclado', async ({ page }) => {
  await page.goto('http://127.0.0.1:8899/__dev/admin-login');
  await expect(page.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible();
  const linksTab = page.getByRole('navigation', { name: 'Seções do painel' }).getByRole('link', { name: 'Links' });
  await tabUntil(page, linksTab);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Links');
  await expect(linksTab).toHaveAttribute('aria-current', 'page');
});
