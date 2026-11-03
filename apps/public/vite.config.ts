import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { assertSafeFrontendEnv } from '../../scripts/lib/build-guard.ts';

const root = import.meta.dirname;
const repoRoot = resolve(root, '..', '..');

/** Site público do EncurtaLinks (SPA + página 404 estática). */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repoRoot, 'VITE_'), ...process.env };
  assertSafeFrontendEnv(env, { usesTurnstile: true });
  return {
    root,
    envDir: repoRoot,
    publicDir: resolve(root, 'public'),
    plugins: [react()],
    server: { fs: { allow: [repoRoot] } },
    build: {
      outDir: resolve(repoRoot, 'dist', 'public'),
      emptyOutDir: true,
      sourcemap: false,
      assetsInlineLimit: 0,
      rolldownOptions: {
        input: {
          main: resolve(root, 'index.html'),
          notFound: resolve(root, '404.html'),
        },
      },
    },
  };
});
