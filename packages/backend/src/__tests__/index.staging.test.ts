import { describe, expect, it } from 'vitest';

import * as stagingEntry from '../index.staging.ts';

describe('staging worker entry', () => {
  it('exports the unified staging durable object class', () => {
    expect(stagingEntry).toHaveProperty('SecretVaultV2');
    expect(stagingEntry).toHaveProperty('SecretVaultStaging');
    expect(stagingEntry).toHaveProperty('default');
  });
});
