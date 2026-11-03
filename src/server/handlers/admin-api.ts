import { z } from 'zod';
import type {
  AdminAuditEntry,
  AdminBlockedDomain,
  AdminLinkSummary,
  AdminMetrics,
  AdminReport,
  AdminSessionResponse,
  AdminSettings,
  LegalDocumentResponse,
  Paginated,
} from '../../shared/api.ts';
import { isValidSlug } from '../../shared/slug.ts';
import { listAudit, writeAudit, type Actor } from '../domain/audit.ts';
import { addBlockedDomain, listBlockedDomains, normalizeDomainInput, removeBlockedDomain } from '../domain/blocked-domains.ts';
import { getLegalDocument, updateLegalDocument, type LegalKind } from '../domain/legal.ts';
import { changeLinkStatus, listLinks, type AdminLinkRow, type StatusChange } from '../domain/links.ts';
import { getDailyMetrics, getTotals } from '../domain/metrics.ts';
import { listReports, resolveReport } from '../domain/reports.ts';
import { revokeAllSessions } from '../domain/sessions.ts';
import { getSettings, updateSettings } from '../domain/settings.ts';
import { Errors } from '../http/errors.ts';
import { parseCookies, readJson } from '../http/request.ts';
import { jsonResponse } from '../http/response.ts';
import { sha256 } from '../security/crypto.ts';
import { checkRateLimits } from '../security/rate-limit.ts';
import { assertAdminHost, requireAdmin, SESSION_COOKIE } from './admin-auth.ts';
import { apiErrorResponse, clientIpHash, rateLimitSubject, type AdminDeps, type RequestContext } from './context.ts';

/**
 * API do painel administrativo: /api/admin/*
 *
 * Toda rota passa por `requireAdmin` (sessão no servidor + allowlist + CSRF
 * nas alterações). Não há CORS: o painel e a API estão na mesma origem.
 * Toda alteração grava um registro de auditoria na mesma transação.
 */

const PREFIX = '/api/admin/';
const SMALL_BODY = 4 * 1024;
const LEGAL_BODY = 128 * 1024;

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

function pagination(url: URL): { page: number; pageSize: number; limit: number; offset: number } {
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1), 1000);
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25, 5), 100);
  // Busca um item a mais para saber se há próxima página, sem COUNT(*).
  return { page, pageSize, limit: pageSize + 1, offset: (page - 1) * pageSize };
}

function paginate<T>(rows: T[], page: number, pageSize: number): Paginated<T> {
  return { items: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize };
}

function toLinkSummary(row: AdminLinkRow): AdminLinkSummary {
  return {
    slug: row.slug,
    destinationUrl: row.destination_url,
    destinationHost: row.destination_host,
    status: row.status,
    statusReason: row.status_reason,
    createdAt: row.created_at.toISOString(),
    expiresAt: iso(row.expires_at),
    expired: row.expired,
    interstitialViews: Number(row.interstitial_views),
    continuations: Number(row.continuations),
    openReports: Number(row.open_reports),
  };
}

function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw Errors.badRequest('Dados inválidos.', 'invalid_body');
  return parsed.data;
}

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim() ?? '';
      return trimmed === '' ? null : trimmed;
    });

const reasonBody = z.object({ reason: optionalText(500) }).strict();
const resolveBody = z.object({ note: optionalText(1000), blockLink: z.boolean().optional() }).strict();
const domainBody = z.object({ domain: z.string().min(1).max(300), reason: optionalText(500) }).strict();
const settingsBody = z
  .object({ linkCreationEnabled: z.boolean().optional(), adsEnabled: z.boolean().optional(), reportsEnabled: z.boolean().optional() })
  .strict();
const legalBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(100_000),
    responsibleName: optionalText(200),
    responsibleContact: optionalText(300),
    responsibleDocument: optionalText(100),
  })
  .strict();

const LINK_STATUS_FILTER = new Set(['all', 'active', 'blocked', 'deleted']);
const REPORT_STATUS_FILTER = new Set(['all', 'open', 'resolved', 'dismissed']);

type Route = (args: { req: Request; url: URL; params: string[]; actor: Actor; deps: AdminDeps; session: AdminSessionResponse }) => Promise<Response>;

