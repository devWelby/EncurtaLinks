import type { Config, Context } from '@netlify/functions';
import { handleConsent } from '../../../../src/server/handlers/consent.ts';
import { getPublicRuntime, toRequestContext } from '../../../../src/server/runtime.ts';

/** POST /consent — grava a escolha sobre publicidade (funciona sem JavaScript). */
export default async (req: Request, context: Context): Promise<Response> => {
  const runtime = getPublicRuntime(context);
  if (!runtime.ok) return runtime.response('html');
  return handleConsent(req, toRequestContext(context), runtime.deps);
};

export const config: Config = { path: '/consent' };
