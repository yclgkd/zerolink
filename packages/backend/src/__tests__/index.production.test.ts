import { describe, expect, it } from 'vitest';

import * as productionEntry from '../index.ts';

describe('production worker entry', () => {
  it('exports the unified production durable object class', () => {
    expect(productionEntry).toHaveProperty('SecretVaultV2');
    expect(productionEntry).toHaveProperty('SecretVaultProduction');
    expect(productionEntry).toHaveProperty('default');
  });
});
