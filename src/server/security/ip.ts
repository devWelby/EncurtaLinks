/**
 * Análise de endereços IP literais (IPv4 e IPv6) sem dependências externas.
 *
 * Importante: o parser WHATWG (`new URL`) já normaliza representações
 * alternativas de IPv4 em URLs http/https (decimal "2130706433", hexadecimal
 * "0x7f000001", octal "0177.0.0.1", formas curtas "127.1") para a notação
 * pontuada. As funções abaixo também aceitam somente as formas canônicas.
 */

export type IpKind = 'public' | 'non_public';

export interface ParsedIp {
  version: 4 | 6;
  /** IPv4: 4 octetos. IPv6: 8 blocos de 16 bits. */
  parts: number[];
}

export function parseIPv4(input: string): number[] | null {
  const pieces = input.split('.');
  if (pieces.length !== 4) return null;
  const parts: number[] = [];
  for (const piece of pieces) {
    if (!/^(0|[1-9]\d{0,2})$/.test(piece)) return null;
    const value = Number(piece);
    if (value > 255) return null;
    parts.push(value);
  }
  return parts;
}

export function parseIPv6(input: string): number[] | null {
  let text = input.toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (text.length === 0 || text.includes('%')) return null;

  // Notação com IPv4 embutido nos últimos 32 bits (ex.: ::ffff:192.0.2.1).
  let tail: number[] = [];
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon < 0) return null;
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0)];
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }

  const doubleColon = text.indexOf('::');
  if (doubleColon !== text.lastIndexOf('::')) return null;

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups = segment.split(':');
    const values: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      values.push(parseInt(group, 16));
    }
    return values;
  };

  let groups: number[];
  if (doubleColon >= 0) {
    const head = parseGroups(text.slice(0, doubleColon));
    const rest = parseGroups(text.slice(doubleColon + 2));
    if (head === null || rest === null) return null;
    const missing = 8 - head.length - rest.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest, ...tail];
  } else {
    const all = parseGroups(text);
    if (all === null) return null;
    groups = [...all, ...tail];
  }
  return groups.length === 8 ? groups : null;
}

export function parseIp(input: string): ParsedIp | null {
  const v4 = parseIPv4(input);
  if (v4) return { version: 4, parts: v4 };
  const v6 = parseIPv6(input);
  if (v6) return { version: 6, parts: v6 };
  return null;
}

type V4Range = readonly [number, number, number, number, number];

/** Faixas IPv4 que não são endereços públicos roteáveis. */
const NON_PUBLIC_V4: readonly V4Range[] = [
  [0, 0, 0, 0, 8], // "esta rede"
  [10, 0, 0, 0, 8], // privada
  [100, 64, 0, 0, 10], // CGNAT (inclui o metadata 100.100.100.200 da Alibaba Cloud)
  [127, 0, 0, 0, 8], // loopback
  [169, 254, 0, 0, 16], // link-local (inclui 169.254.169.254 de AWS/GCP/Azure)
  [172, 16, 0, 0, 12], // privada
  [192, 0, 0, 0, 24], // atribuições de protocolo IETF
  [192, 0, 2, 0, 24], // documentação TEST-NET-1
  [192, 88, 99, 0, 24], // relay 6to4 (obsoleto)
  [192, 168, 0, 0, 16], // privada
  [198, 18, 0, 0, 15], // benchmarking
  [198, 51, 100, 0, 24], // documentação TEST-NET-2
  [203, 0, 113, 0, 24], // documentação TEST-NET-3
  [224, 0, 0, 0, 4], // multicast
  [240, 0, 0, 0, 4], // reservado + broadcast
];

function v4ToInt(parts: readonly number[]): number {
  return (((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)) >>> 0;
}

export function classifyIPv4(parts: readonly number[]): IpKind {
  const value = v4ToInt(parts);
  for (const [a, b, c, d, bits] of NON_PUBLIC_V4) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === (v4ToInt([a, b, c, d]) & mask) >>> 0) return 'non_public';
  }
  return 'public';
}

function embeddedV4(groups: readonly number[], highIndex: number): number[] {
  const high = groups[highIndex] ?? 0;
  const low = groups[highIndex + 1] ?? 0;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

export function classifyIPv6(groups: readonly number[]): IpKind {
  const g = (i: number): number => groups[i] ?? 0;
  const firstFiveZero = g(0) === 0 && g(1) === 0 && g(2) === 0 && g(3) === 0 && g(4) === 0;
  // ::ffff:a.b.c.d (IPv4 mapeado) e ::a.b.c.d (IPv4 compatível, obsoleto)
  if (firstFiveZero && (g(5) === 0xffff || g(5) === 0)) {
    if (g(5) === 0 && g(6) === 0) return 'non_public'; // ::, ::1 e afins
    return classifyIPv4(embeddedV4(groups, 6)) === 'public' && g(5) === 0xffff ? 'public' : 'non_public';
  }
  // NAT64 64:ff9b::/96 — classifica o IPv4 embutido
  if (g(0) === 0x64 && g(1) === 0xff9b && g(2) === 0 && g(3) === 0 && g(4) === 0 && g(5) === 0) {
    return classifyIPv4(embeddedV4(groups, 6));
  }
  // Somente 2000::/3 é unicast global atualmente.
  if ((g(0) & 0xe000) !== 0x2000) return 'non_public';
  if (g(0) === 0x2001 && g(1) < 0x0200) return 'non_public'; // 2001::/23 (Teredo, benchmarking, ORCHID...)
  if (g(0) === 0x2001 && g(1) === 0x0db8) return 'non_public'; // documentação
  if (g(0) === 0x3fff && (g(1) & 0xf000) === 0) return 'non_public'; // 3fff::/20 documentação
  if (g(0) === 0x2002) return classifyIPv4(embeddedV4(groups, 1)); // 6to4
  return 'public';
}

export function classifyIp(ip: ParsedIp): IpKind {
  return ip.version === 4 ? classifyIPv4(ip.parts) : classifyIPv6(ip.parts);
}

/**
 * Normaliza o IP do cliente para limitação de uso: IPv4 integral e IPv6
 * agregado por /64 (um único assinante costuma receber um /64 inteiro).
 * Retorna null para entradas que não são IPs válidos.
 */
export function normalizeClientIp(input: string): string | null {
  const parsed = parseIp(input.trim());
  if (parsed === null) return null;
  if (parsed.version === 4) return `v4:${parsed.parts.join('.')}`;
  const g = parsed.parts;
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return `v4:${embeddedV4(g, 6).join('.')}`;
  }
  return `v6:${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(':')}::/64`;
}
