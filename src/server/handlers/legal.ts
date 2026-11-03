import type { LegalDocumentResponse } from '../../shared/api.ts';
import { getLegalDocument, type LegalKind } from '../domain/legal.ts';
import { Errors } from '../http/errors.ts';
import { assertMethod } from '../http/request.ts';
import { jsonResponse } from '../http/response.ts';
import { apiErrorResponse, type PublicDeps, type RequestContext } from './context.ts';

const KINDS: Record<string, LegalKind> = { terms: 'terms', privacy: 'privacy' };

/**
 * GET /api/legal/:kind — termos e política de privacidade.
 * Pode ficar em cache por até 5 minutos na CDN (reduz invocações); alterações
 * feitas no painel aparecem após esse prazo.
 */
export async function handleLegal(req: Request, ctx: RequestContext, deps: PublicDeps): Promise<Response> {
  try {
    assertMethod(req, ['GET', 'HEAD']);
    const kindParam = new URL(req.url).pathname.split('/').filter(Boolean)[2] ?? '';
    const kind = KINDS[kindParam];
    if (kind === undefined) throw Errors.notFound('Documento não encontrado.');
    const doc = await getLegalDocument(deps.db, kind);
    if (doc === null) throw Errors.notFound('Documento não encontrado.');
    const body: LegalDocumentResponse = {
      kind: doc.kind,
      title: doc.title,
      body: doc.body,
      responsibleName: doc.responsible_name,
      responsibleContact: doc.responsible_contact,
      responsibleDocument: doc.responsible_document,
      updatedAt: doc.updated_at.toISOString(),
    };
    return jsonResponse(200, body, {
      'Cache-Control': 'public, max-age=60',
      'Netlify-CDN-Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    });
  } catch (error) {
    return apiErrorResponse(error, ctx, 'legal_failed');
  }
}
