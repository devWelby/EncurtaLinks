import type { Config, Context } from '@netlify/functions';
import { handleReport } from '../../../../src/server/handlers/report.ts';
import { getPublicRuntime, toRequestContext } from '../../../../src/server/runtime.ts';

/** POST /api/reports — registra uma denúncia. */
export default async (req: Request, context: Context): Promise<Response> => {
  const runtime = getPublicRuntime(context);
  if (!runtime.ok) return runtime.response('json');
  return handleReport(req, toRequestContext(context), runtime.deps);
};

export const config: Config = { path: '/api/reports' };
