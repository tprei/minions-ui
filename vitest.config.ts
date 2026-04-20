import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

let preactPlugin: unknown[] = []
try {
  const mod = await import('@preact/preset-vite')
  preactPlugin = [(mod.default || mod)()]
} catch { /* optional dependency */ }

export default defineConfig({
  plugins: preactPlugin,
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxImportSource: 'preact',
  },
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
