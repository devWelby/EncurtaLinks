import { CONSENT_COOKIE } from '../../shared/constants.ts';
import { isValidSlug } from '../../shared/slug.ts';
import { cspForSlots } from '../ads/adsterra.ts';
import { accessState, findLinkForAccess, type AccessState, type LinkAccessRow } from '../domain/links.ts';
import { recordLinkMetric } from '../domain/metrics.ts';
import { consumeTicket, isWellFormedTicket, issueTicket } from '../domain/tickets.ts';
import { HttpError } from '../http/errors.ts';
import { parseCookies, readForm } from '../http/request.ts';
import { htmlResponse, redirectResponse } from '../http/response.ts';
import { errorKind, logger } from '../logger.ts';
import { randomToken } from '../security/crypto.ts';
import { checkRateLimits } from '../security/rate-limit.ts';
import { domainToUnicode } from 'node:url';
import { interstitialCsp, renderInterstitial, statusPage, statusPageCsp, type AdArea, type StatusPageKind } from '../render/pages.ts';
import { clientIpHash, rateLimitSubject, type PublicDeps, type RequestContext } from './context.ts';

const PATH = /^\/s\/([^/]+)(\/continue)?\/?$/;

function statusResponse(kind: StatusPageKind, headers: Record<string, string> = {}): Response {
  const nonce = randomToken(16);
  const page = statusPage(kind, nonce);
  return htmlResponse(page.status, page.html, { csp: statusPageCsp(nonce), headers });
}

function stateToPage(state: Exclude<AccessState, 'ok'>): StatusPageKind {
  return state;
}

function decideAds(req: Request, deps: PublicDeps, adsSetting: boolean, slug: string): AdArea {
  const ads = deps.config.ads;
  const ready = ads.envEnabled && adsSetting && ads.slots.length > 0;
  if (!ready) return ads.devPlaceholder ? { kind: 'placeholder' } : { kind: 'none' };
  if (!ads.requireConsent) return { kind: 'slots', slots: ads.slots };
  const consent = parseCookies(req.headers.get('cookie')).get(CONSENT_COOKIE);
  if (consent === 'granted') return { kind: 'slots', slots: ads.slots };
  if (consent === 'denied') return { kind: 'declined' };
  return { kind: 'consent', returnPath: `/s/${slug}` };
}

