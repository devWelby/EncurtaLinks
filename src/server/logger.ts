/**
 * Logs estruturados (JSON por linha), lidos no painel de logs do Netlify.
 *
 * Nunca registre: tokens, cookies, credenciais, IPs, URLs completas de destino
 * (podem conter parâmetros sensíveis) ou corpos de requisição. Campos com
 * nomes sensíveis são removidos automaticamente como proteção adicional.
 */

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, string | number | boolean | null | undefined>;

const SENSITIVE_KEY = /token|cookie|secret|password|authorization|ip|url|email|session|csrf|verifier|code/i;
const ALLOWED_KEYS = new Set(['slug', 'host', 'destinationHost', 'status', 'rule', 'reason', 'requestId', 'action', 'count', 'durationMs', 'kind', 'migration', 'admin']);

function sanitize(fields: Fields): Fields {
  const clean: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!ALLOWED_KEYS.has(key) && SENSITIVE_KEY.test(key)) continue;
    clean[key] = typeof value === 'string' ? value.slice(0, 300) : value;
  }
  return clean;
}

function write(level: Level, event: string, fields: Fields = {}): void {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...sanitize(fields) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
};

export type Logger = typeof logger;

/** Descreve um erro sem stack trace, consultas ou dados de entrada. */
export function errorKind(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return `code:${code}`;
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return 'unknown';
}
