import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { assertSafeFrontendEnv } from '../../scripts/lib/build-guard.ts';

const root = import.meta.dirname;
const repoRoot = resolve(root, '..', '..');

/** Painel administrativo do EncurtaLinks (origem separada, sem anúncios). */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repoRoot, 'VITE_'), ...process.env };
  assertSafeFrontendEnv(env, { usesTurnstile: false });
  return {
    root,
    envDir: repoRoot,
    publicDir: resolve(root, 'public'),
    plugins: [react()],
    server: { fs: { allow: [repoRoot] } },
    build: {
      outDir: resolve(repoRoot, 'dist', 'admin'),
      emptyOutDir: true,
      sourcemap: false,
      assetsInlineLimit: 0,
    },
  };
});
