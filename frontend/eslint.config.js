import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * `npm run lint`. The react-hooks preset is the React Compiler-era set (rules of hooks,
 * exhaustive deps, no setState in effects, render purity), so hooks stay compiler-ready.
 */
export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
  },
  {
    // tests and the Vite config run under Node as well; test files export helpers next to components
    files: ['vite.config.ts', 'src/test/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