interface RouteDef {
  method: 'GET' | 'POST';
  pattern: RegExp;
  handler: Route;
}

const routes: RouteDef[] = [
  {
    method: 'GET',
    pattern: /^session$/,
    handler: ({ session }) => Promise.resolve(jsonResponse(200, session)),
  },
  {
    method: 'GET',
    pattern: /^links$/,
    handler: async ({ url, deps }) => {
      const { page, pageSize, limit, offset } = pagination(url);
      const status = url.searchParams.get('status') ?? 'all';
      if (!LINK_STATUS_FILTER.has(status)) throw Errors.badRequest('Filtro inválido.');
      const q = (url.searchParams.get('q') ?? '').slice(0, 200);
      const rows = await listLinks(deps.db, { q, status: status as 'all', limit, offset });
      return jsonResponse(200, paginate(rows.map(toLinkSummary), page, pageSize));
    },
  },
  {
    method: 'POST',
    pattern: /^links\/([^/]+)\/(block|unblock|delete)$/,
    handler: async ({ req, params, actor, deps }) => {
      const [slug = '', change = 'block'] = params;
      if (!isValidSlug(slug)) throw Errors.notFound('Link não encontrado.');
      const { reason } = parseBody(reasonBody, await readJson(req, SMALL_BODY));
      const result = await deps.db.transaction(async (tx) => {
        const changed = await changeLinkStatus(tx, slug, change as StatusChange, reason);
        if (changed.ok) {
          await writeAudit(tx, actor, `link.${change}`, { type: 'link', id: slug }, { from: changed.previous, to: changed.current, reason });
        }
        return changed;
      });
      if (!result.ok) {
        if (result.reason === 'not_found') throw Errors.notFound('Link não encontrado.');
        throw Errors.conflict('O link não está em um estado que permita esta ação.', 'invalid_transition');
      }
      return jsonResponse(200, { slug, status: result.current });
    },
  },
  {
    method: 'GET',
    pattern: /^reports$/,
    handler: async ({ url, deps }) => {
      const { page, pageSize, limit, offset } = pagination(url);
      const status = url.searchParams.get('status') ?? 'open';
      if (!REPORT_STATUS_FILTER.has(status)) throw Errors.badRequest('Filtro inválido.');
      const rows = await listReports(deps.db, { status: status as 'all', limit, offset });
      const items: AdminReport[] = rows.map((row) => ({
        id: Number(row.id),
        slug: row.slug,
        linkStatus: row.link_status,
        destinationHost: row.destination_host,
        reason: row.reason,
        details: row.details,
        contactEmail: row.contact_email,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        resolvedAt: iso(row.resolved_at),
        resolvedBy: row.resolved_by,
        resolutionNote: row.resolution_note,
      }));
      return jsonResponse(200, paginate(items, page, pageSize));
    },
  },
  {
    method: 'POST',
    pattern: /^reports\/(\d{1,15})\/(resolve|dismiss)$/,
    handler: async ({ req, params, actor, deps }) => {
      const id = Number(params[0]);
      const action = params[1] === 'dismiss' ? 'dismiss' : 'resolve';
      const { note, blockLink } = parseBody(resolveBody, await readJson(req, SMALL_BODY));
      const outcome = await deps.db.transaction(async (tx) => {
        const resolved = await resolveReport(tx, id, action, note, actor);
        if (!resolved.ok) return { resolved, blocked: false };
        await writeAudit(tx, actor, `report.${action}`, { type: 'report', id: String(id) }, { slug: resolved.slug });
        let blocked = false;
        if (action === 'resolve' && blockLink === true) {
          const changed = await changeLinkStatus(tx, resolved.slug, 'block', note ?? `Denúncia #${id}`);
          blocked = changed.ok;
          if (changed.ok) {
            await writeAudit(tx, actor, 'link.block', { type: 'link', id: resolved.slug }, { from: changed.previous, to: changed.current, report: id });
          }
        }
        return { resolved, blocked };
      });
      if (!outcome.resolved.ok) {
        if (outcome.resolved.reason === 'not_found') throw Errors.notFound('Denúncia não encontrada.');
        throw Errors.conflict('Esta denúncia já foi tratada.', 'not_open');
      }
      return jsonResponse(200, { id, status: action === 'resolve' ? 'resolved' : 'dismissed', linkBlocked: outcome.blocked });
    },
  },
  {
    method: 'GET',
    pattern: /^domains$/,
    handler: async ({ url, deps }) => {
      const { page, pageSize, limit, offset } = pagination(url);
      const q = (url.searchParams.get('q') ?? '').slice(0, 200);
      const rows = await listBlockedDomains(deps.db, { q, limit, offset });
      const items: AdminBlockedDomain[] = rows.map((row) => ({
        domain: row.domain,
        reason: row.reason,
        createdAt: row.created_at.toISOString(),
        createdBy: row.created_by,
      }));
      return jsonResponse(200, paginate(items, page, pageSize));
    },
  },
  {
    method: 'POST',
    pattern: /^domains$/,
    handler: async ({ req, actor, deps }) => {
      const body = parseBody(domainBody, await readJson(req, SMALL_BODY));
      const domain = normalizeDomainInput(body.domain);
      if (domain === null) throw Errors.badRequest('Informe um domínio válido (ex.: exemplo.com).', 'invalid_domain');
      const added = await deps.db.transaction(async (tx) => {
        const inserted = await addBlockedDomain(tx, domain, body.reason, actor.login);
        if (inserted) await writeAudit(tx, actor, 'domain.block', { type: 'domain', id: domain }, { reason: body.reason });
        return inserted;
      });
      if (!added) throw Errors.conflict('Este domínio já está bloqueado.', 'already_blocked');
      return jsonResponse(201, { domain });
    },
  },
  {
    method: 'POST',
    pattern: /^domains\/([^/]+)\/delete$/,
    handler: async ({ params, actor, deps }) => {
      const domain = normalizeDomainInput(decodeURIComponent(params[0] ?? ''));
      if (domain === null) throw Errors.notFound('Domínio não encontrado.');
      const removed = await deps.db.transaction(async (tx) => {
        const deleted = await removeBlockedDomain(tx, domain);
        if (deleted) await writeAudit(tx, actor, 'domain.unblock', { type: 'domain', id: domain }, {});
        return deleted;
      });
      if (!removed) throw Errors.notFound('Domínio não encontrado.');
      return jsonResponse(200, { domain, removed: true });
    },
  },
  {
    method: 'GET',
    pattern: /^metrics$/,
    handler: async ({ url, deps }) => {
      const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 1), 400);
      const [rows, totals] = await Promise.all([getDailyMetrics(deps.db, days), getTotals(deps.db)]);
      const body: AdminMetrics = {
        days: rows.map((row) => ({
          day: row.day,
          linkCreated: Number(row.link_created),
          linkRejected: Number(row.link_rejected),
          interstitialView: Number(row.interstitial_view),
          continuation: Number(row.continuation),
          reportCreated: Number(row.report_created),
        })),
        totals: {
          activeLinks: Number(totals.active_links),
          blockedLinks: Number(totals.blocked_links),
          deletedLinks: Number(totals.deleted_links),
          openReports: Number(totals.open_reports),
          blockedDomains: Number(totals.blocked_domains),
        },
      };
      return jsonResponse(200, body);
    },
  },
  {
    method: 'GET',
    pattern: /^settings$/,
    handler: async ({ deps }) => {
      const settings: AdminSettings = await getSettings(deps.db);
      return jsonResponse(200, settings);
    },
  },
  {
    method: 'POST',
    pattern: /^settings$/,
    handler: async ({ req, actor, deps }) => {
      const patch = parseBody(settingsBody, await readJson(req, SMALL_BODY));
      const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Record<string, boolean>;
      if (Object.keys(clean).length === 0) throw Errors.badRequest('Nenhuma alteração informada.');
      const settings = await deps.db.transaction(async (tx) => {
        const updated = await updateSettings(tx, clean, actor.login);
        await writeAudit(tx, actor, 'settings.update', null, clean);
        return updated;
      });
      return jsonResponse(200, settings);
    },
  },
  {
    method: 'GET',
    pattern: /^legal\/(terms|privacy)$/,
    handler: async ({ params, deps }) => {
      const kind = params[0] as LegalKind;
      const row = await getLegalDocument(deps.db, kind);
      if (row === null) throw Errors.notFound('Documento não encontrado.');
      return jsonResponse(200, legalResponse(row));
    },
  },
  {
    method: 'POST',
    pattern: /^legal\/(terms|privacy)$/,
    handler: async ({ req, params, actor, deps }) => {
      const kind = params[0] as LegalKind;
      const body = parseBody(legalBody, await readJson(req, LEGAL_BODY));
      const row = await deps.db.transaction(async (tx) => {
        const saved = await updateLegalDocument(tx, kind, body, actor.login);
        await writeAudit(tx, actor, 'legal.update', { type: 'legal', id: kind }, { length: body.body.length });
        return saved;
      });
      return jsonResponse(200, legalResponse(row));
    },
  },
  {
    method: 'GET',
    pattern: /^audit$/,
    handler: async ({ url, deps }) => {
      const { page, pageSize, limit, offset } = pagination(url);
      const rows = await listAudit(deps.db, limit, offset);
      const items: AdminAuditEntry[] = rows.map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at.toISOString(),
        adminLogin: row.admin_login,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: row.details,
      }));
      return jsonResponse(200, paginate(items, page, pageSize));
    },
  },
  {
    method: 'POST',
    pattern: /^sessions\/revoke-all$/,
    handler: async ({ actor, deps }) => {
      const revoked = await deps.db.transaction(async (tx) => {
        const count = await revokeAllSessions(tx, actor.githubId);
        await writeAudit(tx, actor, 'admin.revoke_all_sessions', null, { count });
        return count;
      });
      return jsonResponse(200, { revoked });
    },
  },
];

