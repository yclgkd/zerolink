package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/service"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

func TestWebSocketSubscribeSendsRealtimeSnapshot(t *testing.T) {
	t.Parallel()

	server, _ := newWebSocketTestServer(t, stubProtocol{
		realtimeState: func(_ context.Context, uuid string) (service.RealtimeStateOutput, error) {
			return service.RealtimeStateOutput{
				ChannelID:       uuid,
				State:           "waiting",
				Version:         2,
				AdminMode:       "password",
				SecurityProfile: "quick",
				ExpiresAt:       time.Now().Add(time.Minute),
			}, nil
		},
	})
	defer server.Close()

	conn := mustDialWebSocket(t, server.URL, "/api/ws/test-channel")
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"type": "subscribe",
		"uuid": "test-channel",
	}); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}

	var payload map[string]any
	if err := conn.ReadJSON(&payload); err != nil {
		t.Fatalf("read snapshot: %v", err)
	}

	if payload["type"] != "state_changed" {
		t.Fatalf("payload.type = %v, want state_changed", payload["type"])
	}
	if payload["state"] != "waiting" {
		t.Fatalf("payload.state = %v, want waiting", payload["state"])
	}
	if payload["adminMode"] != "password" {
		t.Fatalf("payload.adminMode = %v, want password", payload["adminMode"])
	}
}

func TestWebSocketPingReturnsPong(t *testing.T) {
	t.Parallel()

	server, _ := newWebSocketTestServer(t, stubProtocol{
		realtimeState: func(_ context.Context, uuid string) (service.RealtimeStateOutput, error) {
			return service.RealtimeStateOutput{
				ChannelID:       uuid,
				State:           "waiting",
				Version:         0,
				AdminMode:       "webauthn",
				SecurityProfile: "secure",
				ExpiresAt:       time.Now().Add(time.Minute),
			}, nil
		},
	})
	defer server.Close()

	conn := mustDialWebSocket(t, server.URL, "/api/ws/test-channel")
	defer conn.Close()

	writeSubscribeAndDiscardInitialState(t, conn)

	if err := conn.WriteJSON(map[string]any{"type": "ping"}); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	var payload map[string]any
	if err := conn.ReadJSON(&payload); err != nil {
		t.Fatalf("read pong: %v", err)
	}
	if payload["type"] != "pong" {
		t.Fatalf("payload.type = %v, want pong", payload["type"])
	}
}

func TestWebSocketBroadcastsStateChanges(t *testing.T) {
	t.Parallel()

	server, hub := newWebSocketTestServer(t, stubProtocol{
		realtimeState: func(_ context.Context, uuid string) (service.RealtimeStateOutput, error) {
			return service.RealtimeStateOutput{
				ChannelID:       uuid,
				State:           "waiting",
				Version:         0,
				AdminMode:       "password",
				SecurityProfile: "quick",
				ExpiresAt:       time.Now().Add(time.Minute),
			}, nil
		},
	})
	defer server.Close()

	conn := mustDialWebSocket(t, server.URL, "/api/ws/test-channel")
	defer conn.Close()

	writeSubscribeAndDiscardInitialState(t, conn)

	if err := hub.PublishState(context.Background(), realtime.StateSnapshot{
		ChannelID:       "test-channel",
		State:           "locked",
		Version:         1,
		AdminMode:       "password",
		SecurityProfile: "quick",
		ReceiverPubFpr:  strings.Repeat("a", 64),
		ExpiresAt:       time.Now().Add(time.Minute),
	}); err != nil {
		t.Fatalf("publish state: %v", err)
	}

	var payload map[string]any
	if err := conn.ReadJSON(&payload); err != nil {
		t.Fatalf("read broadcast: %v", err)
	}

	if payload["state"] != "locked" {
		t.Fatalf("payload.state = %v, want locked", payload["state"])
	}
	if payload["receiverPubFpr"] != strings.Repeat("a", 64) {
		t.Fatalf("payload.receiverPubFpr = %v, want receiver fingerprint", payload["receiverPubFpr"])
	}
}

func TestWebSocketBroadcastsChannelClosed(t *testing.T) {
	t.Parallel()

	server, hub := newWebSocketTestServer(t, stubProtocol{
		realtimeState: func(_ context.Context, uuid string) (service.RealtimeStateOutput, error) {
			return service.RealtimeStateOutput{
				ChannelID:       uuid,
				State:           "delivered",
				Version:         3,
				AdminMode:       "password",
				SecurityProfile: "quick",
				ExpiresAt:       time.Now().Add(time.Minute),
			}, nil
		},
	})
	defer server.Close()

	conn := mustDialWebSocket(t, server.URL, "/api/ws/test-channel")
	defer conn.Close()

	writeSubscribeAndDiscardInitialState(t, conn)

	if err := hub.PublishClosed(context.Background(), "test-channel", realtime.CloseReasonDeleted); err != nil {
		t.Fatalf("publish close: %v", err)
	}

	var payload map[string]any
	if err := conn.ReadJSON(&payload); err != nil {
		t.Fatalf("read close payload: %v", err)
	}
	if payload["type"] != "channel_closed" {
		t.Fatalf("payload.type = %v, want channel_closed", payload["type"])
	}
	if payload["reason"] != "deleted" {
		t.Fatalf("payload.reason = %v, want deleted", payload["reason"])
	}
}

func newWebSocketTestServer(t *testing.T, protocol stubProtocol) (*httptest.Server, *realtime.Hub) {
	t.Helper()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := realtime.NewHub(logger)
	handler := NewRouter(Dependencies{
		Logger:        logger,
		AllowedOrigin: "http://localhost:5173",
		Realtime:      hub,
		Services: service.New(
			stubChecker{},
			webauthn.NoopVerifier{},
			hub,
			protocol,
			logger,
		),
	})

	server := httptest.NewServer(handler)
	return server, hub
}

func mustDialWebSocket(t *testing.T, serverURL string, path string) *websocket.Conn {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + path
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	return conn
}

func writeSubscribeAndDiscardInitialState(t *testing.T, conn *websocket.Conn) {
	t.Helper()

	if err := conn.WriteJSON(map[string]any{
		"type": "subscribe",
		"uuid": "test-channel",
	}); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}

	var payload json.RawMessage
	if err := conn.ReadJSON(&payload); err != nil {
		t.Fatalf("read initial state: %v", err)
	}
}
