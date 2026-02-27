import { describe, expect, it, vi } from 'vitest';

const { setupWorkerMock, workerStub } = vi.hoisted(() => {
  const worker = { start: vi.fn() };
  return {
    setupWorkerMock: vi.fn(() => worker),
    workerStub: worker,
  };
});

vi.mock('msw/browser', () => {
  return {
    setupWorker: setupWorkerMock,
  };
});

vi.mock('../mocks/handlers', () => {
  return {
    handlers: ['h1', 'h2'] as unknown[],
  };
});

import { worker } from '../mocks/browser';
import { handlers } from '../mocks/handlers';

describe('mocks/browser', () => {
  it('creates worker with setupWorker(...handlers)', () => {
    expect(setupWorkerMock).toHaveBeenCalledTimes(1);
    expect(setupWorkerMock).toHaveBeenCalledWith(...handlers);
    expect(worker).toBe(workerStub);
  });
});
