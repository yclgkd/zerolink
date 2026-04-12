// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const syncMock = vi.hoisted(() => {
  const instances: Array<{
    uuid: string;
    options: {
      onStateChange: (update: unknown) => void;
      onChannelClosed: (reason: unknown) => void;
      onConnectionChange: (mode: 'websocket' | 'polling' | 'offline') => void;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    handleVisibilityVisible: ReturnType<typeof vi.fn>;
    handleVisibilityHidden: ReturnType<typeof vi.fn>;
  }> = [];

  class MockChannelSync {
    readonly uuid: string;
    readonly options: {
      onStateChange: (update: unknown) => void;
      onChannelClosed: (reason: unknown) => void;
      onConnectionChange: (mode: 'websocket' | 'polling' | 'offline') => void;
    };

    connect = vi.fn(() => {
      this.options.onConnectionChange('websocket');
    });
    disconnect = vi.fn();
    handleVisibilityVisible = vi.fn(async () => {
      this.options.onConnectionChange('polling');
    });
    handleVisibilityHidden = vi.fn(() => {
      this.options.onConnectionChange('offline');
    });

    constructor(
      uuid: string,
      options: {
        onStateChange: (update: unknown) => void;
        onChannelClosed: (reason: unknown) => void;
        onConnectionChange: (mode: 'websocket' | 'polling' | 'offline') => void;
      }
    ) {
      this.uuid = uuid;
      this.options = options;
      instances.push(this);
    }
  }

  return { instances, MockChannelSync };
});

vi.mock('../sync/channel-sync.ts', () => ({
  ChannelSync: syncMock.MockChannelSync,
}));

import { useChannelSync } from '../sync/use-channel-sync';

function Harness({ uuid }: { uuid?: string }) {
  const { connectionMode } = useChannelSync(uuid, {
    onStateChange: vi.fn(),
    onChannelClosed: vi.fn(),
  });

  return <div data-testid="connection-mode">{connectionMode}</div>;
}

afterEach(() => {
  cleanup();
  syncMock.instances.length = 0;
  vi.clearAllMocks();
});

describe('useChannelSync', () => {
  it('stays offline when no uuid is provided', () => {
    render(<Harness />);

    expect(screen.getByTestId('connection-mode').textContent).toBe('offline');
    expect(syncMock.instances).toHaveLength(0);
  });

  it('connects, reacts to visibility changes, and disconnects on unmount', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    const view = render(<Harness uuid="channel-123" />);

    expect(syncMock.instances).toHaveLength(1);
    const instance = syncMock.instances[0];
    expect(instance).toBeDefined();
    if (!instance) {
      throw new Error('expected channel sync instance');
    }

    expect(instance.connect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('connection-mode').textContent).toBe('websocket');

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(instance.handleVisibilityHidden).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('connection-mode').textContent).toBe('offline');
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(instance.handleVisibilityVisible).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('connection-mode').textContent).toBe('polling');
    });

    view.unmount();

    expect(instance.disconnect).toHaveBeenCalledTimes(1);
  });
});
