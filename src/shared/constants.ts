/** Constantes compartilhadas entre navegador e servidor (sem segredos). */

export const APP_NAME = 'EncurtaLinks';

export const MAX_URL_LENGTH = 2048;

/** Opções de expiração aceitas pela API. O padrão é "never" (sem expiração). */
export const EXPIRY_OPTIONS = [
  { id: 'never', label: 'Sem expiração', seconds: null },
  { id: '1d', label: '1 dia', seconds: 86_400 },
  { id: '7d', label: '7 dias', seconds: 7 * 86_400 },
  { id: '30d', label: '30 dias', seconds: 30 * 86_400 },
  { id: '90d', label: '90 dias', seconds: 90 * 86_400 },
  { id: '365d', label: '1 ano', seconds: 365 * 86_400 },
] as const;

export type ExpiryOptionId = (typeof EXPIRY_OPTIONS)[number]['id'];

export const DEFAULT_EXPIRY: ExpiryOptionId = 'never';

export const REPORT_REASONS = [
  { id: 'phishing', label: 'Phishing ou roubo de dados' },
  { id: 'malware', label: 'Malware ou download enganoso' },
  { id: 'fraud', label: 'Golpe ou fraude' },
  { id: 'spam', label: 'Spam' },
  { id: 'illegal', label: 'Conteúdo ilegal' },
  { id: 'other', label: 'Outro motivo' },
] as const;

export type ReportReasonId = (typeof REPORT_REASONS)[number]['id'];

export const TURNSTILE_ACTIONS = {
  createLink: 'create_link',
  reportLink: 'report_link',
} as const;

/** Token aceito pelo modo de teste do antiautomação (somente desenvolvimento local e testes). */
export const TEST_ANTIBOT_TOKEN = 'test-antibot-pass';

/** Nome do cookie de consentimento de publicidade (não é HttpOnly: é uma preferência). */
export const CONSENT_COOKIE = 'el_ads_consent';
