import { defineConfig } from 'vitest/config'

// Core tests run in Node on the same SQLite WebAssembly build as the phone.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/core/testing.setup.ts']
  }
})
