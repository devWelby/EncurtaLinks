import type { Config, Context } from '@netlify/functions';
import { handleLogout } from '../../../../src/server/handlers/admin-auth.ts';
import { getAdminRuntime, toRequestContext } from '../../../../src/server/runtime.ts';

/** POST /auth/logout — revoga a sessão atual. */
export default async (req: Request, context: Context): Promise<Response> => {
  const runtime = getAdminRuntime(context);
  if (!runtime.ok) return runtime.response('json');
  return handleLogout(req, toRequestContext(context), runtime.deps);
};

export const config: Config = { path: '/auth/logout' };
