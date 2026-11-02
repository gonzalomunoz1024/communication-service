import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import playwright from 'eslint-plugin-playwright'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * `npm run lint`. The frontend's base (frontend/eslint.config.js: the recommended JavaScript and
 * typescript-eslint sets) without its React rules, plus eslint-plugin-playwright's recommended set
 * for the specs: unawaited Playwright calls and assertions, expects outside a test or under a
 * condition, focused or skipped tests, fixed waits, assertions that do not retry.
 */
export default defineConfig([
  globalIgnores(['node_modules', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: globals.node },
  },
  {
    files: ['tests/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
  },
])
