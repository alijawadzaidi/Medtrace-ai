'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**', '*.sqlite'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // The test suite needs Jest's globals; the rest of the codebase must not
    // have them, or a stray `describe` in src/ would lint clean.
    files: ['tests/**/*.js', 'jest.config.js'],
    languageOptions: { globals: { ...globals.jest } },
  },
];
