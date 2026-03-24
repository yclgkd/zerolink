import type { Base64Url, StoredCredential } from '@zerolink/shared';
import { describe, expect, it } from 'vitest';

import {
  createMockAssertion,
  createTamperedAssertion,
} from '../../__tests__/helpers/webauthn-fixtures.ts';
import { decodeBase64Url, encodeBase64Url } from '../bytes.ts';
import {
  derToP1363,
  generateCreationOptions,
  verifyAssertion,
  type WebAuthnVerifyParams,
} from '../webauthn.ts';

const RP_ID = 'zerolink.test';
const RP_ORIGIN = 'https://zerolink.test';
const CREDENTIAL_ID = 'test-credential-id' as Base64Url;
const AAGUID = 'test-aaguid-value' as Base64Url;

async function buildVerifyParams(
  overrides: Partial<{
    credentialId: Base64Url;
    rpId: string;
    rpOrigin: string;
    signCount: number;
    storedSignCount: number;
    challenge: Base64Url;
  }> = {}
): Promise<{ params: WebAuthnVerifyParams; challenge: Base64Url }> {
  const credentialId = overrides.credentialId ?? CREDENTIAL_ID;
  const rpId = overrides.rpId ?? RP_ID;
  const rpOrigin = overrides.rpOrigin ?? RP_ORIGIN;
  const signCount = overrides.signCount ?? 5;
  const storedSignCount = overrides.storedSignCount ?? 1;

  // Derive a challenge (normally SHA-256 of domain-separated data)
  const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
  const challenge = overrides.challenge ?? encodeBase64Url(challengeBytes);

  const { assertion, publicKeyCose } = await createMockAssertion({
    credentialId,
    rpId,
    rpOrigin,
    challenge,
    signCount,
  });

  const storedCredential: StoredCredential = {
    credentialId,
    publicKey: publicKeyCose,
    signCount: storedSignCount,
    aaguid: AAGUID,
  };

  return {
    params: {
      assertion,
      expectedChallenge: challenge,
      storedCredential,
      rpId,
      rpOrigin,
    },
    challenge,
  };
}

