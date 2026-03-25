const PRODUCTION_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABsfz4rYG4ymPupJGIK1n3a953VO6WzMDNK9I0HkMYUk=
-----END PUBLIC KEY-----
`;

// VITE_E2E_MANIFEST_PUBLIC_KEY_PEM is set only by `build:verification:e2e`
// to inject a test-only key pair. Production builds never set this variable.
export const MANIFEST_SIGNING_PUBLIC_KEY_PEM: string =
  import.meta.env.VITE_E2E_MANIFEST_PUBLIC_KEY_PEM ?? PRODUCTION_KEY_PEM;

// Raw 32-byte Ed25519 public key in base64url encoding, derived from the PEM.
// Ed25519 SPKI = 12-byte ASN.1 header + 32-byte raw key. This constant holds the raw key only,
// used by the @noble/ed25519 fallback verifier which does not accept SPKI format.
function deriveRawB64u(pem: string): string {
  const base64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/gu, '').replace(/\s+/gu, '');
  const binary = atob(base64);
  const rawBytes = binary.slice(12); // strip 12-byte SPKI header
  let result = '';
  for (let i = 0; i < rawBytes.length; i++) {
    result += String.fromCharCode(rawBytes.charCodeAt(i));
  }
  return btoa(result).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export const MANIFEST_SIGNING_PUBLIC_KEY_RAW_B64U: string = deriveRawB64u(
  MANIFEST_SIGNING_PUBLIC_KEY_PEM
);
