import { defineConfig } from 'vitest/config'
import { define } from './buildInfo'

export default defineConfig({
  define,
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 600000,
    hookTimeout: 600000,
  },
})
