import type { Config, Context } from '@netlify/functions';
import { handleCreateLink } from '../../../../src/server/handlers/create-link.ts';
import { getPublicRuntime, toRequestContext } from '../../../../src/server/runtime.ts';

/** POST /api/links — cria um link curto. */
export default async (req: Request, context: Context): Promise<Response> => {
  const runtime = getPublicRuntime(context);
  if (!runtime.ok) return runtime.response('json');
  return handleCreateLink(req, toRequestContext(context), runtime.deps);
};

export const config: Config = {
  path: '/api/links',
  // Camada extra da plataforma (além dos limites distribuídos no banco).
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
