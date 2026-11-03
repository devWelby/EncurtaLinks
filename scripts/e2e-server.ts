/**
 * Servidor dos testes E2E (iniciado pelo Playwright).
 *
 * Banco descartável e recriado a cada execução; antiautomação simulado;
 * anúncios SIMULADOS servidos localmente (nunca anúncios reais em testes/CI):
 * o espaço primário carrega um banner falso e o secundário aponta para um
 * script que falha (simula provedor fora do ar).
 *
 * Também sobe o "destino simulado" (127.0.0.1:8897): o Playwright mapeia o
 * domínio destino-e2e.com.br para ele, e nenhum outro nome resolve.
 */
import { createServer } from 'node:http';
import { startLocalStack } from './lib/local-stack.ts';

export const E2E_PUBLIC_PORT = 8898;
export const E2E_ADMIN_PORT = 8899;
export const E2E_DESTINATION_PORT = 8897;
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

const destination = createServer((req, res) => {
  // Ecoa apenas caracteres seguros: é uma página de teste, sem dados reais.
  const host = (req.headers.host ?? '').replace(/[^A-Za-z0-9.:-]/g, '');
  const path = (req.url ?? '/').replace(/[^A-Za-z0-9/?=&.%_-]/g, '');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><html lang="pt-BR"><head><title>Destino simulado</title></head><body><h1>Destino simulado</h1><p id="host">${host}</p><p id="path">${path}</p></body></html>`);
});
await new Promise<void>((resolvePromise) => destination.listen(E2E_DESTINATION_PORT, '127.0.0.1', resolvePromise));

console.log(`[e2e] público ${stack.publicSite.origin} · painel ${stack.adminSite.origin} · destino simulado http://127.0.0.1:${E2E_DESTINATION_PORT}`);

let stopping = false;
const shutdown = (): void => {
  if (stopping) return;
  stopping = true;
  destination.closeAllConnections();
  destination.close();
  void stack.stop().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
