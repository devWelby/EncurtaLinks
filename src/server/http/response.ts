import type { HttpError } from './errors.ts';

/** Cabeçalhos de segurança aplicados a todas as respostas das funções. */
export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'Strict-Transport-Security': 'max-age=31536000',
};

const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

function withBase(headers: Record<string, string>): Headers {
  const result = new Headers(BASE_SECURITY_HEADERS);
  for (const [key, value] of Object.entries(headers)) result.set(key, value);
  return result;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withBase({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': API_CSP,
      ...headers,
    }),
  });
}

export function errorJson(error: HttpError): Response {
  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    },
  };
  return jsonResponse(error.status, body, error.headers);
}

export function htmlResponse(status: number, html: string, options: { csp: string; headers?: Record<string, string> }): Response {
  return new Response(html, {
    status,
    headers: withBase({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': options.csp,
      ...(options.headers ?? {}),
    }),
  });
}

/** Redirecionamento temporário. Use 303 após POST. Nunca 301/308 para links revogáveis. */
export function redirectResponse(status: 302 | 303, location: string, headers: Record<string, string> = {}): Response {
  if (/[\r\n]/.test(location)) throw new Error('Location inválido');
  return new Response(null, {
    status,
    headers: withBase({ Location: location, 'Cache-Control': 'no-store', 'Content-Security-Policy': API_CSP, ...headers }),
  });
}

export function noContent(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 204, headers: withBase({ 'Cache-Control': 'no-store', ...headers }) });
}
