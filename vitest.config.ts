import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Modules read configuration at import time, so the environment has to be
    // valid before any test file loads.
    env: {
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-secret-value-that-is-long-enough-to-pass',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      LLM_PROVIDER: 'ollama',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_DIMENSIONS: '768',
      CHUNK_SIZE_TOKENS: '100',
      CHUNK_OVERLAP_TOKENS: '20',
    },
  },
})
