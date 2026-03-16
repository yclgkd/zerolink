import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pemToSpkiBytes } from '../release/crypto';
import {
  MANIFEST_SIGNING_PUBLIC_KEY_PEM,
  MANIFEST_SIGNING_PUBLIC_KEY_RAW_B64U,
} from '../release/public-key';

describe('MANIFEST_SIGNING_PUBLIC_KEY_PEM', () => {
  it('matches the committed repository public key exactly', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testDir, '..', '..', '..', '..');
    const expectedPem = readFileSync(path.join(repoRoot, 'keys', 'manifest-signing.pub'), 'utf8');

    expect(MANIFEST_SIGNING_PUBLIC_KEY_PEM).toBe(expectedPem);
  });
});

describe('MANIFEST_SIGNING_PUBLIC_KEY_RAW_B64U', () => {
  it('encodes the same raw 32-byte key as the PEM (strip 12-byte SPKI header)', () => {
    const spkiBytes = pemToSpkiBytes(MANIFEST_SIGNING_PUBLIC_KEY_PEM);
    const rawFromPem = spkiBytes.slice(12); // Ed25519 SPKI = 12-byte header + 32-byte raw key

    const rawB64u = MANIFEST_SIGNING_PUBLIC_KEY_RAW_B64U;
    const normalized = rawB64u.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const rawFromConst = new Uint8Array(
      atob(padded)
        .split('')
        .map((c) => c.charCodeAt(0))
    );

    expect(rawFromConst.byteLength).toBe(32);
    expect(rawFromConst).toEqual(rawFromPem);
  });
});
