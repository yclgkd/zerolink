package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/service"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

type stubChecker struct {
	err error
}

type stubProtocol struct {
	createBegin    func(context.Context, service.CreateBeginInput) (service.CreateBeginOutput, error)
	createFinish   func(context.Context, service.CreateFinishInput) (service.CreateFinishOutput, error)
	lockBegin      func(context.Context, service.LockBeginInput) (service.LockBeginOutput, error)
	lockCommit     func(context.Context, service.LockCommitInput) (service.LockCommitOutput, error)
	compoundBegin  func(context.Context, service.CompoundBeginInput) (service.CompoundBeginOutput, error)
	compoundCommit func(context.Context, service.CompoundCommitInput) (service.CompoundCommitOutput, error)
	publicStatus   func(context.Context, string) (service.PublicStatusOutput, error)
	decryptFetch   func(context.Context, string) (service.DecryptFetchOutput, error)
	realtimeState  func(context.Context, string) (service.RealtimeStateOutput, error)
}

func (s stubChecker) Ping(context.Context) error {
	return s.err
}

func (s stubProtocol) CreateBegin(ctx context.Context, input service.CreateBeginInput) (service.CreateBeginOutput, error) {
	if s.createBegin == nil {
		return service.CreateBeginOutput{}, &service.ProtocolError{
			Code:    "NOT_IMPLEMENTED",
			Status:  http.StatusNotImplemented,
			Message: "create_begin is not implemented yet",
		}
	}
	return s.createBegin(ctx, input)
}

func (s stubProtocol) CreateFinish(ctx context.Context, input service.CreateFinishInput) (service.CreateFinishOutput, error) {
	if s.createFinish == nil {
		return service.CreateFinishOutput{}, &service.ProtocolError{
			Code:    "NOT_IMPLEMENTED",
			Status:  http.StatusNotImplemented,
			Message: "create_finish is not implemented yet",
		}
	}
	return s.createFinish(ctx, input)
}

func (s stubProtocol) LockBegin(ctx context.Context, input service.LockBeginInput) (service.LockBeginOutput, error) {
	if s.lockBegin == nil {
		return service.LockBeginOutput{}, &service.ProtocolError{
			Code:    "NOT_IMPLEMENTED",
			Status:  http.StatusNotImplemented,
			Message: "lock_begin is not implemented yet",
		}
	}
	return s.lockBegin(ctx, input)
}

func (s stubProtocol) LockCommit(ctx context.Context, input service.LockCommitInput) (service.LockCommitOutput, error) {
	if s.lockCommit == nil {
		return service.LockCommitOutput{}, &service.ProtocolError{
			Code:    "NOT_IMPLEMENTED",
			Status:  http.StatusNotImplemented,
			Message: "lock_commit is not implemented yet",
		}
	}
	return s.lockCommit(ctx, input)
}

func (s stubProtocol) CompoundBegin(ctx context.Context, input service.CompoundBeginInput) (service.CompoundBeginOutput, error) {
	if s.compoundBegin == nil {
		return service.CompoundBeginOutput{}, &service.ProtocolError{
			Code:    "NOT_IMPLEMENTED",
			Status:  http.StatusNotImplemented,
			Message: "compound_begin is not implemented yet",
		}
	}
	return s.compoundBegin(ctx, input)
}

func (s stubProtocol) CompoundCommit(ctx context.Context, input service.CompoundCommitInput) (service.CompoundCommitOutput, error) {
	if s.compoundCommit == nil {
		return service.CompoundCommitOutput{}, &service.ProtocolError{
			Code:    "NOT_IMPLEMENTED",
			Status:  http.StatusNotImplemented,
			Message: "compound_commit is not implemented yet",
		}
	}
	return s.compoundCommit(ctx, input)
}

func (s stubProtocol) PublicStatus(ctx context.Context, uuid string) (service.PublicStatusOutput, error) {
	if s.publicStatus == nil {
		return service.PublicStatusOutput{}, &service.ProtocolError{
			Code:    "NOT_IMPLEMENTED",
			Status:  http.StatusNotImplemented,
			Message: "public_status is not implemented yet",
		}
	}
	return s.publicStatus(ctx, uuid)
}

func (s stubProtocol) DecryptFetch(ctx context.Context, uuid string) (service.DecryptFetchOutput, error) {
	if s.decryptFetch == nil {
		return service.DecryptFetchOutput{}, &service.ProtocolError{
			Code:    "NOT_IMPLEMENTED",
			Status:  http.StatusNotImplemented,
			Message: "decrypt_fetch is not implemented yet",
		}
	}
	return s.decryptFetch(ctx, uuid)
}

