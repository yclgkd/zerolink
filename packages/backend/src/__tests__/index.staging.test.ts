import { describe, expect, it } from 'vitest';

import * as stagingEntry from '../index.staging.ts';

describe('staging worker entry', () => {
  it('exports only the staging durable object class', () => {
    expect(stagingEntry).toHaveProperty('SecretVaultStaging');
    expect(stagingEntry).not.toHaveProperty('SecretVault');
    expect(stagingEntry).toHaveProperty('default');
  });
});
