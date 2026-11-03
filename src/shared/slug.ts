/**
 * Alfabeto de slugs: 57 caracteres, sem os ambíguos 0, 1, I, O e l.
 * Com 10 caracteres há 57^10 ≈ 3,6 × 10^17 combinações (~58 bits).
 */
export const SLUG_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const SLUG_LENGTH = 10;

const SLUG_PATTERN = /^[2-9A-HJ-NP-Za-km-z]{10,32}$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value);
}

/**
 * Extrai o slug de um texto informado pelo usuário: pode ser o slug puro ou
 * um endereço como https://site/s/SLUG. Retorna null se não houver slug válido.
 */
export function extractSlug(input: string): string | null {
  const trimmed = input.trim();
  if (isValidSlug(trimmed)) return trimmed;
  const match = /\/s\/([^/?#\s]+)\/?(?:[?#].*)?$/.exec(trimmed);
  const candidate = match?.[1];
  return candidate !== undefined && isValidSlug(candidate) ? candidate : null;
}
