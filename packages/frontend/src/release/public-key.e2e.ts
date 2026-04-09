// E2E-only override: replaces public-key.ts via Vite resolve.alias during
// `build:verification:e2e`. This key pair has zero security value — the
// private key is intentionally committed at e2e/support/e2e-test-only-signing.key
// so Playwright can sign throwaway manifests during tests.
import { pemToSpkiBytes, spkiToRawEd25519 } from './crypto';

export const MANIFEST_SIGNING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAdZi2pVke2Eo6rUT8ca1oFTVLUmFnMuwxNsGu6PnCdoI=
-----END PUBLIC KEY-----
`;

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export const MANIFEST_SIGNING_PUBLIC_KEY_RAW_B64U = toBase64Url(
  spkiToRawEd25519(pemToSpkiBytes(MANIFEST_SIGNING_PUBLIC_KEY_PEM))
);
