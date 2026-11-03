import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SLUG_ALPHABET, SLUG_LENGTH } from '../../shared/slug.ts';

/** Token opaco com aleatoriedade criptográfica, codificado em base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): Buffer {
  return createHash('sha256').update(input, 'utf8').digest();
}

export function hmacSha256(secret: string, input: string): Buffer {
  return createHmac('sha256', secret).update(input, 'utf8').digest();
}

/** Comparação em tempo constante para strings (evita vazamento por tempo). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Gera um slug aleatório com amostragem por rejeição (sem viés de módulo).
 * Usa `crypto.randomBytes`, nunca `Math.random`.
 */
export function generateSlug(length = SLUG_LENGTH): string {
  const alphabetSize = SLUG_ALPHABET.length;
  const limit = Math.floor(256 / alphabetSize) * alphabetSize;
  let slug = '';
  while (slug.length < length) {
    const bytes = randomBytes(length * 2);
    for (const byte of bytes) {
      if (byte < limit) {
        slug += SLUG_ALPHABET[byte % alphabetSize];
        if (slug.length === length) break;
      }
    }
  }
  return slug;
}
