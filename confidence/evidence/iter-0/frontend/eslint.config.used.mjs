import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
export default [
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
    languageOptions: { globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', fetch: 'readonly', EventSource: 'readonly', TextEncoder: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', Response: 'readonly', RequestInit: 'readonly', MessageEvent: 'readonly', HTMLElement: 'readonly', HTMLInputElement: 'readonly', HTMLTextAreaElement: 'readonly', HTMLButtonElement: 'readonly', Intl: 'readonly', navigator: 'readonly', URLSearchParams: 'readonly', getComputedStyle: 'readonly', CSS: 'readonly', MediaQueryList: 'readonly' } },
  },
]
