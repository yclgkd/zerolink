import { encode } from 'cborg';
import { describe, expect, it } from 'vitest';
import { coseKeyToSpki, parseAuthenticatorData } from '../attestation.ts';

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
});
