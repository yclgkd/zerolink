import { encode } from 'cborg';
import { describe, expect, it } from 'vitest';
import {
  buildManageUrlWithFragment,
  buildShareUrlWithFragment,
  computeSenderAuthFingerprintFromAttestation,
  computeSoftkeyPublicKeyFingerprint,
  deriveUpdateProofChallengeB64u,
  parseManageFragment,
  parseShareFragment,
  verifySoftkeyDeliveryProof,
  verifyWebAuthnDeliveryProof,
} from '../senderAuth.ts';
import type {
  AttestationJSON,
  Base64Url,
  DecryptFetchWebAuthnDeliveryAuth,
  ECDSAPublicKeyJWK,
  UnixMs,
} from '../types.ts';

const VALID_SENDER_AUTH_FPR = '7568ef3cbdb5a90f89bc6ecdd08f7ba7730d943ca80d8756f44991bf34624eb5';

const VALID_SOFTKEY_PUB_JWK: ECDSAPublicKeyJWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'wN2WqXica_0qtqGeuM8kDWKc7iQHUv5al40k5wQaXbY' as Base64Url,
  y: 'RXXI_JS0ZQzLnpe0bFqJnHm4sWZqgBo57aCTAnCD7So' as Base64Url,
  ext: true,
  key_ops: ['verify'],
};

const VALID_ATTESTATION: AttestationJSON = {
  id: 'bW9ja19iYXNlNjR1cmw' as Base64Url,
  rawId: 'bW9ja19iYXNlNjR1cmw' as Base64Url,
  type: 'public-key',
  response: {
    clientDataJSON:
      'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiYlc5amExOWlZWE5sTmpSMWNtdyIsIm9yaWdpbiI6Imh0dHA6Ly9sb2NhbGhvc3QiLCJjcm9zc09yaWdpbiI6ZmFsc2V9' as Base64Url,
    attestationObject:
      'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViUSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NBAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAECAwQFBgcICQoLDA0ODxClAQIDJiABIVggwN2WqXica_0qtqGeuM8kDWKc7iQHUv5al40k5wQaXbYiWCBFdcj8lLRlDMuel7RsWomcebixZmqAGjntoJMCcIPtKg' as Base64Url,
    transports: ['internal'],
  },
};

function bytesToBase64Url(bytes: Uint8Array): Base64Url {
  return Buffer.from(bytes).toString('base64url') as Base64Url;
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

async function createWebAuthnDeliveryAuth(
  expectedChallenge: Base64Url
): Promise<DecryptFetchWebAuthnDeliveryAuth> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as {
    x: string;
    y: string;
  };
  const publicKeyCose = bytesToBase64Url(
    encode(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ])
    )
  );

  const rpId = 'zerolink.test';
  const rpOrigin = 'https://zerolink.test';
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId))
  );
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(rpIdHash, 0);
  authenticatorData[32] = 0x05;
  new DataView(authenticatorData.buffer).setUint32(33, 7, false);

  const clientDataBytes = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: expectedChallenge,
      origin: rpOrigin,
      crossOrigin: false,
    })
  );
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
  const signedData = new Uint8Array(authenticatorData.byteLength + clientDataHash.byteLength);
  signedData.set(authenticatorData, 0);
  signedData.set(clientDataHash, authenticatorData.byteLength);

  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, signedData)
  );

  return {
    adminMode: 'webauthn',
    meta: {
      version: 0,
      timestamp: 1_730_000_000_000 as UnixMs,
      nonce: 'bW9ja19ub25jZQ' as Base64Url,
      expireAt: null,
    },
    signer: {
      credentialId: 'bW9ja19jcmVkZW50aWFs' as Base64Url,
      publicKey: publicKeyCose,
    },
    proof: {
      clientDataJSON: bytesToBase64Url(clientDataBytes),
      authenticatorData: bytesToBase64Url(authenticatorData),
      signature: bytesToBase64Url(signature),
    },
  };
}

