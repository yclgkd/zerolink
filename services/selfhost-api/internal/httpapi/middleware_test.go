package httpapi

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecoverMiddlewareRedactsPanicDetails(t *testing.T) {
	t.Parallel()

	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := recoverMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(errors.New("sensitive panic payload"))
	}), logger)

	req := httptest.NewRequest(http.MethodGet, "/api/public/test-channel", nil)
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusInternalServerError)
	}

	logOutput := logs.String()
	if !strings.Contains(logOutput, "panic recovered") {
		t.Fatalf("logs = %q, want panic recovered entry", logOutput)
	}
	if !strings.Contains(logOutput, "panic_type=*errors.errorString") {
		t.Fatalf("logs = %q, want panic type", logOutput)
	}
	if !strings.Contains(logOutput, "panic_fingerprint=") {
		t.Fatalf("logs = %q, want panic fingerprint", logOutput)
	}
	if !strings.Contains(logOutput, "stack_fingerprint=") {
		t.Fatalf("logs = %q, want stack fingerprint", logOutput)
	}
	if strings.Contains(logOutput, "sensitive panic payload") {
		t.Fatalf("logs = %q, want panic message redacted", logOutput)
	}
	if strings.Contains(logOutput, "middleware_test.go") {
		t.Fatalf("logs = %q, want stack redacted", logOutput)
	}
}
