import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelClosedReason, ChannelStateUpdate, ConnectionMode } from '../channel-sync.ts';
import { ChannelSync } from '../channel-sync.ts';

// ─── Mock WebSocket ─────────────────────────────────────────────────────────

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // Auto-fire open on next tick
    queueMicrotask(() => this.fireEvent('open', {}));
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    const handlers = this.listeners[type];
    if (handlers) {
      this.listeners[type] = handlers.filter((h) => h !== handler);
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  fireEvent(type: string, data: unknown): void {
    for (const handler of this.listeners[type] ?? []) {
      handler(data);
    }
  }

  simulateMessage(data: string): void {
    this.fireEvent('message', { data });
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.fireEvent('close', {});
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────────

let stateChanges: ChannelStateUpdate[];
let closedReasons: string[];
let connectionModes: ConnectionMode[];

function createCallbacks() {
  return {
    onStateChange: (update: ChannelStateUpdate) => {
      stateChanges.push(update);
    },
    onChannelClosed: (reason: ChannelClosedReason) => {
      closedReasons.push(reason);
    },
    onConnectionChange: (mode: ConnectionMode) => {
      connectionModes.push(mode);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  stateChanges = [];
  closedReasons = [];
  connectionModes = [];
  MockWebSocket.instances = [];

  // Mock location
  vi.stubGlobal('location', { protocol: 'https:', host: 'example.com' });
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

function latestWs(): MockWebSocket {
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (!ws) throw new Error('No WebSocket instance');
  return ws;
}

describe('ChannelSync', () => {
  it('connects to correct WS URL', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(latestWs().url).toBe('wss://example.com/api/ws/abcdefghijklmnopqrstu');
  });

  it('sends subscribe message on open', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = latestWs();
    expect(ws.sent).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: array length verified above
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: 'subscribe',
      uuid: 'abcdefghijklmnopqrstu',
    });
  });

  it('sets connection mode to websocket on open', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(connectionModes).toContain('websocket');
  });

  it('fires onStateChange for state_changed messages', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = latestWs();
    ws.simulateMessage(
      JSON.stringify({
        type: 'state_changed',
        state: 'locked',
        version: 1,
        adminMode: 'webauthn',
        receiverPubFpr: 'ab01cd02',
      })
    );

    expect(stateChanges).toHaveLength(1);
    expect(stateChanges[0]!.state).toBe('locked');
    expect(stateChanges[0]!.version).toBe(1);
  });

  it('fires onChannelClosed for channel_closed messages', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = latestWs();
    ws.simulateMessage(JSON.stringify({ type: 'channel_closed', reason: 'deleted' }));

    expect(closedReasons).toEqual(['deleted']);
  });

  it('ignores pong messages', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = latestWs();
    ws.simulateMessage(JSON.stringify({ type: 'pong' }));

    expect(stateChanges).toHaveLength(0);
    expect(closedReasons).toHaveLength(0);
  });

  it('rejects out-of-order version updates', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = latestWs();

    // First update: version 5
    ws.simulateMessage(
      JSON.stringify({
        type: 'state_changed',
        state: 'locked',
        version: 5,
        adminMode: 'webauthn',
      })
    );

    // Second update: version 3 (out of order, should be ignored)
    ws.simulateMessage(
      JSON.stringify({
        type: 'state_changed',
        state: 'waiting',
        version: 3,
        adminMode: 'webauthn',
      })
    );

    expect(stateChanges).toHaveLength(1);
    expect(stateChanges[0]!.version).toBe(5);
  });

  it('reconnects with exponential backoff on WS close', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = latestWs();
    ws.simulateClose();

    // Should switch to polling mode
    expect(connectionModes).toContain('polling');

    // After 1s (first backoff), should attempt reconnect
    await vi.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('disconnects cleanly', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    sync.disconnect();

    expect(connectionModes).toContain('offline');
    expect(latestWs().readyState).toBe(MockWebSocket.CLOSED);
  });

  it('sends ping at interval', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = latestWs();
    const initialSent = ws.sent.length;

    // Advance by ping interval (25s)
    await vi.advanceTimersByTimeAsync(25_000);

    expect(ws.sent.length).toBeGreaterThan(initialSent);
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    const lastSent = JSON.parse(ws.sent[ws.sent.length - 1]!);
    expect(lastSent).toEqual({ type: 'ping' });

    sync.disconnect();
  });

  it('ignores invalid JSON messages', async () => {
    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    const ws = latestWs();
    ws.simulateMessage('not json');

    expect(stateChanges).toHaveLength(0);

    sync.disconnect();
  });

  it('treats polling 404 responses as terminal channel closure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 404,
          })
      )
    );

    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    sync.handleVisibilityHidden();
    await sync.handleVisibilityVisible();

    expect(closedReasons).toEqual(['not_found']);
    expect(sync.getConnectionMode()).toBe('offline');
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('uses ws: protocol for non-https', async () => {
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' });

    const sync = new ChannelSync('abcdefghijklmnopqrstu', createCallbacks());
    sync.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(latestWs().url).toBe('ws://localhost:5173/api/ws/abcdefghijklmnopqrstu');

    sync.disconnect();
  });
});
