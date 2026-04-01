package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/service"
)

const wsSubscribeTimeout = 5 * time.Second

type wsClientMessage struct {
	Type string `json:"type"`
	UUID string `json:"uuid,omitempty"`
}

func websocketHandler(
	protocolService service.Protocol,
	hub *realtime.Hub,
	logger *slog.Logger,
	allowedOrigin string,
) http.HandlerFunc {
	if protocolService == nil || hub == nil {
		return websocketPlaceholder(logger)
	}

	normalizedAllowedOrigin := normalizeOrigin(allowedOrigin)
	if normalizedAllowedOrigin == "" && logger != nil {
		logger.Warn("websocket origin check disabled: SELFHOST_API_RP_ORIGIN is not set")
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if !isWebSocketUpgrade(r) {
			w.Header().Set("Connection", "Upgrade")
			w.Header().Set("Upgrade", "websocket")
			writeError(logger, w, http.StatusUpgradeRequired, "BAD_REQUEST", "websocket upgrade required")
			return
		}

		uuid := r.PathValue("uuid")
		if _, err := protocolService.RealtimeState(r.Context(), uuid); err != nil {
			writeProtocolError(logger, w, err)
			return
		}

		upgrader := websocket.Upgrader{
			CheckOrigin: func(request *http.Request) bool {
				return websocketOriginAllowed(request, normalizedAllowedOrigin)
			},
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			if logger != nil {
				logger.Warn("upgrade websocket", "channel_id", uuid, "error", err)
			}
			return
		}

		client, err := hub.Register(uuid, conn)
		if err != nil {
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "connection limit reached"),
				time.Now().Add(time.Second),
			)
			_ = conn.Close()
			return
		}
		defer func() {
			hub.Unregister(client)
			_ = conn.Close()
		}()

		conn.SetReadLimit(maxProtocolBodyBytes)
		_ = conn.SetReadDeadline(time.Now().Add(wsSubscribeTimeout))

		for {
			_, payload, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(
					err,
					websocket.CloseNormalClosure,
					websocket.CloseGoingAway,
					realtime.CloseChannelGone,
					realtime.CloseInvalidPayload,
					realtime.CloseSubscribeTimeout,
				) && logger != nil {
					logger.Debug("read websocket message", "channel_id", uuid, "error", err)
				}

				var netErr net.Error
				if errors.As(err, &netErr) && netErr.Timeout() {
					hub.CloseClient(client, realtime.CloseSubscribeTimeout, "subscribe timeout")
				}
				return
			}

			msg, ok := parseWebSocketClientMessage(payload)
			if !ok {
				hub.CloseClient(client, realtime.CloseInvalidPayload, "invalid message")
				return
			}

			switch msg.Type {
			case "subscribe":
				if msg.UUID != uuid {
					hub.CloseClient(client, realtime.CloseInvalidPayload, "uuid mismatch")
					return
				}

				snapshot, err := protocolService.RealtimeState(r.Context(), uuid)
				if err != nil {
					hub.CloseClient(client, realtime.CloseChannelGone, "channel gone")
					return
				}

				hub.Subscribe(client)
				_ = conn.SetReadDeadline(time.Time{})
				if err := hub.SendState(client, toRealtimeSnapshot(snapshot)); err != nil {
					hub.CloseClient(client, realtime.CloseChannelGone, "send failed")
					return
				}
			case "ping":
				if err := hub.SendPong(client); err != nil {
					hub.CloseClient(client, realtime.CloseChannelGone, "send failed")
					return
				}
			default:
				hub.CloseClient(client, realtime.CloseInvalidPayload, "invalid message")
				return
			}
		}
	}
}

func parseWebSocketClientMessage(payload []byte) (wsClientMessage, bool) {
	var msg wsClientMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		return wsClientMessage{}, false
	}

	switch msg.Type {
	case "subscribe":
		return msg, msg.UUID != ""
	case "ping":
		return msg, true
	default:
		return wsClientMessage{}, false
	}
}

func websocketOriginAllowed(r *http.Request, allowedOrigin string) bool {
	if allowedOrigin == "" {
		return true
	}

	requestOrigin := normalizeOrigin(r.Header.Get("Origin"))
	return requestOrigin == allowedOrigin
}

func toRealtimeSnapshot(state service.RealtimeStateOutput) realtime.StateSnapshot {
	return realtime.StateSnapshot{
		ChannelID:       state.ChannelID,
		State:           state.State,
		Version:         state.Version,
		AdminMode:       state.AdminMode,
		SecurityProfile: state.SecurityProfile,
		ReceiverPubFpr:  state.ReceiverPubFpr,
		ExpiresAt:       state.ExpiresAt,
	}
}
