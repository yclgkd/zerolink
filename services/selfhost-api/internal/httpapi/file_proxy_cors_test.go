package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFileChunkProxyOptionsPreflightAllowsPut(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodOptions, "/api/file/chunk/test-token", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", http.MethodPut)
	res := httptest.NewRecorder()

	newProxyTestRouter(stubFileStore{}, stubProtocol{}).ServeHTTP(res, req)

	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", res.Code)
	}
	if res.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want http://localhost:5173", res.Header().Get("Access-Control-Allow-Origin"))
	}
	if res.Header().Get("Access-Control-Allow-Methods") != "GET,POST,PUT,OPTIONS" {
		t.Fatalf("Access-Control-Allow-Methods = %q, want GET,POST,PUT,OPTIONS", res.Header().Get("Access-Control-Allow-Methods"))
	}
}
