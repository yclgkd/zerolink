import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MANIFEST_SIGNING_PUBLIC_KEY_PEM } from '../release/public-key';

describe('MANIFEST_SIGNING_PUBLIC_KEY_PEM', () => {
  it('matches the committed repository public key exactly', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(testDir, '..', '..', '..', '..');
    const expectedPem = readFileSync(path.join(repoRoot, 'keys', 'manifest-signing.pub'), 'utf8');

    expect(MANIFEST_SIGNING_PUBLIC_KEY_PEM).toBe(expectedPem);
  });
});
