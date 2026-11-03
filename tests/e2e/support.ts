import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import type { AdminSessionResponse, AdminSettings, CreateLinkResponse } from '../../src/shared/api.ts';

/** Origens do ambiente E2E (scripts/e2e-server.ts). Hosts diferentes isolam os cookies. */
export const PUBLIC = 'http://localhost:8898';
export const ADMIN = 'http://127.0.0.1:8899';
/** Domínio de destino simulado: o navegador o resolve para 127.0.0.1:8897 (playwright.config.ts). */
export const DESTINATION_HOST = 'www.destino-e2e.com.br';
export const DESTINATION_ORIGIN = `http://${DESTINATION_HOST}`;
export const TEST_ANTIBOT_TOKEN = 'test-antibot-pass';

let sequence = 0;

/** URL de destino única (evita depender da ordem dos testes). */
export function destinationUrl(label: string): string {
  sequence += 1;
  return `${DESTINATION_ORIGIN}/${label}?n=${Date.now()}${sequence}`;
}

export async function createLink(request: APIRequestContext, url: string): Promise<CreateLinkResponse> {
  const response = await request.post(`${PUBLIC}/api/links`, {
    headers: { origin: PUBLIC },
    data: { url, turnstileToken: TEST_ANTIBOT_TOKEN },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as CreateLinkResponse;
}

/** Extrai o ticket do formulário de continuação da página intermediária. */
export function extractTicket(html: string): string {
  const match = /name="ticket" value="([^"]+)"/.exec(html);
  if (match?.[1] === undefined) throw new Error('ticket não encontrado na página intermediária');
  return match[1];
}

/** Registra todas as origens requisitadas pela página (para provar o isolamento de rede). */
export function trackOrigins(page: Page): Set<string> {
  const origins = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
  });
  return origins;
}

export interface AdminClient {
  cookie: string;
  csrfToken: string;
  get: (path: string) => Promise<APIResponse>;
  post: (path: string, body: unknown) => Promise<APIResponse>;
  setSettings: (settings: Partial<AdminSettings>) => Promise<AdminSettings>;
}

/**
 * Sessão administrativa pelo login LOCAL (/__dev/admin-login, existente só no
 * emulador). O cookie é enviado explicitamente para não depender do
 * armazenamento de cookies do cliente HTTP do Playwright.
 */
export async function adminLogin(request: APIRequestContext): Promise<AdminClient> {
  const login = await request.get(`${ADMIN}/__dev/admin-login`, { maxRedirects: 0 });
  expect(login.status()).toBe(303);
  const setCookie = login.headersArray().find((header) => header.name.toLowerCase() === 'set-cookie')?.value ?? '';
  const cookie = setCookie.split(';')[0] ?? '';
  expect(cookie).toMatch(/^__Host-el_admin=/);
  const session = await request.get(`${ADMIN}/api/admin/session`, { headers: { cookie } });
  expect(session.status()).toBe(200);
  const { csrfToken } = (await session.json()) as AdminSessionResponse;

  const post = (path: string, body: unknown): Promise<APIResponse> =>
    request.post(`${ADMIN}/api/admin/${path}`, { headers: { cookie, origin: ADMIN, 'x-csrf-token': csrfToken }, data: body });

  return {
    cookie,
    csrfToken,
    get: (path) => request.get(`${ADMIN}/api/admin/${path}`, { headers: { cookie } }),
    post,
    setSettings: async (settings) => {
      const response = await post('settings', settings);
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()) as AdminSettings;
    },
  };
}
