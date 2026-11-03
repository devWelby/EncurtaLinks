/**
 * npm run check:secrets — procura segredos nos arquivos publicados (dist/).
 *
 * Tudo o que está em dist/public e dist/admin fica PÚBLICO na CDN. Este
 * script falha (código 1) se encontrar:
 *   - o VALOR de qualquer variável de ambiente sensível presente no build
 *     (ex.: DATABASE_URL, IP_HASH_SECRET, GITHUB_CLIENT_SECRET);
 *   - padrões de credenciais (URL do PostgreSQL com senha, chave PEM,
 *     tokens do GitHub);
 *   - nomes de variáveis exclusivas do servidor (indício de código de
 *     servidor no bundle do navegador);
 *   - mapas de código (.map) ou arquivos .env publicados.
 *
 * Roda no CI e nos builds do Netlify (netlify.toml), depois do build.
 * Uso: node scripts/check-bundle-secrets.ts [diretório...]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const requested = process.argv.slice(2);
const candidates = (requested.length > 0 ? requested : ['dist/public', 'dist/admin']).map((dir) => resolve(repoRoot, dir));
const targets = candidates.filter((dir) => existsSync(dir));
if (targets.length === 0) {
  console.error('check:secrets: nenhum diretório de build encontrado (rode "npm run build" antes).');
  process.exit(1);
}

/** Variáveis cujo valor nunca pode aparecer no frontend. */
const SENSITIVE_NAME = /(SECRET|PASSWORD|PASSWD|PRIVATE|TOKEN|CREDENTIAL|DATABASE_URL|DATABASE_MIGRATION_URL|CA_CERT|_KEY$|_PAT$)/i;
/** Variáveis públicas por definição (vão para o navegador de propósito). */
const PUBLIC_NAMES = new Set(['VITE_TURNSTILE_SITE_KEY', 'TURNSTILE_SITE_KEY', 'VITE_ANTIBOT_MODE']);
/** Valores triviais que não identificam segredo nenhum. */
const TRIVIAL = new Set(['true', 'false', 'disable', 'require', 'test', 'development', 'production', 'staging']);

const sensitiveValues = Object.entries(process.env)
  .filter(([name, value]) => SENSITIVE_NAME.test(name) && !PUBLIC_NAMES.has(name) && !name.startsWith('npm_') && value !== undefined)
  .map(([name, value]) => [name, (value ?? '').trim()] as const)
  .filter(([, value]) => value.length >= 12 && !TRIVIAL.has(value.toLowerCase()));

const PATTERNS: Array<[string, RegExp]> = [
  ['URL do PostgreSQL com credenciais', /postgres(?:ql)?:\/\/[^\s"'`/@]+:[^\s"'`/@]+@/i],
  ['chave privada PEM', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['token do GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['nome de variável exclusiva do servidor', /\b(?:IP_HASH_SECRET|GITHUB_CLIENT_SECRET|TURNSTILE_SECRET_KEY|DATABASE_MIGRATION_URL|DATABASE_CA_CERT|ADSTERRA_SLOT_[A-Z]+_HTML)\b/],
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const problems: string[] = [];
let scanned = 0;
for (const target of targets) {
  for (const file of walk(target)) {
    const name = relative(repoRoot, file).replaceAll('\\', '/');
    scanned += 1;
    if (/\.map$/i.test(file)) problems.push(`${name}: mapa de código publicado (expõe o código-fonte)`);
    if (/(^|[\\/])\.env(\.|$)/i.test(file)) problems.push(`${name}: arquivo .env publicado`);
    const content = readFileSync(file).toString('latin1');
    for (const [envName, value] of sensitiveValues) {
      if (content.includes(value)) problems.push(`${name}: contém o valor de ${envName}`);
    }
    for (const [label, pattern] of PATTERNS) {
      if (pattern.test(content)) problems.push(`${name}: ${label}`);
    }
  }
}

if (problems.length > 0) {
  console.error('check:secrets: possíveis segredos no build publicado:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('Nada foi publicado por este script; corrija antes do deploy.');
  process.exit(1);
}
console.log(
  `check:secrets: ${scanned} arquivo(s) verificados em ${targets.map((t) => relative(repoRoot, t).replaceAll('\\', '/')).join(', ')}; ` +
    `${sensitiveValues.length} valor(es) sensível(is) do ambiente comparados. Nenhum segredo encontrado.`,
);
