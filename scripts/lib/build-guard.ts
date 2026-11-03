/**
 * Proteções de build do frontend.
 *
 * - Nenhuma variável VITE_ pode conter segredo: tudo com esse prefixo vai
 *   para o JavaScript público. Bloqueamos nomes que sugerem segredo.
 * - Em builds do Netlify (NETLIFY=true), o modo de teste do antiautomação é
 *   proibido; em produção (CONTEXT=production), a chave pública do
 *   Turnstile é obrigatória e não pode ser uma chave de teste.
 */

const DUMMY_SITEKEYS = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
]);

const SECRET_LIKE = /SECRET|PASSWORD|PRIVATE|TOKEN|DATABASE|HMAC|CREDENTIAL|_KEY_SECRET/i;
const ALLOWED_VITE_VARS = new Set(['VITE_TURNSTILE_SITE_KEY', 'VITE_ANTIBOT_MODE']);

export function assertSafeFrontendEnv(env: Record<string, string | undefined>, options: { usesTurnstile: boolean }): void {
  const problems: string[] = [];
  for (const name of Object.keys(env)) {
    if (!name.startsWith('VITE_')) continue;
    if (!ALLOWED_VITE_VARS.has(name)) problems.push(`${name}: variável VITE_ desconhecida (tudo com VITE_ fica público no navegador)`);
    else if (SECRET_LIKE.test(name)) problems.push(`${name}: nome sugere segredo`);
  }

  const onNetlify = env.NETLIFY === 'true';
  const isProduction = env.CONTEXT === 'production';
  if (options.usesTurnstile) {
    if (onNetlify && env.VITE_ANTIBOT_MODE === 'test') problems.push('VITE_ANTIBOT_MODE=test não é permitido em builds do Netlify');
    if (isProduction) {
      const key = env.VITE_TURNSTILE_SITE_KEY ?? '';
      if (key === '') problems.push('VITE_TURNSTILE_SITE_KEY é obrigatória no build de produção');
      if (DUMMY_SITEKEYS.has(key)) problems.push('VITE_TURNSTILE_SITE_KEY de teste não pode ser usada em produção');
    }
  }
  if (problems.length > 0) {
    throw new Error(`Build bloqueado por configuração insegura:\n - ${problems.join('\n - ')}`);
  }
}
