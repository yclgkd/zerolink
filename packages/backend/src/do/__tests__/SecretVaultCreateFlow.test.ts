import type { AttestationJSON, ChannelRecord, StoredCredential } from '@zerolink/shared';
import { CHANNEL_STATE, SECURITY_PROFILE } from '@zerolink/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { verifyAttestation } from '../../crypto/attestation.ts';
import {
  CHANNEL_RECORD_KEY,
  CREATION_CHALLENGE_KEY,
  SecretVault,
  type StoredTerminalTombstone,
  TERMINAL_TOMBSTONE_KEY,
} from '../SecretVault.ts';
import {
  asBase64Url,
  asHex,
  asUnixMs,
  asUuid,
  createAssertionFixture,
  createChannelRecord,
  createCipherBundle,
  createMockState,
  createReceiverJwk,
  decodeBase64Url,
  encodeBase64Url,
  env,
  RP_ID,
  RP_ORIGIN,
  readTerminalTombstone,
  setupRealReceiverKey,
} from './helpers/vault-fixtures.ts';

vi.mock('../../crypto/softkey.ts', () => ({
  verifySoftkeySignature: vi.fn(),
}));

vi.mock('../../crypto/attestation.ts', () => ({
  verifyAttestation: vi.fn(),
}));

beforeAll(async () => {
  await setupRealReceiverKey();
});

