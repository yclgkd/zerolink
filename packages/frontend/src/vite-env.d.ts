/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELEASE_VERIFICATION_REQUIRED?: string;
  readonly VITE_E2E_MANIFEST_PUBLIC_KEY_PEM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
