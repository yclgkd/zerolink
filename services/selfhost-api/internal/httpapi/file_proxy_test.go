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
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/service"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store/filestore"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

func newProxyTestRouter(fileStore stubFileStore, protocol stubProtocol) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	realtimeHub := realtime.NewHub(logger)
	return NewRouter(Dependencies{
		Logger:        logger,
		AllowedOrigin: "http://localhost:5173",
		Realtime:      realtimeHub,
		FileStore:     fileStore,
		FilePolicy: FilePolicy{
			MaxFileBytes:            536_870_912,
			MultipartThresholdBytes: 2_080_760,
			ChunkSizeBytes:          4 * 1024 * 1024,
			MaxChunks:               128,
			MultipartSupported:      true,
		},
		Services: service.New(
			stubChecker{},
			webauthn.NoopVerifier{},
			realtimeHub,
			protocol,
			logger,
		),
	})
}

func newProxyFileRef() filestore.MultipartFileRef {
	return filestore.MultipartFileRef{
		StorageBackend:       filestore.FileStorageBackendS3,
		ChunkSizeBytes:       32,
		ChunkCount:           1,
		TotalPlaintextBytes:  16,
		TotalCiphertextBytes: 32,
		BaseIV:               "YmFzZS1pdg",
		EncContentKey:        "ZW5jLWtleQ",
		Chunks: []filestore.MultipartFileRefChunk{
			{
				Index:           0,
				StorageKey:      "files/upload-1/0000.bin",
				CiphertextBytes: 32,
				CiphertextHash:  strings.Repeat("a", 64),
			},
		},
	}
}

func TestFileInitiateRouteReturnsRelativeProxyTargetsWhenPresignedDisabled(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/file/initiate",
		strings.NewReader(`{"channelUuid":"aaaaaaaaaaaaaaaaaaaaa","chunkCount":2,"totalCiphertextBytes":64}`),
	)
	res := httptest.NewRecorder()

	newProxyTestRouter(
		stubFileStore{usePresignedURLs: func() bool { return false }},
		stubProtocol{
			publicStatus: func(_ context.Context, _ string) (service.PublicStatusOutput, error) {
				return service.PublicStatusOutput{OK: true, State: "locked", AdminMode: "password", SecurityProfile: "quick"}, nil
			},
		},
	).ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", res.Code, res.Body.String())
	}

	var payload filestore.FileUploadInitiateResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	got := payload.Chunks[0].UploadURL
	if strings.HasPrefix(got, "/") {
		t.Fatalf("first upload url = %q, want relative proxy route", got)
	}
	if !strings.HasPrefix(got, "file/chunk/") {
		t.Fatalf("first upload url = %q, want file/chunk/ prefix", got)
	}
}

func TestFileInitiateRouteReturnsRelativeProxyTargetsWhenPresignedEnabled(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/file/initiate",
		strings.NewReader(`{"channelUuid":"aaaaaaaaaaaaaaaaaaaaa","chunkCount":2,"totalCiphertextBytes":64}`),
	)
	res := httptest.NewRecorder()

	newProxyTestRouter(
		stubFileStore{
			usePresignedURLs: func() bool { return true },
			presignedUpload: func(context.Context, string, int, time.Duration) (string, error) {
				t.Fatal("presigned upload targets should not be issued for file uploads")
				return "", nil
			},
		},
		stubProtocol{
			publicStatus: func(_ context.Context, _ string) (service.PublicStatusOutput, error) {
				return service.PublicStatusOutput{OK: true, State: "locked", AdminMode: "password", SecurityProfile: "quick"}, nil
			},
		},
	).ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", res.Code, res.Body.String())
	}

	var payload filestore.FileUploadInitiateResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	got := payload.Chunks[0].UploadURL
	if strings.HasPrefix(got, "/") {
		t.Fatalf("first upload url = %q, want relative proxy route", got)
	}
	if !strings.HasPrefix(got, "file/chunk/") {
		t.Fatalf("first upload url = %q, want file/chunk/ prefix", got)
	}
}

