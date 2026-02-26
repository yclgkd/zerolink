/**
 * Represents the current status of an asynchronous operation.
 */
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Standardized state container for asynchronous requests.
 */
export interface AsyncRequestState<T> {
  status: AsyncStatus;
  data: T | null;
  errorCode: string | null;
}

/**
 * Returns a new request state object indicating the request has not started.
 */
export function createIdleRequestState<T>(): AsyncRequestState<T> {
  return {
    status: 'idle',
    data: null,
    errorCode: null,
  };
}

/**
 * Returns a new request state object indicating the request is currently in-flight.
 */
export function createLoadingState<T>(): AsyncRequestState<T> {
  return {
    status: 'loading',
    data: null,
    errorCode: null,
  };
}

/**
 * Returns a new request state object indicating the request succeeded.
 */
export function createSuccessState<T>(payload: T): AsyncRequestState<T> {
  return {
    status: 'success',
    data: payload,
    errorCode: null,
  };
}

/**
 * Returns a new request state object indicating the request failed.
 */
export function createErrorState<T>(errorCode: string): AsyncRequestState<T> {
  return {
    status: 'error',
    data: null,
    errorCode,
  };
}