func (s stubProtocol) RealtimeState(ctx context.Context, uuid string) (service.RealtimeStateOutput, error) {
	if s.realtimeState == nil {
		return service.RealtimeStateOutput{}, &service.ProtocolError{
			Code:    "NOT_IMPLEMENTED",
			Status:  http.StatusNotImplemented,
			Message: "realtime_state is not implemented yet",
		}
	}
	return s.realtimeState(ctx, uuid)
}

func newTestRouter(checker stubChecker, protocol stubProtocol) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return newTestRouterWithLogger(checker, protocol, logger)
}

func newTestRouterWithLogger(checker stubChecker, protocol stubProtocol, logger *slog.Logger) http.Handler {
	realtimeHub := realtime.NewHub(logger)
	return NewRouter(Dependencies{
		Logger:        logger,
		AllowedOrigin: "http://localhost:5173",
		Realtime:      realtimeHub,
		FilePolicy: FilePolicy{
			MaxFileBytes:            2_097_152,
			MultipartThresholdBytes: 2_097_152,
			ChunkSizeBytes:          262_144,
			MaxChunks:               8,
			MultipartSupported:      false,
		},
		Services: service.New(
			checker,
			webauthn.NoopVerifier{},
			realtimeHub,
			protocol,
			logger,
		),
	})
}

func TestFilePolicyRouteReturnsConfiguredPolicy(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/file_policy", nil)
	res := httptest.NewRecorder()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	realtimeHub := realtime.NewHub(logger)
	router := NewRouter(Dependencies{
		Logger:        logger,
		AllowedOrigin: "http://localhost:5173",
		Realtime:      realtimeHub,
		FilePolicy: FilePolicy{
			MaxFileBytes:            1_048_576,
			MultipartThresholdBytes: 1_048_576,
			ChunkSizeBytes:          262_144,
			MaxChunks:               4,
			MultipartSupported:      false,
		},
		Services: service.New(
			stubChecker{},
			webauthn.NoopVerifier{},
			realtimeHub,
			stubProtocol{},
			logger,
		),
	})

	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}

	var payload struct {
		OK     bool `json:"ok"`
		Policy struct {
			MaxFileBytes            int64 `json:"maxFileBytes"`
			MultipartThresholdBytes int64 `json:"multipartThresholdBytes"`
			ChunkSizeBytes          int64 `json:"chunkSizeBytes"`
			MaxChunks               int64 `json:"maxChunks"`
			MultipartSupported      bool  `json:"multipartSupported"`
		} `json:"policy"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK {
		t.Fatal("payload.OK = false, want true")
	}
	if payload.Policy.MaxFileBytes != 1_048_576 {
		t.Fatalf("MaxFileBytes = %d, want 1048576", payload.Policy.MaxFileBytes)
	}
	if payload.Policy.MaxChunks != 4 {
		t.Fatalf("MaxChunks = %d, want 4", payload.Policy.MaxChunks)
	}
}

func TestHealthz(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{}).ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}

	var payload statusResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK {
		t.Fatal("payload.OK = false, want true")
	}
	if res.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", res.Header().Get("X-Content-Type-Options"))
	}
	if res.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("X-Frame-Options = %q, want DENY", res.Header().Get("X-Frame-Options"))
	}
}

func TestReadyzReturnsServiceUnavailableWhenDatabaseIsDown(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{err: errors.New("db down")}, stubProtocol{}).ServeHTTP(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", res.Code)
	}
}

func TestReadyzLogsDatabaseFailure(t *testing.T) {
	t.Parallel()

	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	res := httptest.NewRecorder()

	newTestRouterWithLogger(stubChecker{err: errors.New("db down")}, stubProtocol{}, logger).ServeHTTP(res, req)

	if !strings.Contains(logs.String(), "db down") {
		t.Fatalf("logs = %q, want db down detail", logs.String())
	}
}

func TestProtocolRouteReturnsNotImplemented(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/decrypt_fetch/abcdefghijklmnopqrstu", nil)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{}).ServeHTTP(res, req)

	if res.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", res.Code)
	}

	var payload errorResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Code != "NOT_IMPLEMENTED" {
		t.Fatalf("payload.Code = %q, want NOT_IMPLEMENTED", payload.Code)
	}
}

func TestWebsocketRouteRequiresUpgrade(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/ws/test-channel", nil)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{}).ServeHTTP(res, req)

	if res.Code != http.StatusUpgradeRequired {
		t.Fatalf("status = %d, want 426", res.Code)
	}
}

func TestCreateBeginRouteReturnsProtocolPayload(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/create_begin/abcdefghijklmnopqrstu",
		strings.NewReader(`{"uuid":"abcdefghijklmnopqrstu","timestamp":1730000000000,"securityProfile":"secure","ttl":3600000}`),
	)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{
		createBegin: func(_ context.Context, input service.CreateBeginInput) (service.CreateBeginOutput, error) {
			if input.UUID != "abcdefghijklmnopqrstu" {
				t.Fatalf("unexpected uuid %q", input.UUID)
			}
			return service.CreateBeginOutput{
				OK: true,
				CreationOptions: map[string]any{
					"challenge": "challenge",
				},
			}, nil
		},
	}).ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
}

func TestCreateBeginRouteRejectsPathBodyMismatch(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/create_begin/abcdefghijklmnopqrstu",
		strings.NewReader(`{"uuid":"bbbbbbbbbbbbbbbbbbbbb","timestamp":1730000000000,"securityProfile":"secure","ttl":3600000}`),
	)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{}).ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.Code)
	}
}

func TestCreateBeginRouteRejectsOversizedBody(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/create_begin/abcdefghijklmnopqrstu",
		strings.NewReader(
			`{"uuid":"abcdefghijklmnopqrstu","timestamp":1730000000000,"securityProfile":"secure","padding":"`+
				strings.Repeat("a", defaultMaxProtocolBodyBytes)+
				`"}`,
		),
	)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{}).ServeHTTP(res, req)

	if res.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", res.Code)
	}
}

