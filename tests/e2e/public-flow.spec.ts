import { expect, test } from '@playwright/test';
import { DESTINATION_HOST, DESTINATION_ORIGIN, PUBLIC, createLink, destinationUrl, trackOrigins } from './support.ts';

/**
 * Fluxo principal do visitante: criar, copiar, abrir a página intermediária e
 * continuar até o destino. Roda nos projetos desktop e móvel.
 */

test('cria um link pela interface, copia e continua até o destino', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PUBLIC });
  const origins = trackOrigins(page);
  const destination = destinationUrl('fluxo-completo');

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Encurte um link, de graça');
  await page.getByLabel('Endereço (URL) a encurtar').fill(destination);
  await page.getByRole('button', { name: 'Encurtar link' }).click();

  const result = page.getByLabel('Link curto', { exact: true });
  await expect(result).toHaveValue(/^http:\/\/localhost:8898\/s\/[A-Za-z0-9_-]{10,}$/);
  await expect(result).toBeFocused();
  await expect(page.getByText(`Destino: ${DESTINATION_HOST}`)).toBeVisible();
  const shortUrl = await result.inputValue();

  await page.getByRole('button', { name: 'Copiar link' }).click();
  await expect(page.getByRole('button', { name: 'Copiado!' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shortUrl);

  const view = await page.goto(shortUrl);
  expect(view?.status()).toBe(200);
  expect(view?.headers()['cache-control']).toContain('no-store');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Você está saindo do EncurtaLinks');
  await expect(page.locator('[data-destination-host]')).toHaveText(DESTINATION_HOST);
  // Anúncios desligados por padrão: nenhuma área de publicidade.
  await expect(page.locator('.ad-area')).toHaveCount(0);

  await page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` }).click();
  await expect(page).toHaveURL(destination);
  await expect(page.getByRole('heading', { name: 'Destino simulado' })).toBeVisible();

  // Nada além do site público e do destino simulado foi requisitado.
  expect([...origins].sort()).toEqual([DESTINATION_ORIGIN, PUBLIC].sort());
});

test('a interface recusa endereços inválidos, privados e laços', async ({ page }) => {
  await page.goto('/');
  const field = page.getByLabel('Endereço (URL) a encurtar');
  const submit = page.getByRole('button', { name: 'Encurtar link' });

  for (const value of ['javascript:alert(1)', 'ftp://arquivos.destino-e2e.com.br/x', 'http://192.168.0.10/painel', 'http://[::1]/', `${PUBLIC}/s/AAAAAAAAAA`]) {
    await field.fill(value);
    await submit.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('Link curto', { exact: true })).toHaveCount(0);
    await expect(field).toBeFocused();
  }
});

test('conteúdo malicioso no destino é exibido como texto, sem executar scripts', async ({ page, request }) => {
  let dialogs = 0;
  page.on('dialog', (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });
  const link = await createLink(request, `${DESTINATION_ORIGIN}/x?q="><img/src=x/onerror=alert(1)><script>alert(2)</script>`);
  await page.goto(`/s/${link.slug}`);
  await page.getByText('Ver endereço completo').click();
  await expect(page.locator('.full-url')).toContainText(DESTINATION_HOST);
  await expect(page.locator('.full-url img, .full-url script')).toHaveCount(0);
  expect(dialogs).toBe(0);
});