describe('sender auth helpers', () => {
  it('round-trips share fragments with sender auth fingerprints', () => {
    const built = buildShareUrlWithFragment(
      '/s/aaaaaaaaaaaaaaaaaaaaa',
      'bW9ja19sb2NrX3NlY3JldA',
      VALID_SENDER_AUTH_FPR
    );

    expect(built).toBe(
      `/s/aaaaaaaaaaaaaaaaaaaaa#k=bW9ja19sb2NrX3NlY3JldA&af=${VALID_SENDER_AUTH_FPR}`
    );
    expect(parseShareFragment(built.slice(built.indexOf('#')))).toEqual({
      lockSecretB64u: 'bW9ja19sb2NrX3NlY3JldA',
      senderAuthFpr: VALID_SENDER_AUTH_FPR,
    });
  });

  it('computes stable sender auth fingerprints for attestation and softkey keys', async () => {
    await expect(computeSenderAuthFingerprintFromAttestation(VALID_ATTESTATION)).resolves.toBe(
      VALID_SENDER_AUTH_FPR
    );
    await expect(computeSoftkeyPublicKeyFingerprint(VALID_SOFTKEY_PUB_JWK)).resolves.toBe(
      VALID_SENDER_AUTH_FPR
    );
  });

  it('derives deterministic update proof challenges', async () => {
    await expect(
      deriveUpdateProofChallengeB64u({
        uuid: 'aaaaaaaaaaaaaaaaaaaaa',
        intentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      })
    ).resolves.toBe('PJp8cMUtJN7S8Ml_9gddY7a2_ski10pcvxAxO-Yz2XE');
  });

  it('verifies WebAuthn delivery proofs against the deterministic challenge', async () => {
    const expectedChallenge = 'bW9ja19jaGFsbGVuZ2U' as Base64Url;
    const deliveryAuth = await createWebAuthnDeliveryAuth(expectedChallenge);

    await expect(
      verifyWebAuthnDeliveryProof({
        deliveryAuth,
        expectedChallenge,
        rpId: 'zerolink.test',
        rpOrigin: 'https://zerolink.test',
      })
    ).resolves.toBe(true);
    await expect(
      verifyWebAuthnDeliveryProof({
        deliveryAuth,
        expectedChallenge: 'd3JvbmdfY2hhbGxlbmdl',
        rpId: 'zerolink.test',
        rpOrigin: 'https://zerolink.test',
      })
    ).resolves.toBe(false);
  });

  it('verifies softkey delivery proofs against the deterministic challenge bytes', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
    const expectedChallengeBytes = new TextEncoder().encode('deterministic challenge payload');
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        expectedChallengeBytes
      )
    );

    const verifyParams = {
      softkeyPubJwk: {
        kty: 'EC',
        crv: 'P-256',
        x: publicJwk.x as Base64Url,
        y: publicJwk.y as Base64Url,
        ext: true,
        key_ops: ['verify'],
      } satisfies ECDSAPublicKeyJWK,
      signatureHex: bytesToHex(signature),
      expectedChallengeBytes,
    };

    await expect(verifySoftkeyDeliveryProof(verifyParams)).resolves.toBe(true);
    await expect(
      verifySoftkeyDeliveryProof({
        ...verifyParams,
        expectedChallengeBytes: new TextEncoder().encode('tampered challenge payload'),
      })
    ).resolves.toBe(false);
  });
});

const COMPACT_WK = 'encKey123.ivValue12.saltVal12';

describe('manage fragment helpers', () => {
  describe('buildManageUrlWithFragment', () => {
    it('appends #wk= fragment to a plain URL', () => {
      const result = buildManageUrlWithFragment(
        'https://zerolink.app/manage/uuid?token=abc',
        COMPACT_WK
      );
      expect(result).toBe(
        `https://zerolink.app/manage/uuid?token=abc#wk=${encodeURIComponent(COMPACT_WK)}`
      );
    });

    it('strips an existing fragment before appending', () => {
      const result = buildManageUrlWithFragment(
        'https://zerolink.app/manage/uuid?token=abc#old=stuff',
        COMPACT_WK
      );
      expect(result).not.toContain('#old=stuff');
      expect(result).toContain('#wk=');
    });

    it('produces a URL that parseManageFragment can decode', () => {
      const url = buildManageUrlWithFragment(
        'https://zerolink.app/manage/uuid?token=abc',
        COMPACT_WK
      );
      const hash = url.slice(url.indexOf('#'));
      expect(parseManageFragment(hash).wrappedKeyCompact).toBe(COMPACT_WK);
    });
  });

  describe('parseManageFragment', () => {
    it('extracts wrappedKeyCompact from a valid fragment', () => {
      const hash = `#wk=${encodeURIComponent(COMPACT_WK)}`;
      expect(parseManageFragment(hash).wrappedKeyCompact).toBe(COMPACT_WK);
    });

    it('works with fragment string without leading #', () => {
      const hash = `wk=${encodeURIComponent(COMPACT_WK)}`;
      expect(parseManageFragment(hash).wrappedKeyCompact).toBe(COMPACT_WK);
    });

    it('returns null for empty fragment', () => {
      expect(parseManageFragment('').wrappedKeyCompact).toBeNull();
      expect(parseManageFragment('#').wrappedKeyCompact).toBeNull();
    });

    it('returns null when wk param is missing', () => {
      expect(parseManageFragment('#k=someOtherParam').wrappedKeyCompact).toBeNull();
    });

    it('returns null when wk param is empty string', () => {
      expect(parseManageFragment('#wk=').wrappedKeyCompact).toBeNull();
    });
  });
});