func TestFileChunkProxyRouteRejectsUnissuedTarget(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodPut, "/api/file/chunk/arbitrary-upload/0", strings.NewReader("chunk"))
	res := httptest.NewRecorder()

	newProxyTestRouter(
		stubFileStore{
			usePresignedURLs: func() bool { return false },
			putChunk: func(context.Context, string, int, io.Reader, int64) (string, error) {
				t.Fatal("putChunk should not be called for an unissued proxy target")
				return "", nil
			},
		},
		stubProtocol{},
	).ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", res.Code)
	}
}

func TestFileChunkProxyRouteAcceptsIssuedTarget(t *testing.T) {
	t.Parallel()

	putCalled := false
	router := newProxyTestRouter(
		stubFileStore{
			usePresignedURLs: func() bool { return false },
			putChunk: func(_ context.Context, uploadID string, index int, body io.Reader, size int64) (string, error) {
				putCalled = true
				if uploadID == "" {
					t.Fatal("uploadID = empty, want issued upload id")
				}
				if index != 0 {
					t.Fatalf("index = %d, want 0", index)
				}
				payload, err := io.ReadAll(body)
				if err != nil {
					t.Fatalf("read body: %v", err)
				}
				if !bytes.Equal(payload, []byte("chunk-body")) {
					t.Fatalf("body = %q, want chunk-body", payload)
				}
				if size != int64(len("chunk-body")) {
					t.Fatalf("size = %d, want %d", size, len("chunk-body"))
				}
				return "etag-issued", nil
			},
		},
		stubProtocol{
			publicStatus: func(_ context.Context, _ string) (service.PublicStatusOutput, error) {
				return service.PublicStatusOutput{OK: true, State: "locked", AdminMode: "password", SecurityProfile: "quick"}, nil
			},
		},
	)

	initiateReq := httptest.NewRequest(
		http.MethodPost,
		"/api/file/initiate",
		strings.NewReader(`{"channelUuid":"aaaaaaaaaaaaaaaaaaaaa","chunkCount":1,"totalCiphertextBytes":32}`),
	)
	initiateRes := httptest.NewRecorder()
	router.ServeHTTP(initiateRes, initiateReq)
	if initiateRes.Code != http.StatusOK {
		t.Fatalf("initiate status = %d, want 200: %s", initiateRes.Code, initiateRes.Body.String())
	}

	var payload filestore.FileUploadInitiateResponse
	if err := json.Unmarshal(initiateRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode initiate response: %v", err)
	}
	if strings.HasPrefix(payload.Chunks[0].UploadURL, "/") {
		t.Fatalf("upload url = %q, want relative proxy route", payload.Chunks[0].UploadURL)
	}

	uploadReq := httptest.NewRequest(
		http.MethodPut,
		"/api/"+payload.Chunks[0].UploadURL,
		strings.NewReader("chunk-body"),
	)
	uploadRes := httptest.NewRecorder()
	router.ServeHTTP(uploadRes, uploadReq)

	if !putCalled {
		t.Fatal("putChunk was not called for an issued proxy target")
	}
	if uploadRes.Code != http.StatusOK {
		t.Fatalf("upload status = %d, want 200: %s", uploadRes.Code, uploadRes.Body.String())
	}
	if uploadRes.Header().Get("ETag") != "etag-issued" {
		t.Fatalf("ETag = %q, want etag-issued", uploadRes.Header().Get("ETag"))
	}
}

