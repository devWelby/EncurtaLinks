/**
 * Servidor dos testes E2E (iniciado pelo Playwright).
 *
 * Banco descartável e recriado a cada execução; antiautomação simulado;
 * anúncios SIMULADOS servidos localmente (nunca anúncios reais em testes/CI):
 * o espaço primário carrega um banner falso e o secundário aponta para um
 * script que falha (simula provedor fora do ar).
 */
import { startLocalStack } from './lib/local-stack.ts';

export const E2E_PUBLIC_PORT = 8898;
export const E2E_ADMIN_PORT = 8899;
const publicOrigin = `http://localhost:${E2E_PUBLIC_PORT}`;

const stack = await startLocalStack({
  mode: 'test',
  publicPort: E2E_PUBLIC_PORT,
  adminPort: E2E_ADMIN_PORT,
  dbPort: 54332,
  dataDir: '.e2e-db',
  persistentDb: false,
  freshSchema: true,
  watchFrontend: false,
  log: process.env.E2E_LOG === '1',
  env: {
    ADS_ENABLED: 'true',
    ADS_DEV_PLACEHOLDER: 'false',
    ADSTERRA_SLOT_PRIMARY_HTML: `<script src="${publicOrigin}/__mock-ads/banner.js"></script>`,
    ADSTERRA_SLOT_SECONDARY_HTML: `<script src="${publicOrigin}/__mock-ads/fail.js"></script>`,
    // Limites mais altos: os testes criam muitos links a partir do mesmo IP.
    RATE_LIMIT_CREATE_PER_IP_10MIN: '500',
    RATE_LIMIT_CREATE_PER_IP_DAILY: '2000',
  },
});

console.log(`[e2e] público ${stack.publicSite.origin} · painel ${stack.adminSite.origin}`);

const shutdown = (): void => {
  void stack.stop().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
