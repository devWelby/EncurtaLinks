import { defineConfig } from 'vitest/config';

/**
 * Testes unitários e de integração (Node). Os testes de integração usam um
 * PostgreSQL REAL: embarcado (padrão) ou o servidor indicado em
 * TEST_DATABASE_URL (ex.: serviço do GitHub Actions). Os arquivos rodam em
 * sequência porque compartilham o mesmo banco de teste.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/setup/global-db.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    restoreMocks: true,
    unstubEnvs: true,
  },
});
