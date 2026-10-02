import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/vendor/**', 'dist/js/fold-net-data.js', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['dist/js/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['tests/**/*.mjs', 'tools/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
