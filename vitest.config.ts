import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [preact()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'virtual:pwa-register/preact': resolve(__dirname, 'test/mocks/pwa-register.ts'),
      'idb-keyval': resolve(__dirname, 'test/mocks/idb-keyval.ts'),
    },
  },
})
