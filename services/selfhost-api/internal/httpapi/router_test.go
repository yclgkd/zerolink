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
	createBegin  func(context.Context, service.CreateBeginInput) (service.CreateBeginOutput, error)
	createFinish func(context.Context, service.CreateFinishInput) (service.CreateFinishOutput, error)
	publicStatus func(context.Context, string) (service.PublicStatusOutput, error)
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

func newTestRouter(checker stubChecker, protocol stubProtocol) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return newTestRouterWithLogger(checker, protocol, logger)
}

func newTestRouterWithLogger(checker stubChecker, protocol stubProtocol, logger *slog.Logger) http.Handler {
	return NewRouter(Dependencies{
		Logger:        logger,
		AllowedOrigin: "http://localhost:5173",
		Services: service.New(
			checker,
			webauthn.NoopVerifier{},
			realtime.NopHub{},
			protocol,
			logger,
		),
	})
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

	req := httptest.NewRequest(http.MethodPost, "/api/lock_begin/abcdefghijklmnopqrstu", nil)
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
				strings.Repeat("a", maxProtocolBodyBytes)+
				`"}`,
		),
	)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}, stubProtocol{}).ServeHTTP(res, req)

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
