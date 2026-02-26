import { describe, expect, it, vi } from 'vitest';

import {
  buildShareUrlWithFragment,
  deriveExpectedCompoundChallengeB64u,
  deriveLockKeyB64u,
  deriveLockProofHex,
  extractLockSecretFromHash,
  generateLockSecretB64u,
} from '../crypto/protocol-utils';

const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const VALID_LOCK_SECRET = 'bW9ja19sb2NrX3NlY3JldF8xMjM0NTY3ODkwMTIzNDU';
const VALID_CHALLENGE_ID = 'bW9ja19jaGFsbGVuZ2VfaWQ';
const VALID_CHALLENGE = 'Y2hhbGxlbmdlX2RhdGFfZm9yX3Rlc3Rpbmc';
const VALID_SEED = 'c2VlZF9mb3JfY29tcG91bmRfY2hhbGxlbmdl';
const VALID_INTENT_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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

  it('extracts lock secret from hash payload', () => {
    expect(extractLockSecretFromHash('#k=bW9ja19zZWNyZXQ')).toBe('bW9ja19zZWNyZXQ');
    expect(extractLockSecretFromHash('k=bW9ja19zZWNyZXQ')).toBe('bW9ja19zZWNyZXQ');
  });

  it('returns null for invalid lock secret hash payload', () => {
    expect(extractLockSecretFromHash('#k=invalid+base64')).toBeNull();
    expect(extractLockSecretFromHash('#missing=value')).toBeNull();
    expect(extractLockSecretFromHash('')).toBeNull();
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
});
