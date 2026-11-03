import type { Config, Context } from '@netlify/functions';
import { handleAdminApi } from '../../../../src/server/handlers/admin-api.ts';
import { getAdminRuntime, toRequestContext } from '../../../../src/server/runtime.ts';

/** /api/admin/* — API do painel (autorização no servidor em todas as rotas). */
export default async (req: Request, context: Context): Promise<Response> => {
  const runtime = getAdminRuntime(context);
  if (!runtime.ok) return runtime.response('json');
  return handleAdminApi(req, toRequestContext(context), runtime.deps);
};

export const config: Config = {
  path: '/api/admin/*',
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