func TestFileChunkProxyRouteRejectsOversizedChunk(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	realtimeHub := realtime.NewHub(logger)
	router := NewRouter(Dependencies{
		Logger:        logger,
		AllowedOrigin: "http://localhost:5173",
		Realtime:      realtimeHub,
		FileStore: stubFileStore{
			usePresignedURLs: func() bool { return false },
			putChunk: func(context.Context, string, int, io.Reader, int64) (string, error) {
				t.Fatal("putChunk should not be called for oversized chunks")
				return "", nil
			},
		},
		FilePolicy: FilePolicy{
			MaxFileBytes:            64,
			MultipartThresholdBytes: 16,
			ChunkSizeBytes:          8,
			MaxChunks:               4,
			MultipartSupported:      true,
		},
		Services: service.New(
			stubChecker{},
			webauthn.NoopVerifier{},
			realtimeHub,
			stubProtocol{
				publicStatus: func(_ context.Context, _ string) (service.PublicStatusOutput, error) {
					return service.PublicStatusOutput{OK: true, State: "locked", AdminMode: "password", SecurityProfile: "quick"}, nil
				},
			},
			logger,
		),
	})

	initiateReq := httptest.NewRequest(
		http.MethodPost,
		"/api/file/initiate",
		strings.NewReader(`{"channelUuid":"aaaaaaaaaaaaaaaaaaaaa","chunkCount":1,"totalCiphertextBytes":24}`),
	)
	initiateRes := httptest.NewRecorder()
	router.ServeHTTP(initiateRes, initiateReq)
	if initiateRes.Code != http.StatusOK {
		t.Fatalf("initiate status = %d, want 200: %s", initiateRes.Code, initiateRes.Body.String())
	}

	var payload filestore.FileUploadInitiateResponse
	if err := json.Unmarshal(initiateRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode initiate response: %v", err)
	}

	uploadReq := httptest.NewRequest(
		http.MethodPut,
		"/api/"+payload.Chunks[0].UploadURL,
		strings.NewReader(strings.Repeat("x", 25)),
	)
	uploadRes := httptest.NewRecorder()
	router.ServeHTTP(uploadRes, uploadReq)

	if uploadRes.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", uploadRes.Code, uploadRes.Body.String())
	}
}

func TestFileDownloadProxyRouteRejectsDirectStorageKey(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/file/download/files/test/0000.bin", nil)
	res := httptest.NewRecorder()

	newProxyTestRouter(
		stubFileStore{
			getChunk: func(context.Context, string) (io.ReadCloser, error) {
				t.Fatal("getChunk should not be called for a direct storage key")
				return nil, nil
			},
		},
		stubProtocol{},
	).ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", res.Code)
	}
}

func TestFileFetchRouteReturnsRelativeProxyDownloadTarget(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/file/fetch/aaaaaaaaaaaaaaaaaaaaa", nil)
	res := httptest.NewRecorder()

	newProxyTestRouter(
		stubFileStore{usePresignedURLs: func() bool { return false }},
		stubProtocol{
			decryptFetch: func(_ context.Context, _ string) (service.DecryptFetchOutput, error) {
				fileRef := newProxyFileRef()
				return service.DecryptFetchOutput{OK: true, FileRef: &fileRef}, nil
			},
		},
	).ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", res.Code, res.Body.String())
	}

	var payload filestore.FileFetchResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	got := payload.Chunks[0].DownloadURL
	if strings.HasPrefix(got, "/") {
		t.Fatalf("first download url = %q, want relative proxy route", got)
	}
	if !strings.HasPrefix(got, "file/download/") {
		t.Fatalf("first download url = %q, want file/download/ prefix", got)
	}
	if strings.Contains(got, "files/upload-1/0000.bin") {
		t.Fatalf("first download url = %q, want opaque proxy token instead of storage key", got)
	}
}

