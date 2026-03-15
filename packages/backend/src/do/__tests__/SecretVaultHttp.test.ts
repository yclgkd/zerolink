import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapError } from '../SecretVaultHttp.ts';
import { RateLimitError, StateTransitionError } from '../SecretVaultTypes.ts';

type StructuredUnexpectedErrorLogShape = {
  stack_fingerprint?: string;
  error_message?: string;
  error_stack?: string;
  thrown_value?: string;
};

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
    const logEntry = consoleError.mock.calls[0]?.[0] as StructuredUnexpectedErrorLogShape;
    expect(logEntry).not.toHaveProperty('error_message');
    expect(logEntry).not.toHaveProperty('error_stack');
    expect(logEntry).not.toHaveProperty('thrown_value');
  });

  it('keeps the same production fingerprint when only message and offsets change', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const firstError = new Error('first secret payload');
    firstError.stack = [
      'Error: first secret payload',
      '    at https://prod.example.com/assets/index-123abc456.js:10:20',
      '    at processQueue (https://prod.example.com/assets/chunk-123abc456.js:30:40)',
    ].join('\n');

    const secondError = new Error('second secret payload');
    secondError.stack = [
      'Error: second secret payload',
      '    at https://staging.example.com/assets/index-987zyx654.js:110:220',
      '    at processQueue (https://staging.example.com/assets/chunk-987zyx654.js:330:440)',
    ].join('\n');

    mapError(firstError, { appEnv: 'production', handler: 'lock_commit' });
    mapError(secondError, { appEnv: 'production', handler: 'lock_commit' });

    const firstLog = consoleError.mock.calls[0]?.[0] as StructuredUnexpectedErrorLogShape;
    const secondLog = consoleError.mock.calls[1]?.[0] as StructuredUnexpectedErrorLogShape;

    expect(firstLog.stack_fingerprint).toBe(secondLog.stack_fingerprint);
    expect(firstLog).not.toHaveProperty('error_message');
    expect(secondLog).not.toHaveProperty('error_message');
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

  it('maps rate-limit errors to 429 with Retry-After', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = mapError(new RateLimitError(0.2), {
      appEnv: 'production',
      handler: 'lock_begin',
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('1');
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'RATE_LIMITED' });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
