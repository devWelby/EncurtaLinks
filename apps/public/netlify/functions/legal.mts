import type { Config, Context } from '@netlify/functions';
import { handleLegal } from '../../../../src/server/handlers/legal.ts';
import { getPublicRuntime, toRequestContext } from '../../../../src/server/runtime.ts';

/** GET /api/legal/:kind — termos de uso e política de privacidade (cache de 5 min na CDN). */
export default async (req: Request, context: Context): Promise<Response> => {
  const runtime = getPublicRuntime(context);
  if (!runtime.ok) return runtime.response('json');
  return handleLegal(req, toRequestContext(context), runtime.deps);
};

export const config: Config = { path: '/api/legal/:kind' };
