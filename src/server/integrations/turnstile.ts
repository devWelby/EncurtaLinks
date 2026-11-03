import { z } from 'zod';
import { TEST_ANTIBOT_TOKEN } from '../../shared/constants.ts';

/**
 * Validação do Cloudflare Turnstile no servidor.
 * Documentação: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * Regras aplicadas:
 *  - token obrigatório, até 2048 caracteres, uso único (garantido pela Cloudflare);
 *  - `hostname` e `action` precisam corresponder ao esperado;
 *  - falha de rede/timeout => recusa (fail closed);
 *  - chaves de teste da Cloudflare só fora de produção;
 *  - o "modo de teste" local (token fixo) só quando explicitamente permitido.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Chaves secretas de teste publicadas pela Cloudflare. Nunca aceitas em produção. */
export const TURNSTILE_DUMMY_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

export const TURNSTILE_DUMMY_SITEKEYS = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
]);

const responseSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  'error-codes': z.array(z.string()).optional(),
});

export interface TurnstileOptions {
  mode: 'turnstile' | 'test';
  secretKey: string;
  expectedHostname: string;
  /** Permite as chaves de teste da Cloudflare (somente fora de produção). */
  allowDummySecret: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'invalid' | 'mismatch' | 'unavailable' | 'misconfigured' };

export async function verifyTurnstile(
  token: unknown,
  expectedAction: string,
  options: TurnstileOptions,
): Promise<TurnstileResult> {
  if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'missing' };
  if (token.length > 2048) return { ok: false, reason: 'invalid' };

  if (options.mode === 'test') {
    // Só chega aqui quando a configuração permitiu (desenvolvimento local/testes).
    return token === TEST_ANTIBOT_TOKEN ? { ok: true } : { ok: false, reason: 'invalid' };
  }

  const isDummy = TURNSTILE_DUMMY_SECRETS.has(options.secretKey);
  if (options.secretKey === '' || (isDummy && !options.allowDummySecret)) {
    return { ok: false, reason: 'misconfigured' };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let payload: z.infer<typeof responseSchema>;
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: options.secretKey, response: token }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    payload = responseSchema.parse(await response.json());
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (!payload.success) return { ok: false, reason: 'invalid' };
  // As chaves de teste devolvem hostname/action fictícios; só pulamos a checagem nelas.
  if (!isDummy) {
    if (payload.hostname !== options.expectedHostname || payload.action !== expectedAction) {
      return { ok: false, reason: 'mismatch' };
    }
  }
  return { ok: true };
}