function legalResponse(row: NonNullable<Awaited<ReturnType<typeof getLegalDocument>>>): LegalDocumentResponse {
  return {
    kind: row.kind,
    title: row.title,
    body: row.body,
    responsibleName: row.responsible_name,
    responsibleContact: row.responsible_contact,
    responsibleDocument: row.responsible_document,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function handleAdminApi(req: Request, ctx: RequestContext, deps: AdminDeps): Promise<Response> {
  try {
    assertAdminHost(req, deps);
    const url = new URL(req.url);
    if (!url.pathname.startsWith(PREFIX)) throw Errors.notFound();
    const path = url.pathname.slice(PREFIX.length).replace(/\/$/, '');

    const candidates = routes.filter((route) => route.pattern.test(path));
    if (candidates.length === 0) throw Errors.notFound();
    const route = candidates.find((candidate) => candidate.method === req.method);
    if (route === undefined) throw Errors.methodNotAllowed([...new Set(candidates.map((candidate) => candidate.method))]);

    // Limite por IP e por sessão (o hash do cookie identifica a sessão sem expor o token).
    const cookie = parseCookies(req.headers.get('cookie')).get(SESSION_COOKIE) ?? '';
    const limit = await checkRateLimits(deps.db, [
      {
        name: 'admin-api:ip:10m',
        subject: rateLimitSubject(clientIpHash(deps.config.ipHashSecret, ctx.clientIp)),
        limit: deps.config.rateLimits.apiPerSession10Min,
        windowSeconds: 600,
      },
      {
        name: 'admin-api:session:10m',
        subject: cookie === '' ? 'none' : sha256(cookie).subarray(0, 16).toString('hex'),
        limit: deps.config.rateLimits.apiPerSession10Min,
        windowSeconds: 600,
      },
    ]);
    if (!limit.allowed) throw Errors.rateLimited(limit.retryAfterSeconds);

    const admin = await requireAdmin(req, deps);
    const actor: Actor = { githubId: admin.session.githubId, login: admin.session.login };
    const session: AdminSessionResponse = {
      admin: actor,
      csrfToken: admin.session.csrfToken,
      expiresAt: admin.session.expiresAt.toISOString(),
    };
    const params = route.pattern.exec(path)?.slice(1) ?? [];
    return await route.handler({ req, url, params, actor, deps, session });
  } catch (error) {
    return apiErrorResponse(error, ctx, 'admin_api_failed');
  }
}
