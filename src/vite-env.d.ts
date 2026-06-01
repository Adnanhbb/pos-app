/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_DEV_BACKDOOR?: string;
  readonly VITE_ALLOW_OFFLINE_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
