import { runCleanup } from '../domain/cleanup.ts';
import { errorKind, logger } from '../logger.ts';
import type { PublicDeps } from './context.ts';

/** Função agendada diária: retenção e limpeza (somente em deploys publicados). */
export async function handleCleanup(deps: PublicDeps): Promise<Response> {
  try {
    const report = await runCleanup(deps.db);
    logger.info('cleanup_done', { count: Object.values(report).reduce((a, b) => a + b, 0) });
    return new Response(null, { status: 204 });
  } catch (error) {
    logger.error('cleanup_failed', { kind: errorKind(error) });
    return new Response(null, { status: 500 });
  }
}
