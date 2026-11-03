import { z } from 'zod';
import { EXPIRY_OPTIONS, TURNSTILE_ACTIONS } from '../../shared/constants.ts';
import type { CreateLinkResponse } from '../../shared/api.ts';
import { findBlockingDomain } from '../domain/blocked-domains.ts';
import { insertLinkWithUniqueSlug } from '../domain/links.ts';
import { recordDailyMetric } from '../domain/metrics.ts';
import { getSettings } from '../domain/settings.ts';
import { Errors, HttpError } from '../http/errors.ts';
import { assertMethod, assertSameOrigin, readJson } from '../http/request.ts';
import { jsonResponse } from '../http/response.ts';
import { verifyTurnstile } from '../integrations/turnstile.ts';
import { logger } from '../logger.ts';
import { checkRateLimits } from '../security/rate-limit.ts';
import { validateDestinationUrl } from '../security/url-policy.ts';
import { apiErrorResponse, clientIpHash, rateLimitSubject, type PublicDeps, type RequestContext } from './context.ts';

const MAX_BODY_BYTES = 8 * 1024;

const bodySchema = z.object({
  url: z.string().max(4096),
  expiresIn: z.enum(EXPIRY_OPTIONS.map((o) => o.id) as [string, ...string[]]).optional(),
  turnstileToken: z.string().max(4096),
});

/**
 * POST /api/links — cria um link curto.
 * Ordem: método/tipo/tamanho → limites de uso → desafio antiautomação →
 * validação da URL → bloqueios → slug aleatório com UNIQUE → resposta.
 */
export async function handleCreateLink(req: Request, ctx: RequestContext, deps: PublicDeps): Promise<Response> {
  const { config, db } = deps;
  try {
    assertMethod(req, ['POST']);
    const requestUrl = new URL(req.url);
    const origin = config.isProduction ? config.publicSiteUrl.origin : requestUrl.origin;
    assertSameOrigin(req, origin, { requireOriginHeader: false });
    const parsed = bodySchema.safeParse(await readJson(req, MAX_BODY_BYTES));
    if (!parsed.success) throw Errors.badRequest('Dados inválidos. Informe o endereço e conclua a verificação.', 'invalid_request');
    const input = parsed.data;

    const ipHash = clientIpHash(config.ipHashSecret, ctx.clientIp);
    const subject = rateLimitSubject(ipHash);
    const limits = config.rateLimits;
    const limit = await checkRateLimits(db, [
      { name: 'create:ip:10m', subject, limit: limits.createPerIp10Min, windowSeconds: 600 },
      { name: 'create:ip:1d', subject, limit: limits.createPerIpDaily, windowSeconds: 86_400 },
      { name: 'create:global:1h', subject: 'global', limit: limits.createGlobalHourly, windowSeconds: 3600 },
    ]);
    if (!limit.allowed) {
      logger.warn('create_rate_limited', { requestId: ctx.requestId, rule: limit.rule });
      throw Errors.rateLimited(limit.retryAfterSeconds);
    }

    const settings = await getSettings(db);
    if (!settings.linkCreationEnabled) {
      throw Errors.unavailable('A criação de links está temporariamente desativada.', 'creation_disabled');
    }

    const antibot = await verifyTurnstile(input.turnstileToken, TURNSTILE_ACTIONS.createLink, {
      mode: config.antibot.mode,
      secretKey: config.antibot.secretKey,
      expectedHostname: config.isProduction ? config.publicSiteUrl.hostname : requestUrl.hostname,
      allowDummySecret: config.antibot.allowDummySecret,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    if (!antibot.ok) {
      if (antibot.reason === 'unavailable' || antibot.reason === 'misconfigured') {
        logger.error('antibot_unavailable', { requestId: ctx.requestId, reason: antibot.reason });
        throw Errors.unavailable('Não foi possível concluir a verificação contra robôs. Tente novamente em instantes.', 'antibot_unavailable');
      }
      throw new HttpError(403, 'antibot_failed', 'A verificação contra robôs falhou ou expirou. Refaça a verificação e tente novamente.');
    }

    const ownHosts = [config.publicSiteUrl.hostname, requestUrl.hostname, config.adminSiteUrl?.hostname ?? ''];
    const validation = validateDestinationUrl(input.url, { ownHosts });
    if (!validation.ok) {
      ctx.waitUntil(recordDailyMetric(db, 'link_rejected'));
      throw new HttpError(422, `invalid_url:${validation.code}`, validation.message);
    }
    const blockedBy = await findBlockingDomain(db, validation.host);
    if (blockedBy !== null) {
      ctx.waitUntil(recordDailyMetric(db, 'link_rejected'));
      throw new HttpError(422, 'blocked_domain', 'Este domínio não é aceito pelo EncurtaLinks.');
    }

    const expiry = EXPIRY_OPTIONS.find((option) => option.id === (input.expiresIn ?? 'never'));
    const created = await insertLinkWithUniqueSlug(
      db,
      {
        destinationUrl: validation.url,
        destinationHost: validation.host,
        expiresInSeconds: expiry?.seconds ?? null,
        creatorIpHash: ipHash,
      },
      deps.generateSlug ? { generate: deps.generateSlug } : {},
    );
    ctx.waitUntil(recordDailyMetric(db, 'link_created'));
    logger.info('link_created', { requestId: ctx.requestId, slug: created.slug, destinationHost: validation.host });

    const base = config.isProduction ? config.publicSiteUrl.origin : requestUrl.origin;
    const body: CreateLinkResponse = {
      slug: created.slug,
      shortUrl: `${base}/s/${created.slug}`,
      destinationHost: validation.host,
      expiresAt: created.expiresAt?.toISOString() ?? null,
    };
    return jsonResponse(201, body);
  } catch (error) {
    return apiErrorResponse(error, ctx, 'create_link_failed');
  }
}
