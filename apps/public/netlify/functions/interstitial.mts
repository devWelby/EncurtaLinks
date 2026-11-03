import type { Config, Context } from '@netlify/functions';
import { handleInterstitial } from '../../../../src/server/handlers/interstitial.ts';
import { getPublicRuntime, toRequestContext } from '../../../../src/server/runtime.ts';

/** GET /s/:slug (página intermediária) e POST /s/:slug/continue (redirecionamento 303). */
export default async (req: Request, context: Context): Promise<Response> => {
  const runtime = getPublicRuntime(context);
  if (!runtime.ok) return runtime.response('html');
  return handleInterstitial(req, toRequestContext(context), runtime.deps);
};

export const config: Config = {
  path: ['/s/:slug', '/s/:slug/continue'],
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
