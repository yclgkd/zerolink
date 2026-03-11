import {
  type ChannelRecord,
  WS_CLOSE_CHANNEL_GONE,
  WS_CLOSE_INVALID_PAYLOAD,
  WsClientMessageSchema,
  type WsServerMessage,
} from '@zerolink/shared';

// ─── Accept WebSocket Upgrade ────────────────────────────────────────────────

/**
 * Accept a WebSocket upgrade request using the Hibernation API.
 * All connections are accepted with the 'subscribed' tag since the DO
 * instance IS the channel — no further subscription routing needed.
 *
 * Sets up auto-response for ping/pong so the DO can hibernate between
 * real state-change events.
 */
export function acceptWebSocket(state: DurableObjectState): Response {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];

  // Accept with 'subscribed' tag; all sockets on this DO are for this channel
  state.acceptWebSocket(server, ['subscribed']);

  // Enable auto ping/pong so the DO doesn't wake up for keepalives
  state.setWebSocketAutoResponse(
    new WebSocketRequestResponsePair(
      JSON.stringify({ type: 'ping' }),
      JSON.stringify({ type: 'pong' })
    )
  );

  return new Response(null, { status: 101, webSocket: client });
}

// ─── Broadcast ───────────────────────────────────────────────────────────────

/**
 * Broadcast a server message to all connected WebSocket clients.
 * Errors on individual sockets are caught silently (socket already closed).
 */
export function broadcastToWebSockets(state: DurableObjectState, message: WsServerMessage): void {
  const sockets = state.getWebSockets('subscribed');
  const payload = JSON.stringify(message);

  for (const ws of sockets) {
    try {
      ws.send(payload);
    } catch {
      try {
        ws.close(WS_CLOSE_CHANNEL_GONE, 'send failed');
      } catch {
        // Already closed
      }
    }
  }
}

/**
 * Build a `state_changed` WsServerMessage from a ChannelRecord.
 * Only includes public fields — never secrets, keys, or cipher bundles.
 */
export function buildStateChangedMessage(record: ChannelRecord): WsServerMessage {
  const base = {
    type: 'state_changed' as const,
    state: record.state,
    version: record.version,
    adminMode: record.adminMode,
  };

  if (record.receiver?.pubFpr) {
    return { ...base, receiverPubFpr: record.receiver.pubFpr };
  }

  return base;
}

// ─── Message Handling ────────────────────────────────────────────────────────

/**
 * Handle an incoming WebSocket message from a client.
 * `subscribe` sends the current state snapshot; `ping` is handled by auto-response
 * but we also handle it here for non-hibernation scenarios.
 */
export function handleWebSocketMessage(
  ws: WebSocket,
  data: string | ArrayBuffer,
  currentRecord: ChannelRecord | undefined
): void {
  const raw = typeof data === 'string' ? data : new TextDecoder().decode(data);

  const parsed = WsClientMessageSchema.safeParse(safeJsonParse(raw));
  if (!parsed.success) {
    ws.close(WS_CLOSE_INVALID_PAYLOAD, 'invalid message');
    return;
  }

  const msg = parsed.data;

  if (msg.type === 'ping') {
    trySend(ws, JSON.stringify({ type: 'pong' }));
    return;
  }

  if (msg.type === 'subscribe') {
    // Send current state snapshot so client has immediate data
    if (currentRecord) {
      trySend(ws, JSON.stringify(buildStateChangedMessage(currentRecord)));
    }
  }
}

/**
 * Handle WebSocket close event. Hibernation API auto-cleans up.
 */
export function handleWebSocketClose(_ws: WebSocket): void {
  // No-op: Hibernation API removes closed sockets from getWebSockets()
}

/**
 * Handle WebSocket error event. Close the socket gracefully.
 */
export function handleWebSocketError(ws: WebSocket): void {
  try {
    ws.close(WS_CLOSE_CHANNEL_GONE, 'error');
  } catch {
    // Already closed
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function trySend(ws: WebSocket, data: string): void {
  try {
    ws.send(data);
  } catch {
    // Socket closed
  }
}
