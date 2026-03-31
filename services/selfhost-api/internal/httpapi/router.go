package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/buildinfo"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/protocol"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/service"
)

type Dependencies struct {
	Logger   *slog.Logger
	Services *service.Container
}

type errorResponse struct {
	OK      bool   `json:"ok"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type statusResponse struct {
	OK        bool              `json:"ok"`
	Service   string            `json:"service"`
	Version   string            `json:"version"`
	Status    string            `json:"status"`
	Timestamp string            `json:"timestamp"`
	Checks    map[string]string `json:"checks,omitempty"`
}

func NewRouter(deps Dependencies) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", methodOnly(http.MethodGet, healthHandler(deps.Services.Health.Live)))
	mux.HandleFunc("/readyz", methodOnly(http.MethodGet, readyHandler(deps.Services.Health)))

	for _, route := range protocol.RouteSpecs() {
		if route.Name == "ws" {
			mux.HandleFunc(route.Pattern, methodOnly(route.Method, websocketPlaceholder))
			continue
		}
		mux.HandleFunc(route.Pattern, methodOnly(route.Method, protocolPlaceholder(route.Name)))
	}

	mux.HandleFunc("/", notFound)

	return recoverMiddleware(loggingMiddleware(mux, deps.Logger), deps.Logger)
}

func healthHandler(load func() service.Status) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		status := load()
		writeJSON(w, http.StatusOK, statusResponse{
			OK:        status.OK,
			Service:   buildinfo.ServiceName,
			Version:   buildinfo.Version,
			Status:    status.Status,
			Timestamp: status.Timestamp.Format(time.RFC3339Nano),
			Checks:    status.Checks,
		})
	}
}

func readyHandler(health *service.HealthService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := health.Ready(r.Context())
		httpStatus := http.StatusOK
		if !status.OK {
			httpStatus = http.StatusServiceUnavailable
		}

		writeJSON(w, httpStatus, statusResponse{
			OK:        status.OK,
			Service:   buildinfo.ServiceName,
			Version:   buildinfo.Version,
			Status:    status.Status,
			Timestamp: status.Timestamp.Format(time.RFC3339Nano),
			Checks:    status.Checks,
		})
	}
}

func protocolPlaceholder(routeName string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", routeName+" is not implemented yet")
	}
}

func websocketPlaceholder(w http.ResponseWriter, r *http.Request) {
	if !isWebSocketUpgrade(r) {
		w.Header().Set("Connection", "Upgrade")
		w.Header().Set("Upgrade", "websocket")
		writeError(w, http.StatusUpgradeRequired, "BAD_REQUEST", "websocket upgrade required")
		return
	}

	writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "realtime websocket endpoint is not implemented yet")
}

func notFound(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, "NOT_FOUND", "route not found")
}

func methodOnly(method string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			w.Header().Set("Allow", method)
			writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "method not allowed")
			return
		}
		next(w, r)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{
		OK:      false,
		Code:    code,
		Message: message,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Error("encode json response", "error", err)
	}
}

func isWebSocketUpgrade(r *http.Request) bool {
	return headerContainsToken(r.Header, "Connection", "upgrade") &&
		strings.EqualFold(strings.TrimSpace(r.Header.Get("Upgrade")), "websocket")
}

func headerContainsToken(header http.Header, key, expected string) bool {
	for _, part := range strings.Split(header.Get(key), ",") {
		if strings.EqualFold(strings.TrimSpace(part), expected) {
			return true
		}
	}
	return false
}
