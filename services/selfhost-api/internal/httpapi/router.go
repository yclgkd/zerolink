package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/buildinfo"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/protocol"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/service"
)

type Dependencies struct {
	Logger        *slog.Logger
	Services      *service.Container
	AllowedOrigin string
	Realtime      *realtime.Hub
	FilePolicy    FilePolicy
	MaxProtocolBodyBytes int64
}

type FilePolicy struct {
	MaxFileBytes            int64
	MultipartThresholdBytes int64
	ChunkSizeBytes          int64
	MaxChunks               int64
	MultipartSupported      bool
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

const (
	accessControlAllowHeaders = "Content-Type"
	accessControlAllowMethods = "GET,POST,OPTIONS"
	defaultMaxProtocolBodyBytes = 64 * 1024
)

func NewRouter(deps Dependencies) http.Handler {
	logger := deps.Logger
	if logger == nil {
		logger = slog.Default()
	}

	mux := http.NewServeMux()
	maxProtocolBodyBytes := deps.MaxProtocolBodyBytes
	if maxProtocolBodyBytes <= 0 {
		maxProtocolBodyBytes = defaultMaxProtocolBodyBytes
	}

	mux.HandleFunc("/healthz", methodOnly(http.MethodGet, logger, healthHandler(deps.Services.Health.Live, logger)))
	mux.HandleFunc("/readyz", methodOnly(http.MethodGet, logger, readyHandler(deps.Services.Health, logger)))
	mux.HandleFunc("/api/file_policy", methodOnly(http.MethodGet, logger, filePolicyHandler(deps.FilePolicy, logger)))

	for _, route := range protocol.RouteSpecs() {
		if route.Name == "ws" {
			mux.HandleFunc(
				route.Pattern,
				methodOnly(route.Method, logger, websocketHandler(deps.Services.Protocol, deps.Realtime, logger, deps.AllowedOrigin)),
			)
			continue
		}
		mux.HandleFunc(route.Pattern, methodOnly(route.Method, logger, protocolHandler(route.Name, deps.Services.Protocol, logger, maxProtocolBodyBytes)))
	}

	mux.HandleFunc("/", notFound(logger))

	return loggingMiddleware(
		securityHeadersMiddleware(recoverMiddleware(mux, logger), deps.AllowedOrigin),
		logger,
	)
}

func healthHandler(load func() service.Status, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		status := load()
		writeJSON(logger, w, http.StatusOK, statusResponse{
			OK:        status.OK,
			Service:   buildinfo.ServiceName,
			Version:   buildinfo.Version,
			Status:    status.Status,
			Timestamp: status.Timestamp.Format(time.RFC3339Nano),
			Checks:    status.Checks,
		})
	}
}

func readyHandler(health *service.HealthService, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := health.Ready(r.Context())
		httpStatus := http.StatusOK
		if !status.OK {
			httpStatus = http.StatusServiceUnavailable
		}

		writeJSON(logger, w, httpStatus, statusResponse{
			OK:        status.OK,
			Service:   buildinfo.ServiceName,
			Version:   buildinfo.Version,
			Status:    status.Status,
			Timestamp: status.Timestamp.Format(time.RFC3339Nano),
			Checks:    status.Checks,
		})
	}
}

func protocolPlaceholder(routeName string, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeError(logger, w, http.StatusNotImplemented, "NOT_IMPLEMENTED", routeName+" is not implemented yet")
	}
}

func protocolHandler(routeName string, protocolService service.Protocol, logger *slog.Logger, maxProtocolBodyBytes int64) http.HandlerFunc {
	if protocolService == nil {
		return protocolPlaceholder(routeName, logger)
	}

	switch routeName {
	case "create_begin":
		return createBeginHandler(protocolService, logger, maxProtocolBodyBytes)
	case "create_finish":
		return createFinishHandler(protocolService, logger, maxProtocolBodyBytes)
	case "lock_begin":
		return lockBeginHandler(protocolService, logger, maxProtocolBodyBytes)
	case "lock_commit":
		return lockCommitHandler(protocolService, logger, maxProtocolBodyBytes)
	case "compound_begin":
		return compoundBeginHandler(protocolService, logger, maxProtocolBodyBytes)
	case "compound_commit":
		return compoundCommitHandler(protocolService, logger, false, maxProtocolBodyBytes)
	case "delete_commit":
		return compoundCommitHandler(protocolService, logger, true, maxProtocolBodyBytes)
	case "public_status":
		return publicStatusHandler(protocolService, logger)
	case "decrypt_fetch":
		return decryptFetchHandler(protocolService, logger)
	default:
		return protocolPlaceholder(routeName, logger)
	}
}

