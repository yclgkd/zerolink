import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapError } from '../SecretVaultHttp.ts';
import { StateTransitionError } from '../SecretVaultTypes.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapError', () => {
  it('redacts unexpected production errors while preserving a stable fingerprint', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('sensitive user payload leaked');
    error.stack = 'Error: sensitive user payload leaked\n    at lock_commit';

    const response = mapError(error, { appEnv: 'production', handler: 'lock_commit' });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'INTERNAL_ERROR' });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith({
      event: 'secret_vault.unexpected_error',
      app_env: 'production',
      handler: 'lock_commit',
      error_name: 'Error',
      stack_fingerprint: expect.any(String),
    });
  });

  it('keeps detailed unexpected error text outside production', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('debug me');
    error.stack = 'Error: debug me\n    at compound_commit';

    const response = mapError(error, { appEnv: 'staging', handler: 'compound_commit' });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'INTERNAL_ERROR' });
    expect(consoleError).toHaveBeenCalledWith({
      event: 'secret_vault.unexpected_error',
      app_env: 'staging',
      handler: 'compound_commit',
      error_name: 'Error',
      stack_fingerprint: expect.any(String),
      error_message: 'debug me',
      error_stack: 'Error: debug me\n    at compound_commit',
    });
  });

  it('maps protocol errors without emitting observability noise', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = mapError(new StateTransitionError('LOCK_FORBIDDEN', 'uuid mismatch'), {
      appEnv: 'production',
      handler: 'lock_commit',
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'LOCK_FORBIDDEN' });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
