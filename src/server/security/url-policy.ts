import { domainToUnicode } from 'node:url';
import { MAX_URL_LENGTH } from '../../shared/constants.ts';
import { checkUnicodeHostname } from './idn.ts';
import { classifyIp, parseIPv4, parseIPv6 } from './ip.ts';

/**
 * Política de URLs de destino (validação no servidor — a do navegador é só
 * conveniência). O serviço NÃO busca o conteúdo das URLs; por isso não há
 * risco de SSRF no MVP. Os bloqueios de endereços locais/privados evitam que
 * o encurtador seja usado para levar visitantes a serviços da rede deles.
 *
 * Validação de formato não comprova ausência de phishing ou malware.
 */

export type UrlRejectionCode =
  | 'invalid_type'
  | 'empty'
  | 'too_long'
  | 'invalid_characters'
  | 'missing_scheme'
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'credentials_not_allowed'
  | 'port_not_allowed'
  | 'ip_not_allowed'
  | 'private_address'
  | 'invalid_host'
  | 'reserved_host'
  | 'confusable_host'
  | 'self_reference';

export type UrlValidation =
  | { ok: true; url: string; host: string; unicodeHost: string; isIdn: boolean }
  | { ok: false; code: UrlRejectionCode; message: string };

export interface UrlPolicyOptions {
  /** Hostnames do próprio serviço (site público, painel). Bloqueia laços. */
  ownHosts: readonly string[];
}

const MESSAGES: Record<UrlRejectionCode, string> = {
  invalid_type: 'Informe o endereço como texto.',
  empty: 'Informe um endereço.',
  too_long: `O endereço deve ter no máximo ${MAX_URL_LENGTH} caracteres.`,
  invalid_characters: 'O endereço contém espaços ou caracteres de controle não permitidos.',
  missing_scheme: 'O endereço deve começar com https:// ou http://.',
  invalid_url: 'Endereço inválido.',
  unsupported_protocol: 'Somente endereços http e https são aceitos.',
  credentials_not_allowed: 'Endereços com usuário ou senha embutidos não são aceitos.',
  port_not_allowed: 'Endereços com porta personalizada não são aceitos.',
  ip_not_allowed: 'Use um nome de domínio; endereços IP não são aceitos.',
  private_address: 'Endereços locais, privados ou reservados não são aceitos.',
  invalid_host: 'O domínio do endereço é inválido.',
  reserved_host: 'Domínios locais, internos ou reservados não são aceitos.',
  confusable_host: 'O domínio usa caracteres que podem ser confundidos com outros e não é aceito.',
  self_reference: 'Não é possível encurtar endereços do próprio EncurtaLinks.',
};

/** Sufixos de uso especial/local (RFC 6761, RFC 8375, RFC 9476 e convenções comuns). */
const RESERVED_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'home.arpa',
  'corp',
  'private',
  'test',
  'example',
  'invalid',
  'onion',
  'arpa',
  'alt',
];

/** Serviços de DNS curinga que resolvem nomes para IPs arbitrários (inclusive privados). */
const WILDCARD_IP_DNS = ['nip.io', 'sslip.io', 'xip.io', 'localtest.me', 'lvh.me', 'vcap.me', 'traefik.me', 'lacolhost.com'];

/** Controles, espaços, bidi e caracteres de largura zero. */
// Caracteres de controle são exatamente o que esta expressão precisa detectar.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u0020\u007f-\u009f\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff\\]/u;

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function reject(code: UrlRejectionCode): UrlValidation {
  return { ok: false, code, message: MESSAGES[code] };
}

function matchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function isOwnHost(host: string, ownHosts: readonly string[]): boolean {
  for (const own of ownHosts) {
    const normalized = own.toLowerCase();
    if (normalized === '') continue;
    if (matchesSuffix(host, normalized)) return true;
    // URLs alternativas de deploy no Netlify: <id>--<site>.netlify.app
    const netlify = /^([a-z0-9-]+)\.netlify\.app$/.exec(normalized);
    if (netlify) {
      const site = netlify[1] ?? '';
      if (host.endsWith(`--${site}.netlify.app`) && /^[a-z0-9-]+$/.test(host.slice(0, -`--${site}.netlify.app`.length))) {
        return true;
      }
    }
  }
  return false;
}

export function validateDestinationUrl(input: unknown, options: UrlPolicyOptions): UrlValidation {
  if (typeof input !== 'string') return reject('invalid_type');
  const raw = input.trim();
  if (raw.length === 0) return reject('empty');
  if (raw.length > MAX_URL_LENGTH) return reject('too_long');
  if (FORBIDDEN_CHARS.test(raw)) return reject('invalid_characters');
  if (!/^https?:\/\//i.test(raw)) {
    return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? reject('unsupported_protocol') : reject('missing_scheme');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject('invalid_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject('unsupported_protocol');
  if (url.username !== '' || url.password !== '') return reject('credentials_not_allowed');
  // Portas padrão (80/443) são normalizadas para '' pelo parser; demais são recusadas.
  if (url.port !== '') return reject('port_not_allowed');

  const host = url.hostname.toLowerCase();
  if (host.startsWith('[')) {
    const v6 = parseIPv6(host);
    if (v6 === null) return reject('invalid_host');
    return classifyIp({ version: 6, parts: v6 }) === 'public' ? reject('ip_not_allowed') : reject('private_address');
  }
  const v4 = parseIPv4(host);
  if (v4 !== null) {
    return classifyIp({ version: 4, parts: v4 }) === 'public' ? reject('ip_not_allowed') : reject('private_address');
  }

  if (host.length > 253 || host.endsWith('.') || !host.includes('.')) return reject('invalid_host');
  const labels = host.split('.');
  if (!labels.every((label) => LABEL.test(label))) return reject('invalid_host');
  const tld = labels[labels.length - 1] ?? '';
  if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]{1,59}$/.test(tld)) return reject('invalid_host');

  if (RESERVED_SUFFIXES.some((suffix) => matchesSuffix(host, suffix))) return reject('reserved_host');
  if (WILDCARD_IP_DNS.some((suffix) => matchesSuffix(host, suffix))) return reject('private_address');
  if (isOwnHost(host, options.ownHosts)) return reject('self_reference');

  let unicodeHost = host;
  const isIdn = labels.some((label) => label.startsWith('xn--'));
  if (isIdn) {
    unicodeHost = domainToUnicode(host);
    if (unicodeHost === '' || unicodeHost.includes('�')) return reject('invalid_host');
    if (!checkUnicodeHostname(unicodeHost).ok) return reject('confusable_host');
  }

  const normalized = url.href;
  if (normalized.length > MAX_URL_LENGTH) return reject('too_long');
  return { ok: true, url: normalized, host, unicodeHost, isIdn };
}

/** Todos os sufixos de um host, do mais específico ao domínio de 2 níveis. */
export function hostSuffixes(host: string): string[] {
  const labels = host.split('.');
  const suffixes: string[] = [];
  for (let i = 0; i < labels.length - 1; i += 1) suffixes.push(labels.slice(i).join('.'));
  return suffixes;
}
