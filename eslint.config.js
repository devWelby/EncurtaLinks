// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', '.local-dist/**', 'node_modules/**', '.netlify/**', 'coverage/**', 'test-results/**', 'playwright-report/**', '.test-db/**', '.e2e-db/**', '.local-db/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.server.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // Código que vai para o navegador: nunca importar módulos de servidor.
    files: ['apps/public/src/**/*.{ts,tsx}', 'apps/admin/src/**/*.{ts,tsx}', 'src/shared/**/*.ts', 'src/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/server/**', '**/netlify/**', '**/scripts/**'], message: 'Código de servidor não pode ser importado no navegador.' },
            { group: ['node:*', 'pg', 'pg/*', 'oauth4webapi'], message: 'Dependência de servidor não pode entrar no bundle do navegador.' },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'localStorage', message: 'Não armazene dados sensíveis em localStorage.' },
        { object: 'window', property: 'localStorage', message: 'Não armazene dados sensíveis em localStorage.' },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts', 'apps/*/netlify/**/*.mts', 'scripts/**/*.ts', 'tests/**/*.ts', '*.config.ts', 'apps/*/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
