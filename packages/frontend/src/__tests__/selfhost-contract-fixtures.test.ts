import { readFile } from 'node:fs/promises';
import type { SelfHostContractFixture } from '@zerolink/shared/selfhost-contract-fixture.types';
import { describe, expect, it } from 'vitest';
import {
  deriveExpectedCompoundChallengeB64u,
  deriveLockKeyB64u,
  deriveLockProofHex,
} from '../crypto/protocol-utils';

async function loadFixture(): Promise<SelfHostContractFixture> {
  const path = new URL('../../../../protocol-fixtures/selfhost-contract-v1.json', import.meta.url);
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as SelfHostContractFixture;
}

describe('self-hosted frontend contract fixtures', () => {
  it('locks lock_key and lock_proof derivation', async () => {
    const fixture = await loadFixture();
    const lock = fixture.challengeDerivation.lock;

    const lockKeyB64u = await deriveLockKeyB64u(lock.uuid, lock.lockSecretB64u);
    expect(lockKeyB64u).toBe(lock.lockKeyB64u);

    await expect(
      deriveLockProofHex({
        uuid: lock.uuid,
        lockChallengeId: lock.lockChallengeId,
        lockChallenge: lock.lockChallengeB64u,
        lockKeyB64u,
      })
    ).resolves.toBe(lock.lockProofHex);
  });

  it('locks expected compound challenge derivation', async () => {
    const fixture = await loadFixture();
    const compound = fixture.challengeDerivation.compound;

    await expect(
      deriveExpectedCompoundChallengeB64u({
        uuid: compound.uuid,
        challengeId: compound.challengeId,
        challengeSeed: compound.challengeSeedB64u,
        intentHash: compound.intentHash,
      })
    ).resolves.toBe(compound.expectedChallengeB64u);
  });
});
