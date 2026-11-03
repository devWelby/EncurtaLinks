import { TURNSTILE_DUMMY_SECRETS } from './integrations/turnstile.ts';
import { loadAdsConfig, type AdsConfig } from './ads/adsterra.ts';
import type { DatabaseOptions } from './db/pool.ts';

/**
 * Configuração lida das variáveis de ambiente das funções.
 *
 * Classificação das variáveis (veja docs/configuracao.md):
 *   - Segredos de execução (nunca no navegador): DATABASE_URL, IP_HASH_SECRET,
 *     TURNSTILE_SECRET_KEY, GITHUB_CLIENT_SECRET.
 *   - Configuração não secreta: PUBLIC_SITE_URL, ADMIN_SITE_URL, ADS_*, limites.
 *   - Variáveis públicas do frontend: somente as com prefixo VITE_ (definidas no build).
 *
 * O ambiente de produção é determinado pelo contexto de deploy informado pelo
 * Netlify em tempo de execução (context.deploy.context), não apenas por APP_ENV.
 */

export type AppEnv = 'development' | 'test' | 'preview' | 'staging' | 'production';

export interface RuntimeFlags {
  appEnv: AppEnv;
  deployContext: string;
  isProduction: boolean;
  /** Modos de teste (antiautomação simulada) — somente local, nunca em deploys. */
  allowTestModes: boolean;
}

export interface CommonConfig extends RuntimeFlags {
  publicSiteUrl: URL;
  adminSiteUrl: URL | null;
  database: DatabaseOptions;
  ipHashSecret: string;
}

export interface RateLimitSettings {
  createPerIp10Min: number;
  createPerIpDaily: number;
  createGlobalHourly: number;
  reportPerIpHourly: number;
  reportGlobalHourly: number;
  viewPerIpMinute: number;
  continuePerIpMinute: number;
}

export interface PublicConfig extends CommonConfig {
  antibot: { mode: 'turnstile' | 'test'; secretKey: string; allowDummySecret: boolean };
  ads: AdsConfig;
  tickets: { ttlSeconds: number; minWaitSeconds: number };
  rateLimits: RateLimitSettings;
  reportAutoBlockThreshold: number;
}

export interface AdminConfig extends CommonConfig {
  adminSiteUrl: URL;
  github: { clientId: string; clientSecret: string; allowedUserIds: ReadonlySet<number>; require2fa: boolean } | null;
  session: { absoluteTtlSeconds: number; idleTimeoutSeconds: number };
  rateLimits: { apiPerSession10Min: number; authPerIp10Min: number };
}

export type ConfigResult<T> = { ok: true; config: T; warnings: string[] } | { ok: false; errors: string[] };

type Env = Record<string, string | undefined>;

const DEV_IP_HASH_SECRET = 'insecure-development-only-ip-hash-secret';

export function resolveRuntimeFlags(env: Env, deployContext: string): RuntimeFlags {
  const fromContext: AppEnv =
    deployContext === 'production'
      ? 'production'
      : deployContext === 'deploy-preview'
        ? 'preview'
        : deployContext === 'branch-deploy'
          ? 'staging'
          : 'development';
  const declared = env.APP_ENV as AppEnv | undefined;
  const valid: AppEnv[] = ['development', 'test', 'preview', 'staging', 'production'];
  const appEnv: AppEnv = declared !== undefined && valid.includes(declared) ? declared : fromContext;
  const isProduction = deployContext === 'production' || appEnv === 'production';
  const allowTestModes = !isProduction && deployContext === 'dev' && (appEnv === 'development' || appEnv === 'test');
  return { appEnv: isProduction ? 'production' : appEnv, deployContext, isProduction, allowTestModes };
}

function parseUrl(name: string, value: string | undefined, flags: RuntimeFlags, errors: string[]): URL | null {
  if (value === undefined || value === '') return null;
  try {
    const url = new URL(value);
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      errors.push(`${name} deve conter somente a origem (ex.: https://exemplo.netlify.app)`);
      return null;
    }
    if (flags.isProduction && url.protocol !== 'https:') {
      errors.push(`${name} deve usar https em produção`);
      return null;
    }
    return url;
  } catch {
    errors.push(`${name} não é uma URL válida`);
    return null;
  }
}

