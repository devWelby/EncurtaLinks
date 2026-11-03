/**
 * npm run dev — ambiente local do EncurtaLinks.
 *
 * Usa PostgreSQL embarcado persistente em .local-db/ (ou DEV_DATABASE_URL,
 * somente localhost), antiautomação simulado e marcador de anúncio no lugar
 * de anúncios reais. O frontend é recompilado ao salvar arquivos.
 */
import { startLocalStack } from './lib/local-stack.ts';

const stack = await startLocalStack({
  mode: 'development',
  publicPort: Number(process.env.PUBLIC_PORT ?? 8888),
  adminPort: Number(process.env.ADMIN_PORT ?? 8889),
  dbPort: Number(process.env.DEV_DB_PORT ?? 54330),
  dataDir: '.local-db',
  persistentDb: true,
  freshSchema: false,
  watchFrontend: true,
  log: true,
});

console.log(`
EncurtaLinks (desenvolvimento local)
  Site público: ${stack.publicSite.origin}
  Painel:       ${stack.adminSite.origin}  →  login local: ${stack.adminSite.origin}/__dev/admin-login
  Ctrl+C para encerrar.
`);

let stopping = false;
const shutdown = (): void => {
  if (stopping) return;
  stopping = true;
  void stack.stop().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
