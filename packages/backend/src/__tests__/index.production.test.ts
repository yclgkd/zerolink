import { describe, expect, it } from 'vitest';

import * as productionEntry from '../index.ts';

describe('production worker entry', () => {
  it('exports only the active durable object class', () => {
    expect(productionEntry).toHaveProperty('SecretVaultV2');
    expect(productionEntry).not.toHaveProperty('SecretVault');
    expect(productionEntry).not.toHaveProperty('SecretVaultProduction');
    expect(productionEntry).toHaveProperty('default');
  });
});
