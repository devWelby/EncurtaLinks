import { CONSENT_COOKIE } from '../../shared/constants.ts';
import { isValidSlug } from '../../shared/slug.ts';
import { HttpError } from '../http/errors.ts';
import { readForm, serializeCookie } from '../http/request.ts';
import { errorJson, redirectResponse } from '../http/response.ts';
import type { PublicDeps, RequestContext } from './context.ts';

const CONSENT_MAX_AGE = 180 * 86_400;

/** Somente caminhos internos conhecidos (evita redirecionamento aberto). */
function safeReturnPath(value: string | null): string {
  if (value === '/preferencias') return value;
  const match = /^\/s\/([^/?#]+)$/.exec(value ?? '');
  if (match?.[1] !== undefined && isValidSlug(match[1])) return `/s/${match[1]}`;
  return '/preferencias';
}

/**
 * POST /consent — registra a preferência de publicidade num cookie primário
 * (não é segredo; fica legível pela página de preferências). Funciona sem JS.
 */
export async function handleConsent(req: Request, _ctx: RequestContext, deps: PublicDeps): Promise<Response> {
  if (req.method !== 'POST') return errorJson(new HttpError(405, 'method_not_allowed', 'Método não permitido.', { headers: { Allow: 'POST' } }));
  const requestUrl = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin !== null && origin !== requestUrl.origin) {
    return errorJson(new HttpError(403, 'bad_origin', 'Origem da requisição não permitida.'));
  }
  let form: URLSearchParams;
  try {
    form = await readForm(req, 1024);
  } catch (error) {
    if (error instanceof HttpError) return errorJson(error);
    throw error;
  }
  const choice = form.get('choice');
  const returnPath = safeReturnPath(form.get('return'));
  if (choice !== 'granted' && choice !== 'denied') {
    return errorJson(new HttpError(400, 'invalid_choice', 'Escolha inválida.'));
  }
  const cookie = serializeCookie(CONSENT_COOKIE, choice, {
    maxAgeSeconds: CONSENT_MAX_AGE,
    httpOnly: false,
    secure: deps.config.isProduction || requestUrl.protocol === 'https:' || requestUrl.hostname === 'localhost',
    sameSite: 'Lax',
  });
  return redirectResponse(303, returnPath, { 'Set-Cookie': cookie });
}
