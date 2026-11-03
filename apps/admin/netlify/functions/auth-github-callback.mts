import type { Config, Context } from '@netlify/functions';
import { handleAuthCallback } from '../../../../src/server/handlers/admin-auth.ts';
import { getAdminRuntime, toRequestContext } from '../../../../src/server/runtime.ts';

/** GET /auth/github/callback — conclui o login e cria a sessão administrativa. */
export default async (req: Request, context: Context): Promise<Response> => {
  const runtime = getAdminRuntime(context);
  if (!runtime.ok) return runtime.response('json');
  return handleAuthCallback(req, toRequestContext(context), runtime.deps);
};

export const config: Config = { path: '/auth/github/callback' };
