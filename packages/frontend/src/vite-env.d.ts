/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELEASE_VERIFICATION_REQUIRED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
