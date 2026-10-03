import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
      },
    },
    rules: {
      // ESLint core does not mark JSX identifiers as used; React component names are PascalCase.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]' }],
    },
  },
];

