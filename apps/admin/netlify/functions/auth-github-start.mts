import type { Config, Context } from '@netlify/functions';
import { handleAuthStart } from '../../../../src/server/handlers/admin-auth.ts';
import { getAdminRuntime, toRequestContext } from '../../../../src/server/runtime.ts';

/** GET /auth/github/start — inicia o login OAuth (PKCE) no GitHub. */
export default async (req: Request, context: Context): Promise<Response> => {
  const runtime = getAdminRuntime(context);
  if (!runtime.ok) return runtime.response('json');
  return handleAuthStart(req, toRequestContext(context), runtime.deps);
};

export const config: Config = {
  path: '/auth/github/start',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
