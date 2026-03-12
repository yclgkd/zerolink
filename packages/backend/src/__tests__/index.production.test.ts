import { describe, expect, it } from 'vitest';

import * as productionEntry from '../index.ts';

describe('production worker entry', () => {
  it('exports only the production durable object class', () => {
    expect(productionEntry).toHaveProperty('SecretVaultProduction');
    expect(productionEntry).not.toHaveProperty('SecretVault');
    expect(productionEntry).toHaveProperty('default');
  });
});
