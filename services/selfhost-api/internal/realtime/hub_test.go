package realtime

import (
	"io"
	"log/slog"
	"testing"

	"github.com/gorilla/websocket"
)

func TestHubSnapshotClientsExcludesUnsubscribedClients(t *testing.T) {
	t.Parallel()

	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	subscribed := &Client{channelID: "channel-1"}
	unsubscribed := &Client{channelID: "channel-1"}
	hub.channels["channel-1"] = &channelGroup{
		clients: map[*Client]struct{}{
			subscribed:   {},
			unsubscribed: {},
		},
	}

	if got := hub.snapshotClients("channel-1"); len(got) != 0 {
		t.Fatalf("snapshotClients() before subscribe returned %d clients, want 0", len(got))
	}

	hub.Subscribe(subscribed)

	got := hub.snapshotClients("channel-1")
	if len(got) != 1 || got[0] != subscribed {
		t.Fatalf("snapshotClients() = %v, want only subscribed client", got)
	}
}

func TestHubRegisterEnforcesPerChannelConnectionLimit(t *testing.T) {
	t.Parallel()

	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))

	for index := 0; index < maxConnectionsPerChannel; index += 1 {
		if _, err := hub.Register("channel-1", &websocket.Conn{}); err != nil {
			t.Fatalf("Register() at index %d returned error: %v", index, err)
		}
	}

	if _, err := hub.Register("channel-1", &websocket.Conn{}); err != ErrConnectionLimitReached {
		t.Fatalf("Register() overflow error = %v, want %v", err, ErrConnectionLimitReached)
	}
}
