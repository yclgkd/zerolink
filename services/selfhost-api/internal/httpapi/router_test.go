package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/service"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

type stubChecker struct {
	err error
}

func (s stubChecker) Ping(context.Context) error {
	return s.err
}

func newTestRouter(checker stubChecker) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewRouter(Dependencies{
		Logger: logger,
		Services: service.New(
			checker,
			webauthn.NoopVerifier{},
			realtime.NopHub{},
		),
	})
}

func TestHealthz(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}).ServeHTTP(res, req)

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
}

func TestReadyzReturnsServiceUnavailableWhenDatabaseIsDown(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{err: errors.New("db down")}).ServeHTTP(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", res.Code)
	}
}

func TestProtocolRouteReturnsNotImplemented(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodPost, "/api/create_begin/test-channel", nil)
	res := httptest.NewRecorder()

	newTestRouter(stubChecker{}).ServeHTTP(res, req)

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

	newTestRouter(stubChecker{}).ServeHTTP(res, req)

	if res.Code != http.StatusUpgradeRequired {
		t.Fatalf("status = %d, want 426", res.Code)
	}
}