async function renderPage(
  req: Request,
  deps: PublicDeps,
  link: LinkAccessRow,
  adsSetting: boolean,
  status: number,
  notice: string | null,
): Promise<Response> {
  const ticket = await issueTicket(deps.db, link.id, deps.config.tickets.ttlSeconds);
  const host = link.destination_host ?? '';
  const unicode = host.split('.').some((label) => label.startsWith('xn--')) ? domainToUnicode(host) : null;
  const ads = decideAds(req, deps, adsSetting, link.slug);
  const nonce = randomToken(16);
  const csp = interstitialCsp(nonce, ads.kind === 'slots' ? cspForSlots(deps.config.ads, ads.slots) : null);
  const page = renderInterstitial(
    {
      slug: link.slug,
      ticket,
      destinationUrl: link.destination_url ?? '',
      destinationHost: host,
      unicodeHost: unicode !== null && unicode !== host ? unicode : null,
      expiresAt: link.expires_at,
      notice,
      minWaitSeconds: deps.config.tickets.minWaitSeconds,
      ads,
    },
    nonce,
  );
  return htmlResponse(status, page, { csp, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
}

/**
 * GET /s/:slug — página intermediária.
 * POST /s/:slug/continue — consome o ticket e redireciona (303) para o
 * destino lido do banco. Nenhum parâmetro do cliente define o destino.
 */
export async function handleInterstitial(req: Request, ctx: RequestContext, deps: PublicDeps): Promise<Response> {
  const url = new URL(req.url);
  const match = PATH.exec(url.pathname);
  const slug = match?.[1];
  const isContinue = match?.[2] !== undefined;
  if (slug === undefined || !isValidSlug(slug)) return statusResponse('not_found');

  if (isContinue && req.method !== 'POST') return statusResponse('method_not_allowed', { Allow: 'POST' });
  if (!isContinue && req.method !== 'GET' && req.method !== 'HEAD') return statusResponse('method_not_allowed', { Allow: 'GET, HEAD' });

  const { config, db } = deps;
  try {
    const subject = rateLimitSubject(clientIpHash(config.ipHashSecret, ctx.clientIp));
    const limit = await checkRateLimits(db, [
      isContinue
        ? { name: 'continue:ip:1m', subject, limit: config.rateLimits.continuePerIpMinute, windowSeconds: 60 }
        : { name: 'view:ip:1m', subject, limit: config.rateLimits.viewPerIpMinute, windowSeconds: 60 },
    ]);
    if (!limit.allowed) return statusResponse('rate_limited', { 'Retry-After': String(limit.retryAfterSeconds) });

    if (!isContinue) {
      const { link, adsEnabled } = await findLinkForAccess(db, slug);
      const state = accessState(link);
      if (state !== 'ok' || link === null) return statusResponse(stateToPage(state === 'ok' ? 'not_found' : state));
      if (req.method === 'HEAD') {
        return htmlResponse(200, '', { csp: "default-src 'none'; frame-ancestors 'none'" });
      }
      const response = await renderPage(req, deps, link, adsEnabled, 200, null);
      ctx.waitUntil(recordLinkMetric(db, link.id, 'interstitial_view'));
      return response;
    }

    // --- Continuação ---
    const origin = req.headers.get('origin');
    if (origin !== null && origin !== url.origin && origin !== config.publicSiteUrl.origin) {
      return statusResponse('bad_request');
    }
    let ticket: string | null = null;
    try {
      ticket = (await readForm(req, 2048)).get('ticket');
    } catch (error) {
      if (error instanceof HttpError) return statusResponse('bad_request');
      throw error;
    }

    if (isWellFormedTicket(ticket)) {
      const result = await consumeTicket(db, ticket, slug, config.tickets.minWaitSeconds);
      if (result.consumed) {
        const state = accessState(result.link);
        if (state !== 'ok') return statusResponse(stateToPage(state));
        const destination = result.link.destination_url;
        if (destination === null || !/^https?:\/\//.test(destination)) return statusResponse('unavailable');
        ctx.waitUntil(recordLinkMetric(db, result.link.id, 'continuation'));
        logger.info('continuation', { requestId: ctx.requestId, slug });
        return redirectResponse(303, destination);
      }
      const notices: Record<typeof result.reason, string> = {
        unknown: 'Não foi possível confirmar este acesso. Clique em continuar novamente.',
        already_used: 'Este acesso já foi utilizado. Clique em continuar novamente.',
        expired: 'A página ficou aberta por muito tempo. Clique em continuar novamente.',
        too_early: `Aguarde ${config.tickets.minWaitSeconds} segundo(s) antes de continuar.`,
      };
      const { link, adsEnabled } = await findLinkForAccess(db, slug);
      const state = accessState(link);
      if (state !== 'ok' || link === null) return statusResponse(stateToPage(state === 'ok' ? 'not_found' : state));
      return await renderPage(req, deps, link, adsEnabled, 409, notices[result.reason]);
    }

    // Ticket ausente ou adulterado: mostra a página novamente, sem redirecionar.
    const { link, adsEnabled } = await findLinkForAccess(db, slug);
    const state = accessState(link);
    if (state !== 'ok' || link === null) return statusResponse(stateToPage(state === 'ok' ? 'not_found' : state));
    return await renderPage(req, deps, link, adsEnabled, 400, 'Não foi possível confirmar este acesso. Clique em continuar novamente.');
  } catch (error) {
    // Falha ao verificar o estado do link: nunca redireciona.
    logger.error('interstitial_failed', { requestId: ctx.requestId, kind: errorKind(error), slug });
    return statusResponse('unavailable', { 'Retry-After': '30' });
  }
}
