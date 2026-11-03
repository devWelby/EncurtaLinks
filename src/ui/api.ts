import type { ApiError } from '../shared/api.ts';

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string; retryAfterSeconds?: number };

/**
 * Chamada JSON para a API da mesma origem. Sem CORS e sem tokens em
 * armazenamento do navegador: o painel usa cookie HttpOnly + token CSRF em memória.
 */
export async function apiRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; csrfToken?: string; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.csrfToken) headers['X-CSRF-Token'] = options.csrfToken;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return { ok: false, status: 0, code: 'network_error', message: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.' };
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text !== '') {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (response.ok) return { ok: true, status: response.status, data: payload as T };

  const error = (payload as Partial<ApiError> | null)?.error;
  const retryHeader = Number(response.headers.get('Retry-After'));
  const retryAfterSeconds = error?.retryAfterSeconds ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined);
  return {
    ok: false,
    status: response.status,
    code: error?.code ?? 'http_error',
    message: error?.message ?? 'Não foi possível concluir a operação. Tente novamente.',
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}
