export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncRequestState<T> {
  status: AsyncStatus;
  data: T | null;
  errorCode: string | null;
}

export function createIdleRequestState<T>(): AsyncRequestState<T> {
  return {
    status: 'idle',
    data: null,
    errorCode: null,
  };
}
