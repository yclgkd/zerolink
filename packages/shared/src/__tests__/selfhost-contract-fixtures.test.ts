import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { canonicalJsonStringify, computeIntentHash } from '../canonical.ts';
import { buildCipherBundleAadBytes, buildCipherBundleAadString } from '../protocol.ts';
import type { SelfHostContractFixture } from '../selfhost-contract-fixture.types.ts';
import { deriveUpdateProofChallengeB64u } from '../senderAuth.ts';
import { WsClientMessageSchema, WsServerMessageSchema } from '../ws.ts';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadFixture(): Promise<SelfHostContractFixture> {
  const path = new URL('../../../../protocol-fixtures/selfhost-contract-v1.json', import.meta.url);
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as SelfHostContractFixture;
}

describe('self-hosted contract fixtures', () => {
  it('locks canonical JSON and intent hashes', async () => {
    const fixture = await loadFixture();

    for (const entry of fixture.canonicalJson) {
      expect(canonicalJsonStringify(entry.input)).toBe(entry.canonical);
      await expect(computeIntentHash(entry.input)).resolves.toBe(entry.sha256Hex);
    }
  });

  it('locks cipher bundle AAD text and bytes', async () => {
    const fixture = await loadFixture();

    for (const entry of fixture.aad) {
      expect(buildCipherBundleAadString(entry.parts)).toBe(entry.string);
      expect(bytesToHex(buildCipherBundleAadBytes(entry.parts))).toBe(entry.utf8Hex);
    }
  });

  it('locks deterministic delivery proof challenges', async () => {
    const fixture = await loadFixture();

    await expect(
      deriveUpdateProofChallengeB64u(fixture.challengeDerivation.deliveryProof)
    ).resolves.toBe(fixture.challengeDerivation.deliveryProof.expectedChallengeB64u);
  });

  it('locks valid WebSocket message examples', async () => {
    const fixture = await loadFixture();

    for (const entry of fixture.ws.serverMessages) {
      expect(WsServerMessageSchema.safeParse(entry.payload).success).toBe(true);
    }

    for (const entry of fixture.ws.clientMessages) {
      expect(WsClientMessageSchema.safeParse(entry.payload).success).toBe(true);
    }
  });
});