describe('verifyAssertion', () => {
  it('succeeds for a valid assertion', async () => {
    const { params } = await buildVerifyParams();
    const result = await verifyAssertion(params);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newSignCount).toBe(5);
    }
  });

  it('rejects when credential ID does not match', async () => {
    const { params } = await buildVerifyParams();
    const badParams = {
      ...params,
      storedCredential: {
        ...params.storedCredential,
        credentialId: 'wrong-credential-id' as Base64Url,
      },
    };

    const result = await verifyAssertion(badParams);
    expect(result).toEqual({ ok: false, error: 'credential ID mismatch' });
  });

  it('rejects when origin does not match', async () => {
    const { params } = await buildVerifyParams();
    const badParams = {
      ...params,
      rpOrigin: 'https://evil.com',
    };

    const result = await verifyAssertion(badParams);
    expect(result).toEqual({ ok: false, error: 'origin mismatch' });
  });

  it('rejects when challenge does not match', async () => {
    const { params } = await buildVerifyParams();
    const badParams = {
      ...params,
      expectedChallenge: 'wrong-challenge-value' as Base64Url,
    };

    const result = await verifyAssertion(badParams);
    expect(result).toEqual({ ok: false, error: 'challenge mismatch' });
  });

  it('rejects when signature is tampered', async () => {
    const challenge = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const { assertion, publicKeyCose } = await createTamperedAssertion({
      credentialId: CREDENTIAL_ID,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge,
      signCount: 5,
    });

    const storedCredential: StoredCredential = {
      credentialId: CREDENTIAL_ID,
      publicKey: publicKeyCose,
      signCount: 1,
      aaguid: AAGUID,
    };

    const result = await verifyAssertion({
      assertion,
      expectedChallenge: challenge,
      storedCredential,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
    });

    // Tampered authenticatorData causes rpIdHash mismatch or signature failure
    expect(result.ok).toBe(false);
  });

  it('rejects when UP flag is not set', async () => {
    const challenge = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const { assertion, publicKeyCose } = await createMockAssertion({
      credentialId: CREDENTIAL_ID,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge,
      signCount: 5,
    });

    // Manually clear the UP flag in authenticatorData
    const authDataBase64 = assertion.response.authenticatorData;
    const authDataBytes = decodeBase64UrlSimple(authDataBase64);
    authDataBytes[32] = 0x00; // Clear all flags
    const modifiedAuthData = encodeBase64Url(authDataBytes);

    const modifiedAssertion = {
      ...assertion,
      response: {
        ...assertion.response,
        authenticatorData: modifiedAuthData,
      },
    };

    const storedCredential: StoredCredential = {
      credentialId: CREDENTIAL_ID,
      publicKey: publicKeyCose,
      signCount: 1,
      aaguid: AAGUID,
    };

    const result = await verifyAssertion({
      assertion: modifiedAssertion,
      expectedChallenge: challenge,
      storedCredential,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
    });

    expect(result).toEqual({ ok: false, error: 'user presence flag not set' });
  });

  it('rejects when UV flag is not set', async () => {
    const challenge = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const { assertion, publicKeyCose } = await createMockAssertion({
      credentialId: CREDENTIAL_ID,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
      challenge,
      signCount: 5,
      authenticatorFlags: 0x01, // UP only, UV missing
    });

    const storedCredential: StoredCredential = {
      credentialId: CREDENTIAL_ID,
      publicKey: publicKeyCose,
      signCount: 1,
      aaguid: AAGUID,
    };

    const result = await verifyAssertion({
      assertion,
      expectedChallenge: challenge,
      storedCredential,
      rpId: RP_ID,
      rpOrigin: RP_ORIGIN,
    });

    expect(result).toEqual({
      ok: false,
      error: 'user verification flag not set',
    });
  });

  it('rejects a non-ES256 COSE key algorithm', async () => {
    const { params } = await buildVerifyParams();

    // Re-encode the stored public key with RS256 (alg -257) instead of ES256 (alg -7)
    const { encode } = await import('cborg');
    const rs256CoseMap = new Map<number, unknown>([
      [1, 3], // kty = RSA (3)
      [3, -257], // alg = RS256
      [-1, new Uint8Array(256).fill(0x01)], // fake n
      [-2, new Uint8Array([0x01, 0x00, 0x01])], // fake e
    ]);
    const rs256Key = encodeBase64Url(encode(rs256CoseMap));

    const badParams = {
      ...params,
      storedCredential: {
        ...params.storedCredential,
        publicKey: rs256Key,
      },
    };

    const result = await verifyAssertion(badParams);
    expect(result).toEqual({
      ok: false,
      error: 'only ES256 (alg -7) is supported, got: -257',
    });
  });

  it('accepts a valid 64-byte P1363 signature even when it starts with 0x30', async () => {
    let params: WebAuthnVerifyParams | null = null;

    for (let attempt = 0; attempt < 2048; attempt += 1) {
      const candidate = await buildVerifyParams();
      const signatureBytes = decodeBase64Url(candidate.params.assertion.response.signature);
      const p1363Signature =
        signatureBytes.byteLength === 64 ? signatureBytes : derToP1363(signatureBytes);

      if (p1363Signature[0] !== 0x30) {
        continue;
      }

      params = {
        ...candidate.params,
        assertion: {
          ...candidate.params.assertion,
          response: {
            ...candidate.params.assertion.response,
            signature: encodeBase64Url(p1363Signature),
          },
        },
      };
      break;
    }

    expect(params).not.toBeNull();
    const result = await verifyAssertion(params as WebAuthnVerifyParams);
    expect(result.ok).toBe(true);
  });
});

