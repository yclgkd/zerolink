import { describe, expect, it } from 'vitest';

import {
  createErrorState,
  createIdleRequestState,
  createLoadingState,
  createSuccessState,
} from '../stores/request-state';

describe('request-state helpers', () => {
  it('creates an idle request state', () => {
    expect(createIdleRequestState()).toEqual({
      status: 'idle',
      data: null,
      errorCode: null,
    });
  });

  it('creates a loading request state', () => {
    expect(createLoadingState()).toEqual({
      status: 'loading',
      data: null,
      errorCode: null,
    });
  });

  it('creates a success request state with payload', () => {
    expect(createSuccessState({ ok: true })).toEqual({
      status: 'success',
      data: { ok: true },
      errorCode: null,
    });
  });

  it('creates an error request state with code', () => {
    expect(createErrorState('BAD_REQUEST')).toEqual({
      status: 'error',
      data: null,
      errorCode: 'BAD_REQUEST',
    });
  });
});