func filePolicyHandler(filePolicy FilePolicy, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(logger, w, http.StatusOK, map[string]any{
			"ok": true,
			"policy": map[string]any{
				"maxFileBytes":            filePolicy.MaxFileBytes,
				"multipartThresholdBytes": filePolicy.MultipartThresholdBytes,
				"chunkSizeBytes":          filePolicy.ChunkSizeBytes,
				"maxChunks":               filePolicy.MaxChunks,
				"multipartSupported":      filePolicy.MultipartSupported,
			},
		})
	}
}

func websocketPlaceholder(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !isWebSocketUpgrade(r) {
			w.Header().Set("Connection", "Upgrade")
			w.Header().Set("Upgrade", "websocket")
			writeError(logger, w, http.StatusUpgradeRequired, "BAD_REQUEST", "websocket upgrade required")
			return
		}

		writeError(logger, w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "realtime websocket endpoint is not implemented yet")
	}
}

func notFound(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeError(logger, w, http.StatusNotFound, "NOT_FOUND", "route not found")
	}
}

func methodOnly(method string, logger *slog.Logger, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			w.Header().Set("Allow", method)
			writeError(logger, w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "method not allowed")
			return
		}
		next(w, r)
	}
}

func writeError(logger *slog.Logger, w http.ResponseWriter, status int, code, message string) {
	writeJSON(logger, w, status, errorResponse{
		OK:      false,
		Code:    code,
		Message: message,
	})
}

func writeJSON(logger *slog.Logger, w http.ResponseWriter, status int, payload any) {
	if logger == nil {
		logger = slog.Default()
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		logger.Error("encode json response", "error", err)
	}
}

func createBeginHandler(protocolService service.Protocol, logger *slog.Logger, maxProtocolBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input service.CreateBeginInput
		if !decodeJSONBody(w, r, &input, logger, maxProtocolBodyBytes) {
			return
		}

		if input.UUID != r.PathValue("uuid") {
			writeError(logger, w, http.StatusBadRequest, "BAD_REQUEST", "path/body uuid mismatch")
			return
		}

		output, err := protocolService.CreateBegin(r.Context(), input)
		if err != nil {
			writeProtocolError(logger, w, err)
			return
		}

		writeJSON(logger, w, http.StatusOK, output)
	}
}

func createFinishHandler(protocolService service.Protocol, logger *slog.Logger, maxProtocolBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input service.CreateFinishInput
		if !decodeJSONBody(w, r, &input, logger, maxProtocolBodyBytes) {
			return
		}

		if input.UUID != r.PathValue("uuid") {
			writeError(logger, w, http.StatusBadRequest, "BAD_REQUEST", "path/body uuid mismatch")
			return
		}

		output, err := protocolService.CreateFinish(r.Context(), input)
		if err != nil {
			writeProtocolError(logger, w, err)
			return
		}

		writeJSON(logger, w, http.StatusOK, output)
	}
}

func publicStatusHandler(protocolService service.Protocol, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		output, err := protocolService.PublicStatus(r.Context(), r.PathValue("uuid"))
		if err != nil {
			writeProtocolError(logger, w, err)
			return
		}

		writeJSON(logger, w, http.StatusOK, output)
	}
}

func lockBeginHandler(protocolService service.Protocol, logger *slog.Logger, maxProtocolBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input service.LockBeginInput
		if !decodeJSONBody(w, r, &input, logger, maxProtocolBodyBytes) {
			return
		}

		if input.UUID != r.PathValue("uuid") {
			writeError(logger, w, http.StatusBadRequest, "BAD_REQUEST", "path/body uuid mismatch")
			return
		}

		output, err := protocolService.LockBegin(r.Context(), input)
		if err != nil {
			writeProtocolError(logger, w, err)
			return
		}

		writeJSON(logger, w, http.StatusOK, output)
	}
}

