import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-core']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { regex: '^(\\.\\./)+(ui|worker|io|web)(/|$)', message: 'core is published on its own: no app or browser code' },
          { regex: '\\?', message: 'core is built without bundler queries' },
          { group: ['react', 'react-dom'], message: 'core has no UI' },
        ],
      }],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'self', 'localStorage', 'indexedDB', 'FileReaderSync', 'OffscreenCanvas', 'createImageBitmap'],
      'no-restricted-syntax': ['error', { selector: "MetaProperty[meta.name='import']", message: 'core is built without import.meta' }],
    },
  },
  {
    files: ['src/io/**/*.ts', 'src/web/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '^\\.\\./(ui|worker)(/|$)', message: 'io and web sit below the app' }] }],
    },
  },
])