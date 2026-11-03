import { createSession, revokeSession, validateSession, type AdminSession } from '../domain/sessions.ts';
import { writeAudit } from '../domain/audit.ts';
import { Errors, HttpError } from '../http/errors.ts';
import { parseCookies, serializeCookie } from '../http/request.ts';
import { errorJson, noContent, redirectResponse } from '../http/response.ts';
import { completeAuthorization, createAuthorizationRequest, GITHUB_AS, OAuthCallbackError } from '../integrations/github-oauth.ts';
import { errorKind, logger } from '../logger.ts';
import { safeEqual } from '../security/crypto.ts';
import { checkRateLimits } from '../security/rate-limit.ts';
import { clientIpHash, rateLimitSubject, type AdminDeps, type RequestContext } from './context.ts';

/**
 * Cookies administrativos:
 *  - prefixo __Host-: exige Secure, Path=/ e proíbe Domain (fica restrito ao
 *    host exato do painel; não é enviado ao site público nem a subdomínios);
 *  - HttpOnly: inacessível a JavaScript;
 *  - SameSite=Strict na sessão; Lax no cookie temporário do OAuth (precisa
 *    voltar no redirecionamento vindo do github.com).
 */
export const SESSION_COOKIE = '__Host-el_admin';
const OAUTH_COOKIE = '__Host-el_oauth';

export interface AuthenticatedAdmin {
  token: string;
  session: AdminSession;
}

/** Garante que a requisição chegou pelo endereço oficial do painel (bloqueia URLs alternativas de deploy). */
export function assertAdminHost(req: Request, deps: AdminDeps): void {
  if (new URL(req.url).origin !== deps.config.adminSiteUrl.origin) throw Errors.notFound();
}

function isAllowed(deps: AdminDeps, githubId: number): boolean {
  const github = deps.config.github;
  // Sem GitHub configurado: aceita apenas sessões do ambiente local de desenvolvimento/testes.
  if (github === null) return deps.config.allowTestModes;
  return github.allowedUserIds.has(githubId);
}

/**
 * Autorização de toda rota administrativa (no servidor):
 * host oficial → Sec-Fetch-Site → cookie de sessão válido → administrador
 * ainda autorizado → (métodos que alteram estado) Origin + token CSRF.
 */
export async function requireAdmin(req: Request, deps: AdminDeps): Promise<AuthenticatedAdmin> {
  assertAdminHost(req, deps);
  const site = req.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') throw Errors.forbidden('Requisição entre sites não permitida.', 'bad_origin');

  const token = parseCookies(req.headers.get('cookie')).get(SESSION_COOKIE);
  if (token === undefined) throw Errors.unauthorized();
  const session = await validateSession(deps.db, token, deps.config.session.idleTimeoutSeconds);
  if (session === null) throw Errors.unauthorized();
  if (!isAllowed(deps, session.githubId)) {
    await revokeSession(deps.db, token);
    throw Errors.unauthorized();
  }

  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafe) {
    if (req.headers.get('origin') !== deps.config.adminSiteUrl.origin) throw Errors.forbidden('Origem da requisição não permitida.', 'bad_origin');
    const csrf = req.headers.get('x-csrf-token') ?? '';
    if (!safeEqual(csrf, session.csrfToken)) throw Errors.forbidden('Token CSRF inválido. Recarregue a página.', 'bad_csrf');
  }
  return { token, session };
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds, httpOnly: true, secure: true, sameSite: 'Strict' });
}

function clearCookie(name: string, sameSite: 'Strict' | 'Lax'): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, httpOnly: true, secure: true, sameSite });
}

async function limitAuth(ctx: RequestContext, deps: AdminDeps): Promise<void> {
  const subject = rateLimitSubject(clientIpHash(deps.config.ipHashSecret, ctx.clientIp));
  const limit = await checkRateLimits(deps.db, [
    { name: 'admin-auth:ip:10m', subject, limit: deps.config.rateLimits.authPerIp10Min, windowSeconds: 600 },
  ]);
  if (!limit.allowed) throw Errors.rateLimited(limit.retryAfterSeconds);
}

function loginRedirect(deps: AdminDeps, errorCode: string | null): Response {
  const target = new URL('/', deps.config.adminSiteUrl);
  if (errorCode !== null) target.searchParams.set('erro', errorCode);
  const response = redirectResponse(303, target.toString());
  response.headers.append('Set-Cookie', clearCookie(OAUTH_COOKIE, 'Lax'));
  return response;
}

