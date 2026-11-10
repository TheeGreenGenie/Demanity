import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Operator scripts run directly in Node.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