describe('generateCreationOptions', () => {
  it('uses non-discoverable credential settings for secure profile', () => {
    const options = generateCreationOptions({
      rpId: RP_ID,
      rpName: 'ZeroLink',
      uuid: 'new-channel-uuid-12345',
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      securityProfile: 'secure',
    }) as {
      authenticatorSelection: {
        userVerification: string;
        residentKey: string;
        requireResidentKey: boolean;
      };
    };

    expect(options.authenticatorSelection).toEqual({
      userVerification: 'required',
      residentKey: 'discouraged',
      requireResidentKey: false,
    });
  });

  it('only includes ES256 in pubKeyCredParams', () => {
    const options = generateCreationOptions({
      rpId: RP_ID,
      rpName: 'ZeroLink',
      uuid: 'test-uuid',
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      securityProfile: 'secure',
    }) as { pubKeyCredParams: Array<{ type: string; alg: number }> };

    expect(options.pubKeyCredParams).toEqual([{ type: 'public-key', alg: -7 }]);
  });

  it('uses non-discoverable credential settings for quick profile', () => {
    const options = generateCreationOptions({
      rpId: RP_ID,
      rpName: 'ZeroLink',
      uuid: 'new-channel-uuid-12345',
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      securityProfile: 'quick',
    }) as {
      authenticatorSelection: {
        userVerification: string;
        residentKey: string;
        requireResidentKey: boolean;
      };
    };

    expect(options.authenticatorSelection).toEqual({
      userVerification: 'preferred',
      residentKey: 'discouraged',
      requireResidentKey: false,
    });
  });
});

describe('derToP1363', () => {
  it('converts a known DER signature to 64-byte P1363 format', () => {
    // Construct a minimal valid DER signature with known r and s values
    // r = 32 bytes of 0x01, s = 32 bytes of 0x02
    const r = new Uint8Array(32).fill(0x01);
    const s = new Uint8Array(32).fill(0x02);

    // DER encode: SEQUENCE { INTEGER(r), INTEGER(s) }
    const derR = derEncodeInteger(r);
    const derS = derEncodeInteger(s);
    const sequenceContent = new Uint8Array(derR.byteLength + derS.byteLength);
    sequenceContent.set(derR, 0);
    sequenceContent.set(derS, derR.byteLength);

    const der = new Uint8Array(2 + sequenceContent.byteLength);
    der[0] = 0x30; // SEQUENCE
    der[1] = sequenceContent.byteLength;
    der.set(sequenceContent, 2);

    const p1363 = derToP1363(der);
    expect(p1363.byteLength).toBe(64);
    expect(p1363.slice(0, 32)).toEqual(r);
    expect(p1363.slice(32, 64)).toEqual(s);
  });

  it('handles DER integers with leading zero padding byte', () => {
    // When high bit is set, DER adds a 0x00 prefix byte
    const r = new Uint8Array(32);
    r[0] = 0x80; // High bit set
    const s = new Uint8Array(32).fill(0x01);

    const derR = derEncodeInteger(r); // Will have 0x00 prefix
    const derS = derEncodeInteger(s);
    const sequenceContent = new Uint8Array(derR.byteLength + derS.byteLength);
    sequenceContent.set(derR, 0);
    sequenceContent.set(derS, derR.byteLength);

    const der = new Uint8Array(2 + sequenceContent.byteLength);
    der[0] = 0x30;
    der[1] = sequenceContent.byteLength;
    der.set(sequenceContent, 2);

    const p1363 = derToP1363(der);
    expect(p1363.byteLength).toBe(64);
    expect(p1363[0]).toBe(0x80);
  });

  it('rejects non-DER input', () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02]);
    expect(() => derToP1363(bad)).toThrow('invalid DER signature');
  });
});

// Helper functions for test construction
function derEncodeInteger(value: Uint8Array): Uint8Array {
  const needsPadding = (value[0] ?? 0) >= 0x80;
  const contentLength = value.byteLength + (needsPadding ? 1 : 0);
  const result = new Uint8Array(2 + contentLength);
  result[0] = 0x02; // INTEGER tag
  result[1] = contentLength;
  if (needsPadding) {
    result[2] = 0x00;
    result.set(value, 3);
  } else {
    result.set(value, 2);
  }
  return result;
}

function decodeBase64UrlSimple(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