func TestCreateBeginRouteKeepsDefaultBodyLimitWhenCompoundCommitCapIsExpanded(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	realtimeHub := realtime.NewHub(logger)
	router := NewRouter(Dependencies{
		Logger:               logger,
		AllowedOrigin:        "http://localhost:5173",
		Realtime:             realtimeHub,
		MaxProtocolBodyBytes: 8 * 1024 * 1024,
		FilePolicy: FilePolicy{
			MaxFileBytes:            2_097_152,
			MultipartThresholdBytes: 2_097_152,
			ChunkSizeBytes:          262_144,
			MaxChunks:               8,
			MultipartSupported:      false,
		},
		Services: service.New(
			stubChecker{},
			webauthn.NoopVerifier{},
			realtimeHub,
			stubProtocol{},
			logger,
		),
	})

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/create_begin/abcdefghijklmnopqrstu",
		strings.NewReader(
			`{"uuid":"abcdefghijklmnopqrstu","timestamp":1730000000000,"securityProfile":"secure","padding":"`+
				strings.Repeat("a", defaultMaxProtocolBodyBytes)+
				`"}`,
		),
	)
	res := httptest.NewRecorder()

	router.ServeHTTP(res, req)

	if res.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", res.Code)
	}
}

func TestCreateFinishRouteRejectsInvalidJSON(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/create_finish/abcdefghijklmnopqrstu",
		strings.NewReader(`{"uuid":"abcdefghijklmnopqrstu"`),
	)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{}).ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.Code)
	}
}

func TestCreateBeginRouteLogsInternalProtocolErrors(t *testing.T) {
	t.Parallel()

	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/create_begin/abcdefghijklmnopqrstu",
		strings.NewReader(`{"uuid":"abcdefghijklmnopqrstu","timestamp":1730000000000,"securityProfile":"secure","ttl":3600000}`),
	)
	res := httptest.NewRecorder()

	newTestRouterWithLogger(stubChecker{}, stubProtocol{
		createBegin: func(context.Context, service.CreateBeginInput) (service.CreateBeginOutput, error) {
			return service.CreateBeginOutput{}, &service.ProtocolError{
				Code:    "INTERNAL_ERROR",
				Status:  http.StatusInternalServerError,
				Message: "unexpected internal error",
				Cause:   errors.New("db down"),
			}
		},
	}, logger).ServeHTTP(res, req)

	if res.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", res.Code)
	}
	if !strings.Contains(logs.String(), "db down") {
		t.Fatalf("logs = %q, want db down detail", logs.String())
	}
}

func TestPublicStatusRouteReturnsProtocolPayload(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/public/abcdefghijklmnopqrstu", nil)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{
		publicStatus: func(_ context.Context, uuid string) (service.PublicStatusOutput, error) {
			if uuid != "abcdefghijklmnopqrstu" {
				t.Fatalf("unexpected uuid %q", uuid)
			}
			return service.PublicStatusOutput{
				OK:              true,
				State:           "waiting",
				AdminMode:       "webauthn",
				SecurityProfile: "secure",
			}, nil
		},
	}).ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
}

func TestAPIOptionsPreflightReturnsConfiguredCORSHeaders(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodOptions, "/api/create_begin/abcdefghijklmnopqrstu", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{}).ServeHTTP(res, req)

	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", res.Code)
	}
	if res.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q", res.Header().Get("Access-Control-Allow-Origin"))
	}
	if res.Header().Get("Access-Control-Allow-Methods") != accessControlAllowMethods {
		t.Fatalf("Access-Control-Allow-Methods = %q", res.Header().Get("Access-Control-Allow-Methods"))
	}
}
