/// <reference types="vite/client" />

/** Variáveis públicas do frontend (definidas no build; NUNCA coloque segredos com prefixo VITE_). */
interface ImportMetaEnv {
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_ANTIBOT_MODE?: 'turnstile' | 'test';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
