import { createHash } from 'node:crypto';

/**
 * Integração opcional com o Adsterra.
 *
 * As tags vêm EXATAMENTE como fornecidas pela conta do proprietário (painel do
 * Adsterra → Websites → Get code) e são colocadas no HTML sem alteração — os
 * termos do Adsterra (cláusula 4.7) proíbem alterar a tag ou colocá-la em
 * iframe sem consentimento por escrito. Este módulo apenas:
 *   - verifica tamanho e elementos claramente indevidos;
 *   - calcula hashes CSP dos scripts inline e as origens dos scripts externos,
 *     para liberar na Content-Security-Policy somente o indispensável.
 *
 * Nenhum código, ID ou domínio do Adsterra é embutido aqui.
 */

export interface AdSlot {
  id: 'primary' | 'secondary';
  html: string;
  inlineScriptHashes: string[];
  scriptOrigins: string[];
}

export interface AdsCspSources {
  scriptSrc: string[];
  frameSrc: string[];
  connectSrc: string[];
  imgSrc: string[];
  styleSrc: string[];
}

export interface AdsConfig {
  envEnabled: boolean;
  requireConsent: boolean;
  slots: AdSlot[];
  extraCsp: AdsCspSources;
  /** Mostra um espaço simulado quando não há anúncios reais (somente fora de produção). */
  devPlaceholder: boolean;
  errors: string[];
}

const MAX_SNIPPET_LENGTH = 4000;
const FORBIDDEN_TAGS = /<\s*(iframe|form|base|meta|link|object|embed|frame|frameset)\b/i;
const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

export interface SnippetAnalysis {
  inlineScriptHashes: string[];
  scriptOrigins: string[];
  errors: string[];
}

export function analyzeSnippet(html: string, options: { allowHttp: boolean; allowedTestOrigins?: readonly string[] }): SnippetAnalysis {
  const errors: string[] = [];
  const inlineScriptHashes: string[] = [];
  const scriptOrigins = new Set<string>();
  if (html.length > MAX_SNIPPET_LENGTH) errors.push(`a tag excede ${MAX_SNIPPET_LENGTH} caracteres`);
  if (FORBIDDEN_TAGS.test(html)) errors.push('a tag contém elementos não permitidos (iframe, form, base, meta, link, object ou embed)');

  for (const match of html.matchAll(SCRIPT_TAG)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const src = SRC_ATTR.exec(attributes);
    if (src) {
      const value = src[1] ?? src[2] ?? src[3] ?? '';
      try {
        const url = new URL(value.startsWith('//') ? `https:${value}` : value);
        if (url.protocol !== 'https:' && !(options.allowHttp && url.protocol === 'http:')) {
          errors.push('scripts de anúncio devem usar https');
        } else {
          scriptOrigins.add(url.origin);
        }
      } catch {
        errors.push('a tag contém um script com endereço inválido');
      }
    } else if (body.trim() !== '') {
      inlineScriptHashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
    }
  }

  if (options.allowedTestOrigins !== undefined) {
    for (const origin of scriptOrigins) {
      if (!options.allowedTestOrigins.includes(origin)) {
        errors.push(`em testes/CI só são aceitos anúncios simulados locais (origem recusada: ${origin})`);
      }
    }
  }
  return { inlineScriptHashes, scriptOrigins: [...scriptOrigins], errors };
}

export function parseCspSourceList(value: string | undefined, allowHttp: boolean): { sources: string[]; errors: string[] } {
  const sources: string[] = [];
  const errors: string[] = [];
  for (const token of (value ?? '').split(/\s+/).filter(Boolean)) {
    try {
      const url = new URL(token);
      const okProtocol = url.protocol === 'https:' || (allowHttp && url.protocol === 'http:');
      if (!okProtocol || url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '') {
        errors.push(`origem CSP inválida: ${token}`);
        continue;
      }
      sources.push(url.origin);
    } catch {
      errors.push(`origem CSP inválida: ${token}`);
    }
  }
  return { sources, errors };
}

export function loadAdsConfig(
  env: Record<string, string | undefined>,
  options: { isProduction: boolean; isTestOrCi: boolean; testOrigins: readonly string[] },
): AdsConfig {
  const errors: string[] = [];
  const envEnabled = env.ADS_ENABLED === 'true';
  const requireConsent = env.ADS_REQUIRE_CONSENT !== 'false';
  const allowHttp = !options.isProduction;
  const slots: AdSlot[] = [];

  const slotSources: Array<[AdSlot['id'], string | undefined]> = [
    ['primary', env.ADSTERRA_SLOT_PRIMARY_HTML],
    ['secondary', env.ADSTERRA_SLOT_SECONDARY_HTML],
  ];
  for (const [id, raw] of slotSources) {
    const html = (raw ?? '').trim();
    if (html === '') continue;
    const analysis = analyzeSnippet(html, {
      allowHttp,
      ...(options.isTestOrCi ? { allowedTestOrigins: options.testOrigins } : {}),
    });
    if (analysis.errors.length > 0) {
      errors.push(...analysis.errors.map((e) => `ADSTERRA_SLOT_${id.toUpperCase()}_HTML: ${e}`));
      continue;
    }
    slots.push({ id, html, inlineScriptHashes: analysis.inlineScriptHashes, scriptOrigins: analysis.scriptOrigins });
  }

  const lists = {
    scriptSrc: parseCspSourceList(env.ADS_CSP_SCRIPT_SRC, allowHttp),
    frameSrc: parseCspSourceList(env.ADS_CSP_FRAME_SRC, allowHttp),
    connectSrc: parseCspSourceList(env.ADS_CSP_CONNECT_SRC, allowHttp),
    imgSrc: parseCspSourceList(env.ADS_CSP_IMG_SRC, allowHttp),
    styleSrc: parseCspSourceList(env.ADS_CSP_STYLE_SRC, allowHttp),
  };
  for (const list of Object.values(lists)) errors.push(...list.errors);
  if (envEnabled && slots.length === 0) errors.push('ADS_ENABLED=true, mas nenhuma tag válida foi configurada');

  return {
    envEnabled,
    requireConsent,
    slots,
    extraCsp: {
      scriptSrc: lists.scriptSrc.sources,
      frameSrc: lists.frameSrc.sources,
      connectSrc: lists.connectSrc.sources,
      imgSrc: lists.imgSrc.sources,
      styleSrc: lists.styleSrc.sources,
    },
    devPlaceholder: !options.isProduction && env.ADS_DEV_PLACEHOLDER !== 'false',
    errors,
  };
}

/** Fontes CSP necessárias para os slots que serão renderizados. */
export function cspForSlots(config: AdsConfig, slots: readonly AdSlot[]): AdsCspSources {
  const scriptOrigins = slots.flatMap((slot) => slot.scriptOrigins);
  const unique = (values: string[]): string[] => [...new Set(values)];
  return {
    scriptSrc: unique([...slots.flatMap((s) => s.inlineScriptHashes), ...scriptOrigins, ...config.extraCsp.scriptSrc]),
    frameSrc: unique([...scriptOrigins, ...config.extraCsp.frameSrc]),
    connectSrc: unique([...scriptOrigins, ...config.extraCsp.connectSrc]),
    imgSrc: unique(config.extraCsp.imgSrc),
    styleSrc: unique(config.extraCsp.styleSrc),
  };
}
