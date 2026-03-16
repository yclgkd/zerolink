export const MANIFEST_SIGNING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABsfz4rYG4ymPupJGIK1n3a953VO6WzMDNK9I0HkMYUk=
-----END PUBLIC KEY-----
`;

// Raw 32-byte Ed25519 public key in base64url encoding, derived from the PEM above.
// Ed25519 SPKI = 12-byte ASN.1 header + 32-byte raw key. This constant holds the raw key only,
// used by the @noble/ed25519 fallback verifier which does not accept SPKI format.
export const MANIFEST_SIGNING_PUBLIC_KEY_RAW_B64U = 'Bsfz4rYG4ymPupJGIK1n3a953VO6WzMDNK9I0HkMYUk';
