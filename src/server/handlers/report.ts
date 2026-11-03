import { z } from 'zod';
import { REPORT_REASONS, TURNSTILE_ACTIONS } from '../../shared/constants.ts';
import { extractSlug } from '../../shared/slug.ts';
import { recordDailyMetric } from '../domain/metrics.ts';
import { createReport } from '../domain/reports.ts';
import { getSettings } from '../domain/settings.ts';
import { Errors, HttpError } from '../http/errors.ts';
import { assertMethod, assertSameOrigin, readJson } from '../http/request.ts';
import { jsonResponse } from '../http/response.ts';
import { verifyTurnstile } from '../integrations/turnstile.ts';
import { logger } from '../logger.ts';
import { checkRateLimits } from '../security/rate-limit.ts';
import { apiErrorResponse, clientIpHash, rateLimitSubject, type PublicDeps, type RequestContext } from './context.ts';

const bodySchema = z.object({
  link: z.string().min(1).max(2100),
  reason: z.enum(REPORT_REASONS.map((r) => r.id) as [string, ...string[]]),
  details: z.string().max(2000).optional(),
  contactEmail: z.union([z.literal(''), z.email().max(254)]).optional(),
  turnstileToken: z.string().max(4096),
});

/** POST /api/reports — denúncia de link. */
export async function handleReport(req: Request, ctx: RequestContext, deps: PublicDeps): Promise<Response> {
  const { config, db } = deps;
  try {
    assertMethod(req, ['POST']);
    const requestUrl = new URL(req.url);
    assertSameOrigin(req, config.isProduction ? config.publicSiteUrl.origin : requestUrl.origin, { requireOriginHeader: false });
    const parsed = bodySchema.safeParse(await readJson(req, 8 * 1024));
    if (!parsed.success) throw Errors.badRequest('Dados inválidos. Confira os campos e conclua a verificação.', 'invalid_request');
    const input = parsed.data;

    const ipHash = clientIpHash(config.ipHashSecret, ctx.clientIp);
    const subject = rateLimitSubject(ipHash);
    const limit = await checkRateLimits(db, [
      { name: 'report:ip:1h', subject, limit: config.rateLimits.reportPerIpHourly, windowSeconds: 3600 },
      { name: 'report:global:1h', subject: 'global', limit: config.rateLimits.reportGlobalHourly, windowSeconds: 3600 },
    ]);
    if (!limit.allowed) throw Errors.rateLimited(limit.retryAfterSeconds);

    const settings = await getSettings(db);
    if (!settings.reportsEnabled) {
      throw Errors.unavailable('O envio de denúncias está temporariamente indisponível. Tente mais tarde.', 'reports_disabled');
    }

    const antibot = await verifyTurnstile(input.turnstileToken, TURNSTILE_ACTIONS.reportLink, {
      mode: config.antibot.mode,
      secretKey: config.antibot.secretKey,
      expectedHostname: config.isProduction ? config.publicSiteUrl.hostname : requestUrl.hostname,
      allowDummySecret: config.antibot.allowDummySecret,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    if (!antibot.ok) {
      if (antibot.reason === 'unavailable' || antibot.reason === 'misconfigured') {
        throw Errors.unavailable('Não foi possível concluir a verificação contra robôs. Tente novamente em instantes.', 'antibot_unavailable');
      }
      throw new HttpError(403, 'antibot_failed', 'A verificação contra robôs falhou ou expirou. Refaça a verificação e tente novamente.');
    }

    const slug = extractSlug(input.link);
    if (slug === null) throw new HttpError(422, 'invalid_link', 'Informe o link curto completo (ex.: https://…/s/CODIGO) ou o código.');

    const result = await db.transaction((tx) =>
      createReport(
        tx,
        {
          slug,
          reason: input.reason as (typeof REPORT_REASONS)[number]['id'],
          details: input.details?.trim() ? input.details.trim() : null,
          contactEmail: input.contactEmail?.trim() ? input.contactEmail.trim().toLowerCase() : null,
          reporterIpHash: ipHash,
        },
        config.reportAutoBlockThreshold,
      ),
    );
    if (!result.ok) throw new HttpError(404, 'link_not_found', 'Não encontramos esse link curto.');
    ctx.waitUntil(recordDailyMetric(db, 'report_created'));
    logger.info('report_created', { requestId: ctx.requestId, slug, status: result.autoBlocked ? 'auto_blocked' : 'open' });
    return jsonResponse(201, { received: true });
  } catch (error) {
    return apiErrorResponse(error, ctx, 'report_failed');
  }
}
