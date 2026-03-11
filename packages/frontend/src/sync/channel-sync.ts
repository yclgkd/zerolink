import {
  type AdminMode,
  type ChannelState,
  ErrorResponseSchema,
  type HexString,
  POLL_INTERVAL_MS,
  PublicStatusResponseSchema,
  type SecurityProfile,
  WS_CLOSE_NORMAL,
  WS_PING_INTERVAL_MS,
  WS_RECONNECT_BASE_MS,
  WS_RECONNECT_MAX_MS,
  WsServerMessageSchema,
} from '@zerolink/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectionMode = 'websocket' | 'polling' | 'offline';
export type ChannelClosedReason = 'deleted' | 'expired' | 'not_found';

export interface ChannelStateUpdate {
  readonly state: ChannelState;
  readonly version: number;
  readonly adminMode: AdminMode;
  readonly securityProfile: SecurityProfile;
  readonly receiverPubFpr?: HexString;
}

export interface ChannelSyncCallbacks {
  readonly onStateChange: (update: ChannelStateUpdate) => void;
  readonly onChannelClosed: (reason: ChannelClosedReason) => void;
  readonly onConnectionChange: (mode: ConnectionMode) => void;
}

// ─── ChannelSync ─────────────────────────────────────────────────────────────

/**
 * Manages real-time synchronization for a single channel.
 * Primary: WebSocket via Durable Object.
 * Fallback: HTTP polling at POLL_INTERVAL_MS when WS is unavailable.
 *
 * Lifecycle: connect() → receives updates → disconnect()
 * Visibility-aware: pauses when hidden, resumes on visible.
 */
export class ChannelSync {
  private readonly uuid: string;
  private readonly callbacks: ChannelSyncCallbacks;

  private ws: WebSocket | null = null;
  private connectionMode: ConnectionMode = 'offline';
  private intentionalDisconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastVersion = -1;
  private disposed = false;

  constructor(uuid: string, callbacks: ChannelSyncCallbacks) {
    this.uuid = uuid;
    this.callbacks = callbacks;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  connect(): void {
    if (this.disposed) return;
    this.intentionalDisconnect = false;
    this.connectWebSocket();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.disposed = true;
    this.cleanup();
    this.setConnectionMode('offline');
  }

  /**
   * Called when tab becomes visible. Fetches a snapshot then reconnects WS.
   */
  async handleVisibilityVisible(): Promise<void> {
    if (this.disposed) return;
    this.intentionalDisconnect = false;

    // Fetch HTTP snapshot first for immediate state
    await this.pollOnce();

    // Then reconnect WS
    this.cleanup();
    this.connectWebSocket();
  }

  /**
   * Called when tab becomes hidden. Disconnects WS and stops polling.
   */
  handleVisibilityHidden(): void {
    if (this.disposed) return;
    this.intentionalDisconnect = true;
    this.cleanup();
    this.setConnectionMode('offline');
  }

  getConnectionMode(): ConnectionMode {
    return this.connectionMode;
  }

  // ─── WebSocket ───────────────────────────────────────────────────────────

  private connectWebSocket(): void {
    if (this.disposed) return;
    this.clearReconnectTimer();

    try {
      const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${globalThis.location.host}/api/ws/${this.uuid}`;
      const ws = new WebSocket(url);

      ws.addEventListener('open', () => {
        if (this.disposed) {
          ws.close();
          return;
        }
        this.ws = ws;
        this.reconnectAttempt = 0;
        this.setConnectionMode('websocket');
        this.stopPolling();
        this.startPing();

        // Send subscribe to get initial state snapshot
        ws.send(JSON.stringify({ type: 'subscribe', uuid: this.uuid }));
      });

      ws.addEventListener('message', (event) => {
        this.handleWsMessage(event.data);
      });

      ws.addEventListener('close', () => {
        this.handleWsDisconnect();
      });

      ws.addEventListener('error', () => {
        // Error event is followed by close event; handled there
      });
    } catch {
      this.handleWsDisconnect();
    }
  }

  private handleWsMessage(data: unknown): void {
    if (typeof data !== 'string') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const result = WsServerMessageSchema.safeParse(parsed);
    if (!result.success) return;

    const msg = result.data;

    if (msg.type === 'pong') return;

    if (msg.type === 'channel_closed') {
      this.callbacks.onChannelClosed(msg.reason);
      this.disconnect();
      return;
    }

    if (msg.type === 'state_changed') {
      // Only accept updates with version >= lastVersion (prevent out-of-order)
      if (msg.version >= this.lastVersion) {
        this.lastVersion = msg.version;
        const update: ChannelStateUpdate = msg.receiverPubFpr
          ? {
              state: msg.state,
              version: msg.version,
              adminMode: msg.adminMode,
              securityProfile: msg.securityProfile,
              receiverPubFpr: msg.receiverPubFpr,
            }
          : {
              state: msg.state,
              version: msg.version,
              adminMode: msg.adminMode,
              securityProfile: msg.securityProfile,
            };
        this.callbacks.onStateChange(update);
      }
    }
  }

  private handleWsDisconnect(): void {
    this.stopPing();
    this.ws = null;

    if (this.intentionalDisconnect || this.disposed) return;

    // Start polling as fallback immediately
    this.startPolling();
    this.setConnectionMode('polling');

    // Schedule WS reconnect with exponential backoff
    const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, WS_RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, WS_PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ─── Polling Fallback ────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    try {
      const response = await fetch(`/api/public/${this.uuid}`);
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const parsedError = ErrorResponseSchema.safeParse(payload);
        if (
          response.status === 404 ||
          (parsedError.success && parsedError.data.code === 'NOT_FOUND')
        ) {
          this.callbacks.onChannelClosed('not_found');
          this.disconnect();
        }
        return;
      }

      const parsed = PublicStatusResponseSchema.safeParse(payload);
      if (!parsed.success) return;

      const data = parsed.data;
      const state = data.state;

      // Terminal states
      if (state === 'deleted' || state === 'expired') {
        this.callbacks.onChannelClosed(state);
        this.disconnect();
        return;
      }

      // We don't have version from HTTP polling; use lastVersion to pass through
      const update: ChannelStateUpdate = data.receiverPubFpr
        ? {
            state,
            version: this.lastVersion,
            adminMode: data.adminMode,
            securityProfile: data.securityProfile,
            receiverPubFpr: data.receiverPubFpr,
          }
        : {
            state,
            version: this.lastVersion,
            adminMode: data.adminMode,
            securityProfile: data.securityProfile,
          };
      this.callbacks.onStateChange(update);
    } catch {
      // Network error during poll — silently ignore, will retry
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  private cleanup(): void {
    this.stopPing();
    this.stopPolling();
    this.clearReconnectTimer();

    if (this.ws) {
      try {
        this.ws.close(WS_CLOSE_NORMAL, 'disconnect');
      } catch {
        // Already closed
      }
      this.ws = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setConnectionMode(mode: ConnectionMode): void {
    if (mode !== this.connectionMode) {
      this.connectionMode = mode;
      this.callbacks.onConnectionChange(mode);
    }
  }
}
