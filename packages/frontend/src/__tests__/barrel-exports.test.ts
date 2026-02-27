import { describe, expect, it } from 'vitest';

import * as apiExports from '../api';
import * as layoutExports from '../components/layout';
import * as cryptoExports from '../crypto';
import * as storeExports from '../stores';

describe('barrel exports', () => {
  it('exports api client symbols from api/index.ts', () => {
    expect(apiExports.createApiClient).toBeTypeOf('function');
    expect(apiExports.apiClient).toBeTruthy();
  });

  it('exports crypto symbols from crypto/index.ts', () => {
    expect(cryptoExports.createCryptoOrchestrator).toBeTypeOf('function');
    expect(cryptoExports.cryptoOrchestrator).toBeTruthy();
    expect(cryptoExports.createIndexedDbReceiverKeyStorage).toBeTypeOf('function');
    expect(cryptoExports.detectWebAuthnSupport).toBeTypeOf('function');
  });

  it('exports store symbols from stores/index.ts', () => {
    expect(storeExports.useCreateStore).toBeTypeOf('function');
    expect(storeExports.useLockStore).toBeTypeOf('function');
    expect(storeExports.useDeliverStore).toBeTypeOf('function');
    expect(storeExports.useDecryptStore).toBeTypeOf('function');
    expect(storeExports.createIdleRequestState).toBeTypeOf('function');
  });

  it('exports layout symbols from components/layout/index.ts', () => {
    expect(layoutExports.PageCard).toBeTypeOf('function');
    expect(layoutExports.RoleBadge).toBeTypeOf('function');
    expect(layoutExports.StatusBadge).toBeTypeOf('function');
    expect(layoutExports.StateNotice).toBeTypeOf('function');
  });
});
