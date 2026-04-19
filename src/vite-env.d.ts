/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/preact" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_PUSH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
