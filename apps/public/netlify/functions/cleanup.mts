import type { Config, Context } from '@netlify/functions';
import { handleCleanup } from '../../../../src/server/handlers/cleanup.ts';
import { getPublicRuntime } from '../../../../src/server/runtime.ts';

/**
 * Limpeza diária (retenção). Funções agendadas só rodam em deploys de
 * produção publicados; não são acessíveis por URL pública.
 */
export default async (_req: Request, context: Context): Promise<Response> => {
  const runtime = getPublicRuntime(context);
  if (!runtime.ok) return new Response(null, { status: 503 });
  return handleCleanup(runtime.deps);
};

export const config: Config = { schedule: '@daily' };
