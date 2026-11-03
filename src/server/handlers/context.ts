import type { AdminConfig, PublicConfig } from '../config.ts';
import type { Database } from '../db/types.ts';
import { HttpError } from '../http/errors.ts';
import { errorJson } from '../http/response.ts';
import { errorKind, logger } from '../logger.ts';
import { hmacSha256 } from '../security/crypto.ts';
import { normalizeClientIp } from '../security/ip.ts';

/** Metadados da requisição fornecidos pela plataforma (Netlify) — nunca por cabeçalhos do cliente. */
export interface RequestContext {
  /** IP do cliente informado pela plataforma (context.ip no Netlify). */
  clientIp: string | null;
  requestId: string;
  /** Agenda trabalho após a resposta (métricas). */
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface PublicDeps {
  config: PublicConfig;
  db: Database;
  fetchImpl?: typeof fetch;
  generateSlug?: () => string;
}

export interface AdminDeps {
  config: AdminConfig;
  db: Database;
  fetchImpl?: typeof fetch;
}

/**
 * Identificador pseudonimizado do cliente: HMAC-SHA256(segredo, IP normalizado).
 * IPv6 é agregado por /64. Não é anonimização: com o segredo e o IP é possível
 * recalcular o valor. O IP bruto nunca é persistido.
 */
export function clientIpHash(secret: string, clientIp: string | null): Buffer | null {
  if (clientIp === null) return null;
  const normalized = normalizeClientIp(clientIp);
  if (normalized === null) return null;
  return hmacSha256(secret, `ip:${normalized}`);
}

export function rateLimitSubject(hash: Buffer | null): string {
  return hash === null ? 'unknown' : hash.subarray(0, 16).toString('hex');
}

/** Erros de infraestrutura (banco indisponível, timeout) viram 503; o resto, 500. */
export function isInfrastructureError(error: unknown): boolean {
  const kind = errorKind(error);
  return (
    /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE/.test(kind) ||
    /^code:(08|57P|53)/.test(kind) ||
    (error instanceof Error && /timeout|Connection terminated|connect/i.test(error.message))
  );
}

export function apiErrorResponse(error: unknown, ctx: RequestContext, event: string): Response {
  if (error instanceof HttpError) return errorJson(error);
  const infra = isInfrastructureError(error);
  logger.error(event, { requestId: ctx.requestId, kind: errorKind(error), status: infra ? 503 : 500 });
  return errorJson(
    infra
      ? new HttpError(503, 'unavailable', 'Serviço temporariamente indisponível. Tente novamente em instantes.', { headers: { 'Retry-After': '30' } })
      : new HttpError(500, 'internal_error', 'Ocorreu um erro inesperado. Tente novamente.'),
  );
}
