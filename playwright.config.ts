import { defineConfig, devices } from '@playwright/test';

/**
 * Testes E2E (navegador real) contra o ambiente local completo:
 * PostgreSQL real descartável, funções do Netlify executadas pelo emulador
 * local e builds de produção do frontend. Nenhum anúncio real: o servidor E2E
 * usa apenas anúncios simulados servidos localmente.
 *
 * Os testes rodam em sequência (1 worker): compartilham o banco e a
 * configuração global de anúncios.
 */
const PUBLIC_ORIGIN = 'http://localhost:8898';

/**
 * Isolamento de rede do navegador: o domínio de destino dos testes aponta
 * para o servidor de destino simulado (127.0.0.1:8897) e QUALQUER outro nome
 * deixa de resolver. Nenhuma requisição dos testes chega à internet.
 */
const HOST_RULES = [
  'MAP destino-e2e.com.br 127.0.0.1:8897',
  'MAP *.destino-e2e.com.br 127.0.0.1:8897',
  'MAP * ~NOTFOUND',
  'EXCLUDE localhost',
  'EXCLUDE 127.0.0.1',
].join(', ');

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI === 'true' ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: PUBLIC_ORIGIN,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], launchOptions: { args: [`--host-resolver-rules=${HOST_RULES}`] } },
    },
    {
      name: 'mobile',
      testMatch: /(mobile|public-flow)\.spec\.ts/,
      use: { ...devices['Pixel 5'], launchOptions: { args: [`--host-resolver-rules=${HOST_RULES}`] } },
    },
  ],
  webServer: {
    command: 'node scripts/e2e-server.ts',
    url: `${PUBLIC_ORIGIN}/`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
  },
});
