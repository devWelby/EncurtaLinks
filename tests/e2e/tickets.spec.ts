import { expect, test } from '@playwright/test';
import { DESTINATION_HOST, PUBLIC, createLink, destinationUrl, extractTicket } from './support.ts';

/**
 * Continuação: o destino vem sempre do banco, os tickets são de uso único e
 * nada que o cliente envie altera o redirecionamento.
 */

test('manipular o formulário no navegador não altera o destino', async ({ page, request }) => {
  const destination = destinationUrl('manipulacao');
  const link = await createLink(request, destination);
  await page.goto(`/s/${link.slug}`);

  await page.evaluate((slug) => {
    const form = document.getElementById('continue-form') as HTMLFormElement;
    form.action = `/s/${slug}/continue?url=http://malicioso-e2e.net/&to=http://malicioso-e2e.net/`;
    for (const name of ['url', 'destination', 'to']) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = 'http://malicioso-e2e.net/';
      form.appendChild(input);
    }
  }, link.slug);
  await page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` }).click();
  await expect(page).toHaveURL(destination);
});

test('ticket adulterado não redireciona e a página oferece nova tentativa', async ({ page, request }) => {
  const destination = destinationUrl('ticket-adulterado');
  const link = await createLink(request, destination);
  await page.goto(`/s/${link.slug}`);
  await page.locator('input[name="ticket"]').evaluate((input: HTMLInputElement) => {
    const last = input.value.at(-1) === 'A' ? 'B' : 'A';
    input.value = input.value.slice(0, -1) + last;
  });

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/s/${link.slug}/continue`)),
    page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` }).click(),
  ]);
  // 400 (formato inválido) ou 409 (ticket desconhecido): nunca 303.
  expect([400, 409]).toContain(response.status());
  await expect(page).toHaveURL(`${PUBLIC}/s/${link.slug}/continue`);
  await expect(page.getByRole('status')).toContainText('Não foi possível confirmar este acesso');

  // A página reapresentada traz um ticket novo e válido.
  await page.getByRole('button', { name: `Continuar para ${DESTINATION_HOST}` }).click();
  await expect(page).toHaveURL(destination);
});

test('ticket é de uso único, inclusive sob requisições simultâneas', async ({ request }) => {
  const destination = destinationUrl('concorrencia');
  const link = await createLink(request, destination);
  const page = await request.get(`${PUBLIC}/s/${link.slug}`);
  const ticket = extractTicket(await page.text());

  const attempts = await Promise.all(
    Array.from({ length: 6 }, () =>
      request.post(`${PUBLIC}/s/${link.slug}/continue`, { form: { ticket }, maxRedirects: 0, headers: { origin: PUBLIC } }),
    ),
  );
  const statuses = attempts.map((r) => r.status()).sort();
  expect(statuses.filter((s) => s === 303)).toHaveLength(1);
  expect(statuses.filter((s) => s === 409)).toHaveLength(5);
  const winner = attempts.find((r) => r.status() === 303);
  expect(winner?.headers().location).toBe(destination);
  expect(winner?.headers()['cache-control']).toContain('no-store');

  const replay = await request.post(`${PUBLIC}/s/${link.slug}/continue`, { form: { ticket }, maxRedirects: 0, headers: { origin: PUBLIC } });
  expect(replay.status()).toBe(409);
  expect(await replay.text()).toContain('Este acesso já foi utilizado');
});

test('ticket de outro link não é aceito', async ({ request }) => {
  const first = await createLink(request, destinationUrl('ticket-a'));
  const second = await createLink(request, destinationUrl('ticket-b'));
  const ticket = extractTicket(await (await request.get(`${PUBLIC}/s/${first.slug}`)).text());
  const response = await request.post(`${PUBLIC}/s/${second.slug}/continue`, { form: { ticket }, maxRedirects: 0, headers: { origin: PUBLIC } });
  expect(response.status()).not.toBe(303);
  expect(response.headers().location).toBeUndefined();
});

test('estados de link: inexistente, código inválido e GET na continuação', async ({ page }) => {
  const missing = await page.goto('/s/AAAAAAAAAA');
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Link não encontrado');

  const invalid = await page.goto('/s/curto');
  expect(invalid?.status()).toBe(404);

  const getContinue = await page.goto('/s/AAAAAAAAAA/continue');
  expect(getContinue?.status()).toBe(405);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Método não permitido');
});