func TestFileDownloadProxyRouteConsumesIssuedTarget(t *testing.T) {
	t.Parallel()

	router := newProxyTestRouter(
		stubFileStore{
			usePresignedURLs: func() bool { return false },
			getChunk: func(_ context.Context, key string) (io.ReadCloser, error) {
				if key != "files/upload-1/0000.bin" {
					t.Fatalf("key = %q, want files/upload-1/0000.bin", key)
				}
				return io.NopCloser(strings.NewReader("chunk-data")), nil
			},
		},
		stubProtocol{
			decryptFetch: func(_ context.Context, _ string) (service.DecryptFetchOutput, error) {
				fileRef := newProxyFileRef()
				return service.DecryptFetchOutput{OK: true, FileRef: &fileRef}, nil
			},
		},
	)

	fetchReq := httptest.NewRequest(http.MethodGet, "/api/file/fetch/aaaaaaaaaaaaaaaaaaaaa", nil)
	fetchRes := httptest.NewRecorder()
	router.ServeHTTP(fetchRes, fetchReq)
	if fetchRes.Code != http.StatusOK {
		t.Fatalf("fetch status = %d, want 200: %s", fetchRes.Code, fetchRes.Body.String())
	}

	var payload filestore.FileFetchResponse
	if err := json.Unmarshal(fetchRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode fetch response: %v", err)
	}

	downloadPath := "/api/" + payload.Chunks[0].DownloadURL
	firstReq := httptest.NewRequest(http.MethodGet, downloadPath, nil)
	firstRes := httptest.NewRecorder()
	router.ServeHTTP(firstRes, firstReq)

	if firstRes.Code != http.StatusOK {
		t.Fatalf("first status = %d, want 200: %s", firstRes.Code, firstRes.Body.String())
	}
	if firstRes.Body.String() != "chunk-data" {
		t.Fatalf("first body = %q, want chunk-data", firstRes.Body.String())
	}

	secondReq := httptest.NewRequest(http.MethodGet, downloadPath, nil)
	secondRes := httptest.NewRecorder()
	router.ServeHTTP(secondRes, secondReq)

	if secondRes.Code != http.StatusNotFound {
		t.Fatalf("second status = %d, want 404", secondRes.Code)
	}
}

type errOnFirstReadCloser struct {
	triggered bool
}

func (r *errOnFirstReadCloser) Read(_ []byte) (int, error) {
	if r.triggered {
		return 0, io.EOF
	}
	r.triggered = true
	return 0, errors.New("missing object")
}

func (r *errOnFirstReadCloser) Close() error {
	return nil
}

func TestFileDownloadProxyRouteReturnsStorageErrorWhenFirstReadFails(t *testing.T) {
	t.Parallel()

	router := newProxyTestRouter(
		stubFileStore{
			usePresignedURLs: func() bool { return false },
			getChunk: func(context.Context, string) (io.ReadCloser, error) {
				return &errOnFirstReadCloser{}, nil
			},
		},
		stubProtocol{
			decryptFetch: func(_ context.Context, _ string) (service.DecryptFetchOutput, error) {
				fileRef := newProxyFileRef()
				return service.DecryptFetchOutput{OK: true, FileRef: &fileRef}, nil
			},
		},
	)

	fetchReq := httptest.NewRequest(http.MethodGet, "/api/file/fetch/aaaaaaaaaaaaaaaaaaaaa", nil)
	fetchRes := httptest.NewRecorder()
	router.ServeHTTP(fetchRes, fetchReq)
	if fetchRes.Code != http.StatusOK {
		t.Fatalf("fetch status = %d, want 200: %s", fetchRes.Code, fetchRes.Body.String())
	}

	var payload filestore.FileFetchResponse
	if err := json.Unmarshal(fetchRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode fetch response: %v", err)
	}
	if strings.HasPrefix(payload.Chunks[0].DownloadURL, "/") {
		t.Fatalf("download url = %q, want relative proxy route", payload.Chunks[0].DownloadURL)
	}

	downloadReq := httptest.NewRequest(
		http.MethodGet,
		"/api/"+payload.Chunks[0].DownloadURL,
		nil,
	)
	downloadRes := httptest.NewRecorder()
	router.ServeHTTP(downloadRes, downloadReq)

	if downloadRes.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", downloadRes.Code)
	}
	if !strings.Contains(downloadRes.Body.String(), "STORAGE_ERROR") {
		t.Fatalf("body = %q, want STORAGE_ERROR", downloadRes.Body.String())
	}
}