func lockCommitHandler(protocolService service.Protocol, logger *slog.Logger, maxProtocolBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input service.LockCommitInput
		if !decodeJSONBody(w, r, &input, logger, maxProtocolBodyBytes) {
			return
		}

		if input.UUID != r.PathValue("uuid") {
			writeError(logger, w, http.StatusBadRequest, "BAD_REQUEST", "path/body uuid mismatch")
			return
		}

		output, err := protocolService.LockCommit(r.Context(), input)
		if err != nil {
			writeProtocolError(logger, w, err)
			return
		}

		writeJSON(logger, w, http.StatusOK, output)
	}
}

func compoundBeginHandler(protocolService service.Protocol, logger *slog.Logger, maxProtocolBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input service.CompoundBeginInput
		if !decodeJSONBody(w, r, &input, logger, maxProtocolBodyBytes) {
			return
		}

		if input.UUID != r.PathValue("uuid") {
			writeError(logger, w, http.StatusBadRequest, "BAD_REQUEST", "path/body uuid mismatch")
			return
		}

		output, err := protocolService.CompoundBegin(r.Context(), input)
		if err != nil {
			writeProtocolError(logger, w, err)
			return
		}

		writeJSON(logger, w, http.StatusOK, output)
	}
}

func compoundCommitHandler(
	protocolService service.Protocol,
	logger *slog.Logger,
	deleteOnly bool,
	maxProtocolBodyBytes int64,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input service.CompoundCommitInput
		if !decodeJSONBody(w, r, &input, logger, maxProtocolBodyBytes) {
			return
		}

		if input.UUID != r.PathValue("uuid") || input.Intent.UUID != r.PathValue("uuid") {
			writeError(logger, w, http.StatusBadRequest, "BAD_REQUEST", "path/body uuid mismatch")
			return
		}
		if deleteOnly && input.Intent.Op != "delete" {
			writeError(logger, w, http.StatusBadRequest, "BAD_REQUEST", "delete alias requires delete intent")
			return
		}

		output, err := protocolService.CompoundCommit(r.Context(), input)
		if err != nil {
			writeProtocolError(logger, w, err)
			return
		}

		writeJSON(logger, w, http.StatusOK, output)
	}
}

func decryptFetchHandler(protocolService service.Protocol, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		output, err := protocolService.DecryptFetch(r.Context(), r.PathValue("uuid"))
		if err != nil {
			writeProtocolError(logger, w, err)
			return
		}

		writeJSON(logger, w, http.StatusOK, output)
	}
}

func writeProtocolError(logger *slog.Logger, w http.ResponseWriter, err error) {
	if logger == nil {
		logger = slog.Default()
	}

	var protocolErr *service.ProtocolError
	if errors.As(err, &protocolErr) {
		if protocolErr.Status >= http.StatusInternalServerError {
			cause := err
			if protocolErr.Cause != nil {
				cause = protocolErr.Cause
			}
			logger.Error(
				"protocol request failed",
				"code", protocolErr.Code,
				"status", protocolErr.Status,
				"error", cause,
			)
		}
		if protocolErr.RetryAfterSeconds > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(protocolErr.RetryAfterSeconds))
		}
		writeError(logger, w, protocolErr.Status, protocolErr.Code, protocolErr.Message)
		return
	}

	logger.Error("protocol request failed", "status", http.StatusInternalServerError, "error", err)
	writeError(logger, w, http.StatusInternalServerError, "INTERNAL_ERROR", "unexpected internal error")
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any, logger *slog.Logger, maxBytes int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	defer r.Body.Close()

	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(logger, w, http.StatusRequestEntityTooLarge, "BAD_REQUEST", "request body too large")
			return false
		}
		writeError(logger, w, http.StatusBadRequest, "BAD_REQUEST", "invalid json body")
		return false
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeError(logger, w, http.StatusBadRequest, "BAD_REQUEST", "invalid json body")
		return false
	}
	return true
}

func securityHeadersMiddleware(next http.Handler, allowedOrigin string) http.Handler {
	allowedOrigin = normalizeOrigin(allowedOrigin)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")

		requestOrigin := normalizeOrigin(r.Header.Get("Origin"))
		if allowedOrigin != "" && requestOrigin == allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Access-Control-Allow-Methods", accessControlAllowMethods)
			w.Header().Set("Access-Control-Allow-Headers", accessControlAllowHeaders)
			w.Header().Add("Vary", "Origin")
		}

		if r.Method == http.MethodOptions && allowedOrigin != "" && strings.HasPrefix(r.URL.Path, "/api/") && requestOrigin == allowedOrigin {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func normalizeOrigin(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
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
