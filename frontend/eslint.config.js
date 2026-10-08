import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Colors come from the design tokens in src/styles/variables.css.
    files: ['src/**/*.{js,jsx}'],
    ignores: [
      'src/features/admin/**',
      'src/features/patient/services/carePlanPdfService.js',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\\w-])/]',
          message: 'Use a design token like var(--color-primary) instead of a hex color.',
        },
        {
          selector: 'TemplateElement[value.raw=/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\\w-])/]',
          message: 'Use a design token like var(--color-primary) instead of a hex color.',
        },
      ],
    },
  },
])
