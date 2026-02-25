import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapApp,
  initializeMocking,
  isMockEnabled,
  type MockWorkerLoader,
} from '../bootstrap';

describe('isMockEnabled', () => {
  it('enables only when mock=true is present', () => {
    expect(isMockEnabled('?mock=true')).toBe(true);
    expect(isMockEnabled('?foo=bar&mock=true')).toBe(true);
    expect(isMockEnabled('?mock=false')).toBe(false);
    expect(isMockEnabled('?mock=TRUE')).toBe(false);
    expect(isMockEnabled('')).toBe(false);
  });
});

describe('initializeMocking', () => {
  it('loads and starts the MSW worker when mock mode is enabled', async () => {
    const sequence: string[] = [];
    const loadWorker: MockWorkerLoader = async () => {
      sequence.push('load');
      return {
        worker: {
          start: async () => {
            sequence.push('start');
          },
        },
      };
    };

    await initializeMocking('?mock=true', loadWorker);
    expect(sequence).toEqual(['load', 'start']);
  });

  it('skips worker loading when mock mode is disabled', async () => {
    const loadWorker = vi.fn(async () => ({
      worker: {
        start: async () => undefined,
      },
    }));

    await initializeMocking('?mock=false', loadWorker);
    expect(loadWorker).not.toHaveBeenCalled();
  });

  it('skips worker loading when not in dev mode', async () => {
    const loadWorker = vi.fn(async () => ({
      worker: {
        start: async () => undefined,
      },
    }));

    await initializeMocking('?mock=true', loadWorker, false);
    expect(loadWorker).not.toHaveBeenCalled();
  });
});

describe('bootstrapApp', () => {
  it('runs mock initialization before render', async () => {
    const sequence: string[] = [];

    await bootstrapApp({
      search: '?mock=true',
      initializeMockingFn: async (search) => {
        expect(search).toBe('?mock=true');
        sequence.push('initialize');
      },
      render: () => {
        sequence.push('render');
      },
    });

    expect(sequence).toEqual(['initialize', 'render']);
  });
});
