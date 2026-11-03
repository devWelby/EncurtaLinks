/**
 * Template HTML com escape automático: todo valor interpolado é escapado,
 * exceto instâncias de SafeHtml (produzidas por `html` ou, de forma
 * explícita e auditável, por `trustedHtml`).
 */

export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (char) => ESCAPES[char] ?? char);
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'string') return escapeHtml(value);
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return escapeHtml(String(value));
  if (value instanceof Date) return escapeHtml(value.toISOString());
  // Objetos arbitrários não são renderizados implicitamente (evita "[object Object]" e vazamentos).
  throw new TypeError('Valor não suportado no template HTML');
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? '';
  values.forEach((value, index) => {
    out += render(value) + (strings[index + 1] ?? '');
  });
  return new SafeHtml(out);
}

/**
 * Insere HTML sem escape. Use SOMENTE para conteúdo confiável e controlado
 * pelo proprietário (tags de anúncio vindas de variáveis de ambiente) ou
 * gerado pelo próprio código.
 */
export function trustedHtml(value: string): SafeHtml {
  return new SafeHtml(value);
}