describe('SecretVault create flow', () => {
  it('begins creation and initializes a record with WAITING state', async () => {
    const { state, snapshot } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');

    const options = (await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE)) as {
      challenge: unknown;
      user: { id: unknown };
      attestation: unknown;
    };
    const record = snapshot.get(CHANNEL_RECORD_KEY) as ChannelRecord;

    expect(record.uuid).toBe(uuid);
    expect(record.state).toBe(CHANNEL_STATE.WAITING);
    expect(record.securityProfile).toBe(SECURITY_PROFILE.SECURE);
    expect(options.challenge).toBeDefined();
    expect(options.user.id).toBeDefined();
    // attestation is always 'none' now; secure profile does not enforce direct attestation
    expect(options.attestation).toBe('none');
  });

  it('rejects beginCreate when a terminal tombstone already occupies the uuid', async () => {
    const uuid = asUuid('new-channel-uuid-12345');
    const { state, snapshot } = createMockState();
    snapshot.set(TERMINAL_TOMBSTONE_KEY, {
      uuid,
      reason: 'deleted',
      finalizedAt: asUnixMs(1_730_000_000_000),
    } satisfies StoredTerminalTombstone);
    const vault = new SecretVault(state, env);

    await expect(vault.beginCreate(uuid, SECURITY_PROFILE.SECURE)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect(readTerminalTombstone(snapshot)).toEqual({
      uuid,
      reason: 'deleted',
      finalizedAt: asUnixMs(1_730_000_000_000),
    });
    expect(snapshot.get(CHANNEL_RECORD_KEY)).toBeUndefined();
  });

  it('converts expired residual records into tombstones and rejects beginCreate reuse', async () => {
    const now = 1_730_000_999_000;
    const uuid = asUuid('new-channel-uuid-12345');
    const expiredRecord: ChannelRecord = {
      ...createChannelRecord(CHANNEL_STATE.LOCKED),
      uuid,
      expiresAt: asUnixMs(now - 1),
      receiver: {
        pubJwk: createReceiverJwk(),
        pubFpr: asHex('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'),
        lockedAt: asUnixMs(now - 10_000),
      },
      cipherBundle: createCipherBundle(),
      deliveredAt: asUnixMs(now - 5_000),
    };
    const { state, snapshot, getAlarm } = createMockState(expiredRecord);
    const vault = new SecretVault(state, env);

    await expect(vault.beginCreate(uuid, SECURITY_PROFILE.SECURE, now)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });

    expect(snapshot.get(CHANNEL_RECORD_KEY)).toBeUndefined();
    expect(snapshot.get(CREATION_CHALLENGE_KEY)).toBeUndefined();
    expect(readTerminalTombstone(snapshot)).toEqual({
      uuid,
      reason: 'expired',
      finalizedAt: asUnixMs(now),
    });
    expect([...snapshot.keys()]).toEqual([TERMINAL_TOMBSTONE_KEY]);
    expect(getAlarm()).toBeNull();
  });

  it('commits creation successfully for SECURE with valid attestation', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: true,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    const lockKeyB64u = asBase64Url('lock-key');
    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u,
    });

    const updated = await vault.getRecord();
    expect(updated.adminMode).toBe('webauthn');
    expect(updated.lockKey).toBe(lockKeyB64u);
    expect((updated.adminCredential as StoredCredential).credentialId).toBe('cred-id');
  });

  it('accepts SECURE creation when fmt:none passes UV/context checks', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: false,
      fmt: 'none',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
      warning: 'none attestation is considered unverified',
    });

    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });

    const updated = await vault.getRecord();
    expect(updated.adminMode).toBe('webauthn');
    expect((updated.adminCredential as StoredCredential).credentialId).toBe('cred-id');
  });

  it('rejects SECURE creation when packed attestation does not verify', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: false,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'webauthn',
        attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toThrow("requires verified attestation for fmt:'packed'");
  });

  it('allows creation for SECURE with all-zero AAGUID (enforcement removed)', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: true,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: encodeBase64Url(new Uint8Array(16)), // all-zero AAGUID — no longer rejected
      signCount: 0,
    });

    // secure profile no longer rejects all-zero AAGUID — creation should succeed
    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });
    const updated = await vault.getRecord();
    expect(updated.adminMode).toBe('webauthn');
  });

  it('rejects password adminMode for secure profile (H-1 downgrade prevention)', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'password',
        softkeyPubJwk: {
          kty: 'EC',
          crv: 'P-256',
          x: asBase64Url('x'),
          y: asBase64Url('y'),
        } as never,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toThrow("security profile 'secure' requires webauthn admin mode");
  });

  it('rejects softkey adminMode for secure profile (H-1 downgrade prevention)', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'softkey',
        softkeyPubJwk: {
          kty: 'EC',
          crv: 'P-256',
          x: asBase64Url('x'),
          y: asBase64Url('y'),
        } as never,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toThrow("security profile 'secure' requires webauthn admin mode");
  });

  it('allows password adminMode for quick profile', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.QUICK);

    await vault.commitCreate({
      uuid,
      adminMode: 'password',
      softkeyPubJwk: { kty: 'EC', crv: 'P-256', x: asBase64Url('x'), y: asBase64Url('y') } as never,
      lockKeyB64u: asBase64Url('lock-key'),
    });
    const updated = await vault.getRecord();
    expect(updated.adminMode).toBe('password');
  });

  it('beginCreate stores creation challenge under CREATION_CHALLENGE_KEY', async () => {
    const { state, snapshot } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');

    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    const storedChallenge = snapshot.get(CREATION_CHALLENGE_KEY) as string;
    expect(storedChallenge).toBeDefined();
    expect(decodeBase64Url(storedChallenge).byteLength).toBe(32);
  });

  it('commitCreate passes expectedChallenge to verifyAttestation and deletes the key', async () => {
    const { state, snapshot } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    const storedChallengeB64u = snapshot.get(CREATION_CHALLENGE_KEY) as string;
    expect(storedChallengeB64u).toBeDefined();
    const expectedChallenge = decodeBase64Url(storedChallengeB64u);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: true,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });

    expect(verifyAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge,
        expectedRpId: RP_ID,
        expectedOrigin: RP_ORIGIN,
      })
    );
    // Challenge must be deleted after use (one-time)
    expect(snapshot.get(CREATION_CHALLENGE_KEY)).toBeUndefined();
  });

  it('commitCreate throws CHALLENGE_INVALID when no creation challenge exists', async () => {
    const { state, snapshot } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    // Simulate missing challenge (e.g. already consumed or never set)
    snapshot.delete(CREATION_CHALLENGE_KEY);

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'webauthn',
        attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('commitCreate maps verifyAttestation throw to ATTESTATION_UNVERIFIABLE', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    vi.mocked(verifyAttestation).mockRejectedValueOnce(
      new Error('x5c attestation (certificate chain) is not yet supported')
    );

    await expect(
      vault.commitCreate({
        uuid,
        adminMode: 'webauthn',
        attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
        lockKeyB64u: asBase64Url('lock-key'),
      })
    ).rejects.toMatchObject({ code: 'ATTESTATION_UNVERIFIABLE' });
  });

  it('create_finish response uses RP_ORIGIN for shareUrl/manageUrl (not internal DO hostname)', async () => {
    // UUID must be exactly 21 chars (NanoID format required by schema)
    const uuid = 'abcdefghijklmnopqrstu';
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    await vault.beginCreate(asUuid(uuid), SECURITY_PROFILE.QUICK);

    // Softkey mode: no attestation needed, simpler setup
    const payload = {
      adminMode: 'softkey',
      uuid,
      softkeyPubJwk: {
        kty: 'EC',
        crv: 'P-256',
        x: 'aBcDeFgHiJkLmNoPqRsTuVw',
        y: 'bBcDeFgHiJkLmNoPqRsTuVw',
        ext: true,
        key_ops: ['verify'],
      },
      lockKeyB64u: 'bG9ja2tleQ',
      timestamp: 1730000100000,
    };

    // Request arrives at an internal DO hostname, not the public RP_ORIGIN
    const response = await vault.fetch(
      new Request('https://fake-internal.workers.dev/create_finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      shareUrl?: string;
      manageUrl?: string;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    // Must use RP_ORIGIN, not the internal DO hostname
    expect(body.shareUrl).toBe(`${RP_ORIGIN}/s/${uuid}`);
    expect(body.manageUrl).toBe(`${RP_ORIGIN}/m/${uuid}`);
    expect(body.shareUrl).not.toContain('fake-internal');
    expect(body.manageUrl).not.toContain('fake-internal');
  });

  it('commitCreate passes requireUserVerification:true for SECURE profile', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.SECURE);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: true,
      fmt: 'packed',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });

    expect(verifyAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: true })
    );
  });

  it('commitCreate passes requireUserVerification:false for QUICK profile', async () => {
    const { state } = createMockState();
    const vault = new SecretVault(state, env);
    const uuid = asUuid('new-channel-uuid-12345');
    await vault.beginCreate(uuid, SECURITY_PROFILE.QUICK);

    const verifyAttestationMock = vi.mocked(verifyAttestation);
    verifyAttestationMock.mockResolvedValueOnce({
      verified: false,
      fmt: 'none',
      credentialId: asBase64Url('cred-id'),
      publicKey: asBase64Url('pub-key'),
      aaguid: asBase64Url('aaguid'),
      signCount: 0,
    });

    await vault.commitCreate({
      uuid,
      adminMode: 'webauthn',
      attestation: createAssertionFixture(asBase64Url('cred-id')) as unknown as AttestationJSON,
      lockKeyB64u: asBase64Url('lock-key'),
    });

    expect(verifyAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: false })
    );
  });
});
