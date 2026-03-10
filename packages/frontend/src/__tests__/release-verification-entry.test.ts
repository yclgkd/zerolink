import { describe, expect, it } from 'vitest';
import { verifyRelease } from '../release/verification';
import {
  createFetchStub,
  createSignedManifestFixture,
  signManifest,
} from './release-verification-test-helpers';

describe('verifyRelease entry binding', () => {
  it('fails when the current entry bundle does not match the signed manifest entry asset', async () => {
    const fixture = createSignedManifestFixture();

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index-stale.js',
      fetchImpl: createFetchStub(fixture),
      publicKeyPem: fixture.publicPem,
    });

    expect(result).toEqual({
      detail: 'The running bootstrap entry asset does not match the signed release manifest entry.',
      reason: 'entry_asset_mismatch',
      status: 'failed',
    });
  });

  it('treats a manifest without a safe entry asset path as unavailable metadata', async () => {
    const fixture = createSignedManifestFixture();
    const compromisedManifest = {
      ...fixture.manifest,
      entryAssetPath: 'https://cdn.example.com/app.js',
    };
    const manifestJson = `${JSON.stringify(compromisedManifest, null, 2)}\n`;

    const result = await verifyRelease({
      baseUrl: 'https://zerolink.test/',
      currentEntryUrl: 'https://zerolink.test/assets/index.js',
      fetchImpl: createFetchStub({
        ...fixture,
        manifestJson,
        signature: signManifest(compromisedManifest, fixture.privatePem),
      }),
      publicKeyPem: fixture.publicPem,
    });

    expect(result).toEqual({
      detail: 'Signed release metadata is not a valid ZeroLink manifest payload.',
      reason: 'manifest_invalid',
      status: 'unavailable',
    });
  });
});