/** GET /auth/github/start */
export async function handleAuthStart(req: Request, ctx: RequestContext, deps: AdminDeps): Promise<Response> {
  try {
    if (req.method !== 'GET') throw Errors.methodNotAllowed(['GET']);
    assertAdminHost(req, deps);
    await limitAuth(ctx, deps);
    const github = deps.config.github;
    if (github === null) throw Errors.unavailable('Login com GitHub não configurado.', 'login_not_configured');
    const request = await createAuthorizationRequest({
      clientId: github.clientId,
      clientSecret: github.clientSecret,
      redirectUri: new URL('/auth/github/callback', deps.config.adminSiteUrl).toString(),
    });
    const response = redirectResponse(302, request.url.toString());
    response.headers.append(
      'Set-Cookie',
      serializeCookie(OAUTH_COOKIE, `${request.state}.${request.codeVerifier}`, { maxAgeSeconds: 600, httpOnly: true, secure: true, sameSite: 'Lax' }),
    );
    return response;
  } catch (error) {
    if (error instanceof HttpError) return errorJson(error);
    logger.error('auth_start_failed', { requestId: ctx.requestId, kind: errorKind(error) });
    return errorJson(Errors.unavailable());
  }
}

/** GET /auth/github/callback */
export async function handleAuthCallback(req: Request, ctx: RequestContext, deps: AdminDeps): Promise<Response> {
  try {
    if (req.method !== 'GET') throw Errors.methodNotAllowed(['GET']);
    assertAdminHost(req, deps);
    await limitAuth(ctx, deps);
    const github = deps.config.github;
    if (github === null) return loginRedirect(deps, 'nao_configurado');

    const stored = parseCookies(req.headers.get('cookie')).get(OAUTH_COOKIE) ?? '';
    const [state, codeVerifier] = stored.split('.');
    if (!state || !codeVerifier) return loginRedirect(deps, 'sessao_expirada');

    let identity;
    try {
      identity = await completeAuthorization(
        {
          clientId: github.clientId,
          clientSecret: github.clientSecret,
          redirectUri: new URL('/auth/github/callback', deps.config.adminSiteUrl).toString(),
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        },
        new URL(req.url),
        state,
        codeVerifier,
      );
    } catch (error) {
      const code = error instanceof OAuthCallbackError ? error.code : 'falha';
      const returned = new URL(req.url).searchParams;
      logger.warn('admin_login_failed', {
        requestId: ctx.requestId,
        reason: code,
        statePresent: returned.has('state'),
        stateMatches: returned.get('state') === state,
        stateCount: returned.getAll('state').length,
        issuerPresent: returned.has('iss'),
        issuerMatches: returned.get('iss') === GITHUB_AS.issuer,
        providerError: returned.has('error'),
      });
      return loginRedirect(deps, 'falha_no_login');
    }

    if (!github.allowedUserIds.has(identity.id)) {
      logger.warn('admin_login_denied', { requestId: ctx.requestId, reason: 'not_allowed' });
      return loginRedirect(deps, 'nao_autorizado');
    }
    if (github.require2fa && identity.twoFactorAuthentication !== true) {
      logger.warn('admin_login_denied', { requestId: ctx.requestId, reason: 'no_2fa' });
      return loginRedirect(deps, 'sem_2fa');
    }

    const { token } = await deps.db.transaction(async (tx) => {
      const created = await createSession(tx, { githubId: identity.id, login: identity.login }, deps.config.session.absoluteTtlSeconds);
      await writeAudit(tx, { githubId: identity.id, login: identity.login }, 'admin.login', null, {});
      return created;
    });
    const response = loginRedirect(deps, null);
    response.headers.append('Set-Cookie', sessionCookie(token, deps.config.session.absoluteTtlSeconds));
    logger.info('admin_login', { requestId: ctx.requestId, admin: identity.login });
    return response;
  } catch (error) {
    if (error instanceof HttpError) return errorJson(error);
    logger.error('auth_callback_failed', { requestId: ctx.requestId, kind: errorKind(error) });
    return loginRedirect(deps, 'indisponivel');
  }
}

/** POST /auth/logout (exige CSRF) */
export async function handleLogout(req: Request, ctx: RequestContext, deps: AdminDeps): Promise<Response> {
  try {
    if (req.method !== 'POST') throw Errors.methodNotAllowed(['POST']);
    const admin = await requireAdmin(req, deps);
    await revokeSession(deps.db, admin.token);
    await writeAudit(deps.db, { githubId: admin.session.githubId, login: admin.session.login }, 'admin.logout', null, {});
    const response = noContent();
    response.headers.append('Set-Cookie', clearCookie(SESSION_COOKIE, 'Strict'));
    return response;
  } catch (error) {
    if (error instanceof HttpError) return errorJson(error);
    logger.error('logout_failed', { requestId: ctx.requestId, kind: errorKind(error) });
    return errorJson(Errors.unavailable());
  }
}

/** Utilizado pelo emulador local e pelos testes para criar sessões sem GitHub. Não é exposto em funções. */
export function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  return sessionCookie(token, maxAgeSeconds);
}
