import { encode } from 'cborg';
import { describe, expect, it } from 'vitest';
import { coseKeyToSpki, parseAuthenticatorData, verifyAttestation } from '../attestation.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToBinary(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return binary;
}

function toB64u(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/**
 * Builds a minimal fmt:none attestation fixture with the given challenge.
 * The rpIdHash is the SHA-256 of rpId (computed via WebCrypto).
 */
async function buildTestAttestation(params: {
  challenge: Uint8Array;
  rpId: string;
  origin: string;
}): Promise<{ attestationObjectB64u: string; clientDataJSONB64u: string }> {
  const rpIdHashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(params.rpId)
  );
  const rpIdHash = new Uint8Array(rpIdHashBuffer);

  // Minimal credential data for the AT flag (aaguid all zeros is valid)
  const _aaguid = new Uint8Array(16);
  const credId = new Uint8Array(4).fill(0x01);
  const pubKeyBytes = new Uint8Array(8).fill(0x02);

  const authData = new Uint8Array(37 + 16 + 2 + credId.length + pubKeyBytes.length);
  authData.set(rpIdHash, 0);
  authData[32] = 0x41; // AT | UP
  new DataView(authData.buffer).setUint16(37 + 16, credId.length, false);
  authData.set(credId, 37 + 16 + 2);
  authData.set(pubKeyBytes, 37 + 16 + 2 + credId.length);

  const clientDataJSON = JSON.stringify({
    type: 'webauthn.create',
    challenge: toB64u(params.challenge),
    origin: params.origin,
  });

  const attestationObject = encode({ fmt: 'none', attStmt: {}, authData });

  return {
    attestationObjectB64u: toB64u(attestationObject),
    clientDataJSONB64u: toB64u(new TextEncoder().encode(clientDataJSON)),
  };
}

describe('attestation', () => {
  describe('parseAuthenticatorData', () => {
    it('should parse basic authData without attested credential data', () => {
      const rpIdHash = new Uint8Array(32).fill(1);
      const authData = new Uint8Array(37);
      authData.set(rpIdHash, 0);
      authData[32] = 0x01; // UP flag
      new DataView(authData.buffer).setUint32(33, 100, false); // signCount

      const parsed = parseAuthenticatorData(authData);
      expect(parsed.rpIdHash).toEqual(rpIdHash);
      expect(parsed.flags).toBe(0x01);
      expect(parsed.signCount).toBe(100);
      expect(parsed.aaguid).toBeUndefined();
    });

    it('should parse authData with attested credential data', () => {
      const rpIdHash = new Uint8Array(32).fill(1);
      const aaguid = new Uint8Array(16).fill(2);
      const credentialId = new Uint8Array([1, 2, 3, 4]);
      const pubKey = new Uint8Array([5, 6, 7, 8]);

      const authData = new Uint8Array(37 + 16 + 2 + 4 + 4);
      authData.set(rpIdHash, 0);
      authData[32] = 0x41; // AT + UP flags
      new DataView(authData.buffer).setUint32(33, 100, false);
      authData.set(aaguid, 37);
      new DataView(authData.buffer).setUint16(37 + 16, 4, false); // credentialId length
      authData.set(credentialId, 37 + 16 + 2);
      authData.set(pubKey, 37 + 16 + 2 + 4);

      const parsed = parseAuthenticatorData(authData);
      expect(parsed.rpIdHash).toEqual(rpIdHash);
      expect(parsed.flags).toBe(0x41);
      expect(parsed.signCount).toBe(100);
      expect(parsed.aaguid).toEqual(aaguid);
      expect(parsed.credentialId).toEqual(credentialId);
      expect(parsed.credentialPublicKey).toEqual(pubKey);
    });

    it('should throw if authData is too short', () => {
      expect(() => parseAuthenticatorData(new Uint8Array(36))).toThrow(
        'Authenticator data too short'
      );
    });
  });

  describe('coseKeyToSpki', () => {
    it('should convert P-256 COSE key to SPKI', () => {
      // Minimal CBOR encoded COSE key for P-256
      // {1:2, 3:-7, -1:1, -2:h'11...', -3:h'22...'}
      // 1: kty, 2: EC2
      // 3: alg, -7: ES256
      // -1: crv, 1: P-256
      const x = new Uint8Array(32).fill(0x11);
      const y = new Uint8Array(32).fill(0x22);

      const coseKey = encode({
        1: 2,
        3: -7,
        [-1]: 1,
        [-2]: x,
        [-3]: y,
      });

      const spki = coseKeyToSpki(coseKey);
      expect(spki.length).toBe(91);
      expect(spki[0]).toBe(0x30); // SEQUENCE
      expect(spki[26]).toBe(0x04); // Uncompressed point
      expect(spki.slice(27, 27 + 32)).toEqual(x);
      expect(spki.slice(27 + 32, 27 + 64)).toEqual(y);
    });
  });

  describe('verifyAttestation', () => {
    const rpId = 'example.com';
    const origin = 'https://example.com';

    it('rejects when challenge does not match expected', async () => {
      const correctChallenge = new Uint8Array(32).fill(0xaa);
      const wrongChallenge = new Uint8Array(32).fill(0xbb);
      const fixture = await buildTestAttestation({
        challenge: correctChallenge,
        rpId,
        origin,
      });

      await expect(
        verifyAttestation({
          ...fixture,
          expectedRpId: rpId,
          expectedOrigin: origin,
          expectedChallenge: wrongChallenge,
        })
      ).rejects.toThrow('Challenge mismatch');
    });

    it('resolves when challenge matches (fmt:none → unverified)', async () => {
      const challenge = new Uint8Array(32).fill(0xcc);
      const fixture = await buildTestAttestation({ challenge, rpId, origin });

      const result = await verifyAttestation({
        ...fixture,
        expectedRpId: rpId,
        expectedOrigin: origin,
        expectedChallenge: challenge,
      });

      expect(result.verified).toBe(false);
      expect(result.fmt).toBe('none');
      expect(result.credentialId).toBeTruthy();
    });
  });
});
