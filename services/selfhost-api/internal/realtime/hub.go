package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const maxConnectionsPerChannel = 10

var ErrConnectionLimitReached = errors.New("connection limit reached")

const (
	CloseNormal           = 1000
	CloseGoingAway        = 1001
	CloseChannelGone      = 4000
	CloseInvalidPayload   = 4001
	CloseSubscribeTimeout = 4002
)

type CloseReason string

const (
	CloseReasonDeleted CloseReason = "deleted"
	CloseReasonExpired CloseReason = "expired"
)

type StateSnapshot struct {
	ChannelID       string
	State           string
	Version         int64
	AdminMode       string
	SecurityProfile string
	ReceiverPubFpr  string
	ExpiresAt       time.Time
}

type Publisher interface {
	PublishState(ctx context.Context, snapshot StateSnapshot) error
	PublishClosed(ctx context.Context, channelID string, reason CloseReason) error
	Close() error
}

type Hub struct {
	logger   *slog.Logger
	mu       sync.RWMutex
	channels map[string]*channelGroup
	closed   bool
}

type Client struct {
	channelID string
	conn      *websocket.Conn

	writeMu    sync.Mutex
	stateMu    sync.RWMutex
	subscribed bool
}

type channelGroup struct {
	clients   map[*Client]struct{}
	expiresAt time.Time
	timer     *time.Timer
}

type NopHub struct{}

func NewHub(logger *slog.Logger) *Hub {
	if logger == nil {
		logger = slog.Default()
	}

	return &Hub{
		logger:   logger,
		channels: make(map[string]*channelGroup),
	}
}

func (h *Hub) Register(channelID string, conn *websocket.Conn) (*Client, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closed {
		return nil, ErrConnectionLimitReached
	}

	group := h.channels[channelID]
	if group == nil {
		group = &channelGroup{
			clients: make(map[*Client]struct{}),
		}
		h.channels[channelID] = group
	}
	if len(group.clients) >= maxConnectionsPerChannel {
		return nil, ErrConnectionLimitReached
	}

	client := &Client{
		channelID: channelID,
		conn:      conn,
	}
	group.clients[client] = struct{}{}

	return client, nil
}

func (h *Hub) Unregister(client *Client) {
	if client == nil {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	group := h.channels[client.channelID]
	if group == nil {
		return
	}

	delete(group.clients, client)
	if len(group.clients) > 0 {
		return
	}

	if group.timer != nil {
		group.timer.Stop()
	}
	delete(h.channels, client.channelID)
}

func (h *Hub) PublishState(_ context.Context, snapshot StateSnapshot) error {
	clients := h.snapshotClients(snapshot.ChannelID)
	if len(clients) == 0 {
		return nil
	}

	h.setChannelExpiry(snapshot.ChannelID, snapshot.ExpiresAt)
	message := stateChangedMessage{
		Type:            "state_changed",
		State:           snapshot.State,
		Version:         snapshot.Version,
		AdminMode:       snapshot.AdminMode,
		SecurityProfile: snapshot.SecurityProfile,
	}
	if snapshot.ReceiverPubFpr != "" {
		message.ReceiverPubFpr = snapshot.ReceiverPubFpr
	}

	for _, client := range clients {
		if err := h.writeJSON(client, message); err != nil {
			h.closeClient(client, CloseChannelGone, "send failed")
			h.Unregister(client)
		}
	}

	return nil
}

func (h *Hub) PublishClosed(_ context.Context, channelID string, reason CloseReason) error {
	clients := h.releaseChannel(channelID)
	if len(clients) == 0 {
		return nil
	}

	message := channelClosedMessage{
		Type:   "channel_closed",
		Reason: string(reason),
	}

	for _, client := range clients {
		if err := h.writeJSON(client, message); err != nil {
			h.logger.Debug("write websocket close payload", "channel_id", channelID, "error", err)
		}
		h.closeClient(client, CloseChannelGone, string(reason))
	}

	return nil
}

func (h *Hub) SendState(client *Client, snapshot StateSnapshot) error {
	if client == nil {
		return nil
	}

	h.setChannelExpiry(snapshot.ChannelID, snapshot.ExpiresAt)

	message := stateChangedMessage{
		Type:            "state_changed",
		State:           snapshot.State,
		Version:         snapshot.Version,
		AdminMode:       snapshot.AdminMode,
		SecurityProfile: snapshot.SecurityProfile,
	}
	if snapshot.ReceiverPubFpr != "" {
		message.ReceiverPubFpr = snapshot.ReceiverPubFpr
	}

	return h.writeJSON(client, message)
}

func (h *Hub) SendPong(client *Client) error {
	if client == nil {
		return nil
	}

	return h.writeJSON(client, pongMessage{Type: "pong"})
}

func (h *Hub) Subscribe(client *Client) {
	if client == nil {
		return
	}

	client.stateMu.Lock()
	client.subscribed = true
	client.stateMu.Unlock()
}

func (h *Hub) CloseClient(client *Client, code int, reason string) {
	if client == nil {
		return
	}
	h.closeClient(client, code, reason)
}

func (h *Hub) Close() error {
	h.mu.Lock()
	channels := h.channels
	h.channels = make(map[string]*channelGroup)
	h.closed = true
	h.mu.Unlock()

	for _, group := range channels {
		if group.timer != nil {
			group.timer.Stop()
		}
		for client := range group.clients {
			h.closeClient(client, CloseGoingAway, "server shutdown")
		}
	}

	return nil
}

func (NopHub) PublishState(context.Context, StateSnapshot) error {
	return nil
}

func (NopHub) PublishClosed(context.Context, string, CloseReason) error {
	return nil
}

func (NopHub) Close() error {
	return nil
}

func (h *Hub) snapshotClients(channelID string) []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	group := h.channels[channelID]
	if group == nil || len(group.clients) == 0 {
		return nil
	}

	clients := make([]*Client, 0, len(group.clients))
	for client := range group.clients {
		if !client.isSubscribed() {
			continue
		}
		clients = append(clients, client)
	}
	return clients
}

