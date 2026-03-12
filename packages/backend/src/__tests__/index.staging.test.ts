import { describe, expect, it } from 'vitest';

import * as stagingEntry from '../index.staging.ts';

describe('staging worker entry', () => {
  it('exports only the active durable object class', () => {
    expect(stagingEntry).toHaveProperty('SecretVaultV2');
    expect(stagingEntry).not.toHaveProperty('SecretVault');
    expect(stagingEntry).not.toHaveProperty('SecretVaultStaging');
    expect(stagingEntry).toHaveProperty('default');
  });
});
