import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,mjs}'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
