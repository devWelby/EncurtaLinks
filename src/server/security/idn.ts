/**
 * Verificações heurísticas para domínios internacionalizados (IDN).
 *
 * Não existe verificação perfeita contra confusão visual (homógrafos). As
 * regras abaixo rejeitam os casos mais comuns de ataque — rótulos que misturam
 * alfabetos e rótulos cirílicos/gregos compostos só por letras parecidas com
 * letras latinas sob um TLD latino — e a página intermediária sempre mostra
 * o domínio em ASCII (punycode) para conferência.
 */

const SCRIPTS = [
  'Latin',
  'Cyrillic',
  'Greek',
  'Armenian',
  'Georgian',
  'Hebrew',
  'Arabic',
  'Devanagari',
  'Bengali',
  'Thai',
  'Han',
  'Hiragana',
  'Katakana',
  'Hangul',
  'Bopomofo',
  'Cherokee',
] as const;

type Script = (typeof SCRIPTS)[number] | 'Other';

const SCRIPT_TESTS: ReadonlyArray<readonly [Script, RegExp]> = SCRIPTS.map(
  (script) => [script, new RegExp(`^\\p{Script=${script}}$`, 'u')] as const,
);

/** Combinações legítimas de múltiplos alfabetos num mesmo rótulo. */
const ALLOWED_COMBINATIONS: ReadonlyArray<ReadonlySet<Script>> = [
  new Set<Script>(['Han', 'Hiragana', 'Katakana']),
  new Set<Script>(['Han', 'Hangul']),
  new Set<Script>(['Han', 'Bopomofo']),
];

/** Letras cirílicas e gregas visualmente quase idênticas a letras latinas. */
const LATIN_LOOKALIKES = new Set(
  [
    // Cirílico
    'а', 'в', 'е', 'к', 'м', 'н', 'о', 'р', 'с', 'т', 'у', 'х', 'ѕ', 'і', 'ј', 'ԁ', 'ӏ', 'һ', 'ԛ', 'ԝ', 'ү', 'ɡ',
    // Grego
    'α', 'ο', 'ρ', 'ν', 'κ', 'ι', 'υ', 'τ', 'ε', 'χ', 'ω',
  ].map((c) => c.normalize('NFC')),
);

function scriptOf(char: string): Script | null {
  if (!/\p{L}/u.test(char)) return null; // dígitos, hífen e marcas não contam
  for (const [script, test] of SCRIPT_TESTS) {
    if (test.test(char)) return script;
  }
  return 'Other';
}

export function labelScripts(label: string): Set<Script> {
  const scripts = new Set<Script>();
  for (const char of label) {
    const script = scriptOf(char);
    if (script !== null) scripts.add(script);
  }
  return scripts;
}

export type IdnVerdict = { ok: true } | { ok: false; reason: 'mixed_scripts' | 'latin_lookalike' };

export function checkUnicodeHostname(unicodeHost: string): IdnVerdict {
  const labels = unicodeHost.split('.');
  const tld = labels[labels.length - 1] ?? '';
  const tldIsAscii = /^[a-z0-9-]+$/i.test(tld);

  for (const label of labels) {
    const scripts = labelScripts(label);
    if (scripts.size > 1) {
      const allowed = ALLOWED_COMBINATIONS.some((combo) => [...scripts].every((s) => combo.has(s)));
      if (!allowed) return { ok: false, reason: 'mixed_scripts' };
    }
    if (tldIsAscii && (scripts.has('Cyrillic') || scripts.has('Greek')) && scripts.size === 1) {
      const letters = [...label.normalize('NFC')].filter((c) => /\p{L}/u.test(c));
      if (letters.length > 0 && letters.every((c) => LATIN_LOOKALIKES.has(c.toLowerCase()))) {
        return { ok: false, reason: 'latin_lookalike' };
      }
    }
  }
  return { ok: true };
}
