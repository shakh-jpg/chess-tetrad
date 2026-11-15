// ESLint flat config. Goal: catch real mistakes (undefined names, unreachable code, typos),
// not to restyle the code base. The vendored chess.js and generated files are not linted.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/engine/**', 'public/pdfjs/**', 'src/core/chess.js', 'coverage/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-cond-assign': ['error', 'except-parens'],
      'no-inner-declarations': 'off',
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      // prototype code (moved verbatim) has harmless dead assignments and repeated 'var' declarations
      'no-useless-assignment': 'warn',
      'no-redeclare': 'warn'
    }
  },
  { files: ['src/engine/fallback-worker.js'], languageOptions: { globals: { ...globals.worker } } },
  { files: ['scripts/sw-template.js'], languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker, __ASSETS__: 'readonly' } } },
  { files: ['scripts/**/*.mjs', 'vite.config.js', 'eslint.config.js', 'playwright.config.js'], languageOptions: { globals: { ...globals.node } } },
  { files: ['tests/**/*.js', 'e2e/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } }
];