func (h *Hub) releaseChannel(channelID string) []*Client {
	h.mu.Lock()
	defer h.mu.Unlock()

	group := h.channels[channelID]
	if group == nil {
		return nil
	}

	if group.timer != nil {
		group.timer.Stop()
	}

	clients := make([]*Client, 0, len(group.clients))
	for client := range group.clients {
		clients = append(clients, client)
	}
	delete(h.channels, channelID)
	return clients
}

func (h *Hub) setChannelExpiry(channelID string, expiresAt time.Time) {
	if expiresAt.IsZero() {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	group := h.channels[channelID]
	if group == nil {
		return
	}

	if group.timer != nil {
		group.timer.Stop()
		group.timer = nil
	}

	group.expiresAt = expiresAt.UTC()
	delay := time.Until(group.expiresAt)
	if delay <= 0 {
		go func() {
			_ = h.PublishClosed(context.Background(), channelID, CloseReasonExpired)
		}()
		return
	}

	targetExpiry := group.expiresAt
	group.timer = time.AfterFunc(delay, func() {
		h.handleChannelExpiry(channelID, targetExpiry)
	})
}

func (h *Hub) handleChannelExpiry(channelID string, expected time.Time) {
	h.mu.Lock()
	group := h.channels[channelID]
	if group == nil || !group.expiresAt.Equal(expected) {
		h.mu.Unlock()
		return
	}

	if group.timer != nil {
		group.timer.Stop()
	}
	clients := make([]*Client, 0, len(group.clients))
	for client := range group.clients {
		clients = append(clients, client)
	}
	delete(h.channels, channelID)
	h.mu.Unlock()

	message := channelClosedMessage{
		Type:   "channel_closed",
		Reason: string(CloseReasonExpired),
	}
	for _, client := range clients {
		if err := h.writeJSON(client, message); err != nil {
			h.logger.Debug("write websocket close payload", "channel_id", channelID, "error", err)
		}
		h.closeClient(client, CloseChannelGone, string(CloseReasonExpired))
	}
}

const writeDeadline = 10 * time.Second

func (h *Hub) writeJSON(client *Client, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	client.writeMu.Lock()
	defer client.writeMu.Unlock()
	_ = client.conn.SetWriteDeadline(time.Now().Add(writeDeadline))
	return client.conn.WriteMessage(websocket.TextMessage, data)
}

func (c *Client) isSubscribed() bool {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.subscribed
}

func (h *Hub) closeClient(client *Client, code int, reason string) {
	client.writeMu.Lock()
	defer client.writeMu.Unlock()

	deadline := time.Now().Add(time.Second)
	_ = client.conn.SetWriteDeadline(deadline)
	_ = client.conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(code, reason),
		deadline,
	)
	_ = client.conn.Close()
}

type stateChangedMessage struct {
	Type            string `json:"type"`
	State           string `json:"state"`
	Version         int64  `json:"version"`
	AdminMode       string `json:"adminMode"`
	SecurityProfile string `json:"securityProfile"`
	ReceiverPubFpr  string `json:"receiverPubFpr,omitempty"`
}

type channelClosedMessage struct {
	Type   string `json:"type"`
	Reason string `json:"reason"`
}

type pongMessage struct {
	Type string `json:"type"`
}
