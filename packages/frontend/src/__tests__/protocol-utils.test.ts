import { describe, expect, it, vi } from 'vitest';

import {
  buildShareUrlWithFragment,
  deriveExpectedCompoundChallengeB64u,
  deriveLockKeyB64u,
  deriveLockProofHex,
  extractLockSecretFromHash,
  extractSenderAuthFprFromHash,
  generateLockSecretB64u,
} from '../crypto/protocol-utils';

const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const VALID_LOCK_SECRET = 'bW9ja19sb2NrX3NlY3JldF8xMjM0NTY3ODkwMTIzNDU';
const VALID_CHALLENGE_ID = 'bW9ja19jaGFsbGVuZ2VfaWQ';
const VALID_CHALLENGE = 'Y2hhbGxlbmdlX2RhdGFfZm9yX3Rlc3Rpbmc';
const VALID_SEED = 'c2VlZF9mb3JfY29tcG91bmRfY2hhbGxlbmdl';
const VALID_INTENT_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_SENDER_AUTH_FPR = '7568ef3cbdb5a90f89bc6ecdd08f7ba7730d943ca80d8756f44991bf34624eb5';

describe('protocol-utils', () => {
  it('derives lock key b64u from uuid and lock secret using domain-separated hash', async () => {
    const lockKey = await deriveLockKeyB64u(VALID_UUID, VALID_LOCK_SECRET);
    expect(lockKey).toBe('Tp5Lm9xQvvLp_nlAbeI7rpT8iPmbsp4161HaZOvsfzw');
  });

  it('derives lock proof hex using challenge and derived lock key', async () => {
    const lockProof = await deriveLockProofHex({
      uuid: VALID_UUID,
      lockChallengeId: VALID_CHALLENGE_ID,
      lockChallenge: VALID_CHALLENGE,
      lockKeyB64u: 'Tp5Lm9xQvvLp_nlAbeI7rpT8iPmbsp4161HaZOvsfzw',
    });

    expect(lockProof).toBe('9f45bd6f7742b0f90afe30fbda99071c6ffe19ab8d73565b875ce4b813ab94b4');
  });

  it('derives expected compound challenge b64u from challenge seed and intent hash', async () => {
    const challenge = await deriveExpectedCompoundChallengeB64u({
      uuid: VALID_UUID,
      challengeId: VALID_CHALLENGE_ID,
      challengeSeed: VALID_SEED,
      intentHash: VALID_INTENT_HASH,
    });

    expect(challenge).toBe('ElSvIYDCPR7bM0n5N1jqf-4nSHwlKljClgwBNHletWA');
  });

  it('builds share url with fragment when original url has no hash', () => {
    expect(buildShareUrlWithFragment('/s/aaaaaaaaaaaaaaaaaaaaa', VALID_LOCK_SECRET)).toBe(
      '/s/aaaaaaaaaaaaaaaaaaaaa#k=bW9ja19sb2NrX3NlY3JldF8xMjM0NTY3ODkwMTIzNDU'
    );
  });

  it('replaces existing hash when building share url with fragment', () => {
    expect(buildShareUrlWithFragment('/s/aaaaaaaaaaaaaaaaaaaaa#old=1', VALID_LOCK_SECRET)).toBe(
      '/s/aaaaaaaaaaaaaaaaaaaaa#k=bW9ja19sb2NrX3NlY3JldF8xMjM0NTY3ODkwMTIzNDU'
    );
  });

  it('includes sender auth fingerprints when building share fragments', () => {
    expect(
      buildShareUrlWithFragment(
        '/s/aaaaaaaaaaaaaaaaaaaaa',
        VALID_LOCK_SECRET,
        VALID_SENDER_AUTH_FPR
      )
    ).toBe(`/s/aaaaaaaaaaaaaaaaaaaaa#k=${VALID_LOCK_SECRET}&af=${VALID_SENDER_AUTH_FPR}`);
  });

  it('extracts lock secret from hash payload', () => {
    expect(extractLockSecretFromHash('#k=bW9ja19zZWNyZXQ')).toBe('bW9ja19zZWNyZXQ');
    expect(extractLockSecretFromHash('k=bW9ja19zZWNyZXQ')).toBe('bW9ja19zZWNyZXQ');
  });

  it('extracts sender auth fingerprints from hash payload', () => {
    expect(extractSenderAuthFprFromHash(`#af=${VALID_SENDER_AUTH_FPR}`)).toBe(
      VALID_SENDER_AUTH_FPR
    );
    expect(extractSenderAuthFprFromHash(`#k=bW9ja19zZWNyZXQ&af=${VALID_SENDER_AUTH_FPR}`)).toBe(
      VALID_SENDER_AUTH_FPR
    );
  });

  it('returns null for invalid lock secret hash payload', () => {
    expect(extractLockSecretFromHash('#k=invalid+base64')).toBeNull();
    expect(extractLockSecretFromHash('#missing=value')).toBeNull();
    expect(extractLockSecretFromHash('')).toBeNull();
    expect(extractSenderAuthFprFromHash('#af=not-hex')).toBeNull();
  });

  it('generates base64url lock secrets with fixed byte length', () => {
    const randomSpy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const generated = generateLockSecretB64u();

    expect(generated).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(generated.length).toBeGreaterThan(0);
    expect(randomSpy).toHaveBeenCalledTimes(1);
    const firstCallArg = randomSpy.mock.calls[0]?.[0];
    expect(firstCallArg).toBeInstanceOf(Uint8Array);
    expect((firstCallArg as Uint8Array).byteLength).toBe(32);
  });

  it('throws when lock secret is not valid base64url in lock key derivation', async () => {
    await expect(deriveLockKeyB64u(VALID_UUID, 'invalid+base64')).rejects.toThrow(
      'invalid base64url'
    );
  });

  it('throws when WebCrypto subtle API is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    });

    expect(() => generateLockSecretB64u()).toThrow('WebCrypto is not available');

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });
});