function parseIntSetting(env: Env, name: string, fallback: number, min: number, max: number, errors: string[]): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} deve ser um inteiro entre ${min} e ${max}`);
    return fallback;
  }
  return value;
}

function loadCommon(env: Env, deployContext: string, errors: string[], warnings: string[], kind: 'public' | 'admin'): CommonConfig | null {
  const flags = resolveRuntimeFlags(env, deployContext);

  const devDefault = kind === 'public' ? 'http://localhost:8888' : 'http://127.0.0.1:8889';
  const publicSiteUrl =
    parseUrl('PUBLIC_SITE_URL', env.PUBLIC_SITE_URL ?? (kind === 'public' ? env.URL : undefined), flags, errors) ??
    (flags.isProduction ? null : new URL(kind === 'public' ? devDefault : 'http://localhost:8888'));
  if (publicSiteUrl === null) errors.push('PUBLIC_SITE_URL é obrigatória em produção');

  const adminSiteUrl = parseUrl('ADMIN_SITE_URL', env.ADMIN_SITE_URL ?? (kind === 'admin' ? env.URL : undefined), flags, errors);

  const databaseUrl = env.DATABASE_URL ?? '';
  if (databaseUrl === '') errors.push('DATABASE_URL não configurada');
  const ssl = env.DATABASE_SSL === 'disable' ? 'disable' : 'verify';
  if (ssl === 'disable' && flags.isProduction) errors.push('DATABASE_SSL=disable não é permitido em produção');
  const caCert = env.DATABASE_CA_CERT ? env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : undefined;

  let ipHashSecret = env.IP_HASH_SECRET ?? '';
  if (ipHashSecret === '') {
    if (flags.isProduction) errors.push('IP_HASH_SECRET é obrigatória em produção');
    else {
      warnings.push('IP_HASH_SECRET ausente: usando segredo de desenvolvimento');
      ipHashSecret = DEV_IP_HASH_SECRET;
    }
  } else if (ipHashSecret.length < 32) {
    errors.push('IP_HASH_SECRET deve ter pelo menos 32 caracteres');
  } else if (flags.isProduction && ipHashSecret === DEV_IP_HASH_SECRET) {
    errors.push('IP_HASH_SECRET de desenvolvimento não pode ser usada em produção');
  }

  if (publicSiteUrl === null) return null;
  return {
    ...flags,
    publicSiteUrl,
    adminSiteUrl,
    database: { connectionString: databaseUrl, ssl, caCert },
    ipHashSecret,
  };
}

export function loadPublicConfig(env: Env, deployContext: string): ConfigResult<PublicConfig> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const common = loadCommon(env, deployContext, errors, warnings, 'public');

  const mode = env.ANTIBOT_MODE === 'test' ? 'test' : 'turnstile';
  const secretKey = env.TURNSTILE_SECRET_KEY ?? '';
  if (common !== null) {
    if (mode === 'test' && !common.allowTestModes) {
      errors.push('ANTIBOT_MODE=test só é permitido em desenvolvimento local ou testes');
    }
    if (mode === 'turnstile') {
      if (secretKey === '') errors.push('TURNSTILE_SECRET_KEY não configurada');
      if (common.isProduction && TURNSTILE_DUMMY_SECRETS.has(secretKey)) {
        errors.push('TURNSTILE_SECRET_KEY de teste não pode ser usada em produção');
      }
    }
  }

  const isTestOrCi = common?.appEnv === 'test' || env.CI === 'true';
  const ads = loadAdsConfig(env, {
    isProduction: common?.isProduction ?? true,
    isTestOrCi,
    testOrigins: [common?.publicSiteUrl.origin ?? ''],
  });
  if (ads.errors.length > 0) {
    // Erros de anúncio não derrubam o site: a publicidade fica desligada.
    warnings.push(...ads.errors.map((e) => `Publicidade desativada: ${e}`));
  }

  const tickets = {
    ttlSeconds: parseIntSetting(env, 'TICKET_TTL_SECONDS', 1800, 60, 86_400, errors),
    minWaitSeconds: parseIntSetting(env, 'CONTINUE_MIN_WAIT_SECONDS', 0, 0, 15, errors),
  };
  const rateLimits: RateLimitSettings = {
    createPerIp10Min: parseIntSetting(env, 'RATE_LIMIT_CREATE_PER_IP_10MIN', 10, 1, 1000, errors),
    createPerIpDaily: parseIntSetting(env, 'RATE_LIMIT_CREATE_PER_IP_DAILY', 50, 1, 10_000, errors),
    createGlobalHourly: parseIntSetting(env, 'RATE_LIMIT_CREATE_GLOBAL_HOURLY', 600, 1, 1_000_000, errors),
    reportPerIpHourly: parseIntSetting(env, 'RATE_LIMIT_REPORT_PER_IP_HOURLY', 5, 1, 1000, errors),
    reportGlobalHourly: parseIntSetting(env, 'RATE_LIMIT_REPORT_GLOBAL_HOURLY', 200, 1, 100_000, errors),
    viewPerIpMinute: parseIntSetting(env, 'RATE_LIMIT_VIEW_PER_IP_MINUTE', 120, 1, 10_000, errors),
    continuePerIpMinute: parseIntSetting(env, 'RATE_LIMIT_CONTINUE_PER_IP_MINUTE', 120, 1, 10_000, errors),
  };
  const reportAutoBlockThreshold = parseIntSetting(env, 'REPORT_AUTO_BLOCK_THRESHOLD', 5, 0, 1000, errors);

  if (common === null || errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    config: {
      ...common,
      antibot: { mode, secretKey, allowDummySecret: !common.isProduction },
      ads: ads.errors.length > 0 ? { ...ads, envEnabled: false, slots: [] } : ads,
      tickets,
      rateLimits,
      reportAutoBlockThreshold,
    },
  };
}

export function loadAdminConfig(env: Env, deployContext: string): ConfigResult<AdminConfig> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const common = loadCommon(env, deployContext, errors, warnings, 'admin');

  let adminSiteUrl = common?.adminSiteUrl ?? null;
  if (adminSiteUrl === null && common !== null && !common.isProduction) adminSiteUrl = new URL('http://127.0.0.1:8889');
  if (adminSiteUrl === null) errors.push('ADMIN_SITE_URL é obrigatória');

  let github: AdminConfig['github'] = null;
  const clientId = env.GITHUB_CLIENT_ID ?? '';
  const clientSecret = env.GITHUB_CLIENT_SECRET ?? '';
  const rawIds = (env.ADMIN_GITHUB_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = new Set<number>();
  for (const raw of rawIds) {
    if (!/^\d{1,15}$/.test(raw)) errors.push('ADMIN_GITHUB_USER_IDS deve conter IDs numéricos do GitHub separados por vírgula');
    else ids.add(Number(raw));
  }
  if (clientId !== '' || clientSecret !== '' || ids.size > 0) {
    if (clientId === '' || clientSecret === '') errors.push('GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET são obrigatórios juntos');
    if (ids.size === 0) errors.push('ADMIN_GITHUB_USER_IDS deve listar ao menos um administrador');
    github = { clientId, clientSecret, allowedUserIds: ids, require2fa: env.ADMIN_REQUIRE_GITHUB_2FA !== 'false' };
  } else if (common?.isProduction) {
    errors.push('Login administrativo não configurado (GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, ADMIN_GITHUB_USER_IDS)');
  }

  const session = {
    absoluteTtlSeconds: parseIntSetting(env, 'ADMIN_SESSION_TTL_SECONDS', 8 * 3600, 600, 24 * 3600, errors),
    idleTimeoutSeconds: parseIntSetting(env, 'ADMIN_SESSION_IDLE_SECONDS', 30 * 60, 300, 8 * 3600, errors),
  };
  const rateLimits = {
    apiPerSession10Min: parseIntSetting(env, 'RATE_LIMIT_ADMIN_API_PER_SESSION_10MIN', 600, 10, 100_000, errors),
    authPerIp10Min: parseIntSetting(env, 'RATE_LIMIT_ADMIN_AUTH_PER_IP_10MIN', 20, 1, 1000, errors),
  };

  if (common === null || adminSiteUrl === null || errors.length > 0) return { ok: false, errors };
  return { ok: true, warnings, config: { ...common, adminSiteUrl, github, session, rateLimits } };
}
