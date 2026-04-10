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
	"net/netip"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/service"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store/filestore"
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

type stubFileStore struct {
	initiate          func(context.Context, string, int) error
	putChunk          func(context.Context, string, int, io.Reader, int64) (string, error)
	presignedUpload   func(context.Context, string, int, time.Duration) (string, error)
	completeUpload    func(context.Context, filestore.FileUploadCompleteRequest) (filestore.MultipartFileRef, error)
	getChunk          func(context.Context, string) (io.ReadCloser, error)
	presignedDownload func(context.Context, filestore.MultipartFileRef, int, time.Duration) (string, error)
	usePresignedURLs  func() bool
	deleteUpload      func(context.Context, filestore.MultipartFileRef) error
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

func (s stubFileStore) Initiate(ctx context.Context, uploadID string, chunkCount int) error {
	if s.initiate == nil {
		return nil
	}
	return s.initiate(ctx, uploadID, chunkCount)
}

func (s stubFileStore) PresignedUpload(ctx context.Context, uploadID string, index int, ttl time.Duration) (string, error) {
	if s.presignedUpload == nil {
		return "https://s3.example/upload", nil
	}
	return s.presignedUpload(ctx, uploadID, index, ttl)
}

func (s stubFileStore) CompleteUpload(ctx context.Context, req filestore.FileUploadCompleteRequest) (filestore.MultipartFileRef, error) {
	if s.completeUpload == nil {
		return filestore.MultipartFileRef{}, nil
	}
	return s.completeUpload(ctx, req)
}

func (s stubFileStore) PresignedDownload(ctx context.Context, fileRef filestore.MultipartFileRef, index int, ttl time.Duration) (string, error) {
	if s.presignedDownload == nil {
		return "https://s3.example/download", nil
	}
	return s.presignedDownload(ctx, fileRef, index, ttl)
}

func (s stubFileStore) PutChunk(ctx context.Context, uploadID string, index int, body io.Reader, size int64) (string, error) {
	if s.putChunk != nil {
		return s.putChunk(ctx, uploadID, index, body, size)
	}
	return "etag-stub", nil
}

func (s stubFileStore) GetChunk(ctx context.Context, key string) (io.ReadCloser, error) {
	if s.getChunk != nil {
		return s.getChunk(ctx, key)
	}
	return io.NopCloser(strings.NewReader("chunk-data")), nil
}

func (s stubFileStore) UsePresignedURLs() bool {
	if s.usePresignedURLs != nil {
		return s.usePresignedURLs()
	}
	return true
}

func (s stubFileStore) DeleteUpload(ctx context.Context, fileRef filestore.MultipartFileRef) error {
	if s.deleteUpload == nil {
		return nil
	}
	return s.deleteUpload(ctx, fileRef)
}

func newTestRouter(checker stubChecker, protocol stubProtocol) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return newTestRouterWithLogger(checker, protocol, logger)
}

func newTestRouterWithLogger(checker stubChecker, protocol stubProtocol, logger *slog.Logger) http.Handler {
	return newTestRouterWithLoggerAndTrustedProxies(checker, protocol, logger, nil)
}

func newTestRouterWithLoggerAndTrustedProxies(
	checker stubChecker,
	protocol stubProtocol,
	logger *slog.Logger,
	trustedProxyCIDRs []netip.Prefix,
) http.Handler {
	realtimeHub := realtime.NewHub(logger)
	return NewRouter(Dependencies{
		Logger:            logger,
		AllowedOrigin:     "http://localhost:5173",
		Realtime:          realtimeHub,
		TrustedProxyCIDRs: trustedProxyCIDRs,
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

func TestBuildCallerRateLimitSubjectPrefersForwardedIPAndNormalizesUserAgent(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/lock_begin/abcdefghijklmnopqrstu", nil)
	req.RemoteAddr = "10.0.0.25:4321"
	req.Header.Set("X-Forwarded-For", "198.51.100.7, 10.0.0.25")
	req.Header.Set(
		"User-Agent",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
	)

	if got := buildCallerRateLimitSubject(req, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}); got != "198.51.100.7|chromium" {
		t.Fatalf("buildCallerRateLimitSubject() = %q, want %q", got, "198.51.100.7|chromium")
	}
}

func TestBuildCallerRateLimitSubjectIgnoresForwardedHeadersFromUntrustedRemote(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/lock_begin/abcdefghijklmnopqrstu", nil)
	req.RemoteAddr = "203.0.113.99:4321"
	req.Header.Set("X-Forwarded-For", "198.51.100.7")
	req.Header.Set("User-Agent", "curl/8.7.1")

	if got := buildCallerRateLimitSubject(req, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}); got != "203.0.113.99|curl" {
		t.Fatalf("buildCallerRateLimitSubject() = %q, want %q", got, "203.0.113.99|curl")
	}
}

func TestLockBeginRouteInjectsCallerRateLimitSubject(t *testing.T) {
	var captured service.LockBeginInput
	router := newTestRouter(stubChecker{}, stubProtocol{
		lockBegin: func(_ context.Context, input service.LockBeginInput) (service.LockBeginOutput, error) {
			captured = input
			return service.LockBeginOutput{
				OK: true,
				LockChallenge: service.LockChallenge{
					ID:        "challenge-id",
					Challenge: "challenge-value",
					ExpiresAt: 1_730_000_000_000,
				},
			}, nil
		},
	})

	body := bytes.NewBufferString(`{"uuid":"abcdefghijklmnopqrstu"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/lock_begin/abcdefghijklmnopqrstu", body)
	req.RemoteAddr = "203.0.113.10:5000"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "curl/8.7.1")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if captured.RateLimitSubject != "203.0.113.10|curl" {
		t.Fatalf("RateLimitSubject = %q, want %q", captured.RateLimitSubject, "203.0.113.10|curl")
	}
}

func TestLockBeginRouteUsesTrustedForwardedIPAndSetsCommitCookie(t *testing.T) {
	trustedProxyCIDRs := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	var captured service.LockBeginInput
	router := newTestRouterWithLoggerAndTrustedProxies(
		stubChecker{},
		stubProtocol{
			lockBegin: func(_ context.Context, input service.LockBeginInput) (service.LockBeginOutput, error) {
				captured = input
				return service.LockBeginOutput{
					OK: true,
					LockChallenge: service.LockChallenge{
						ID:        "challenge-id",
						Challenge: "challenge-value",
						ExpiresAt: 1_730_000_000_000,
					},
					CommitCookieSignal: &service.CommitCookieSignal{
						Action: "set",
						Kind:   service.CommitCookieKindLock,
						Token:  "commit-token-1",
						Exp:    1_730_000_000_000,
					},
				}, nil
			},
		},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		trustedProxyCIDRs,
	)

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/lock_begin/abcdefghijklmnopqrstu",
		bytes.NewBufferString(`{"uuid":"abcdefghijklmnopqrstu"}`),
	)
	req.RemoteAddr = "10.0.0.25:4321"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", "198.51.100.7, 10.0.0.25")
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set(
		"User-Agent",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
	)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if captured.RateLimitSubject != "198.51.100.7|chromium" {
		t.Fatalf("RateLimitSubject = %q, want %q", captured.RateLimitSubject, "198.51.100.7|chromium")
	}

	setCookies := strings.Join(recorder.Header().Values("Set-Cookie"), "\n")
	if !strings.Contains(setCookies, "zl-lock-commit=commit-token-1") {
		t.Fatalf("Set-Cookie = %q, want commit token cookie", setCookies)
	}
	if !strings.Contains(setCookies, "Path=/api/lock_commit/abcdefghijklmnopqrstu") {
		t.Fatalf("Set-Cookie = %q, want lock commit path", setCookies)
	}
	if !strings.Contains(setCookies, "Secure") {
		t.Fatalf("Set-Cookie = %q, want Secure attribute", setCookies)
	}
}

func TestLockCommitRouteReadsCommitCookieAndClearsItOnProtocolError(t *testing.T) {
	var captured service.LockCommitInput
	router := newTestRouter(stubChecker{}, stubProtocol{
		lockCommit: func(_ context.Context, input service.LockCommitInput) (service.LockCommitOutput, error) {
			captured = input
			return service.LockCommitOutput{}, &service.ProtocolError{
				Code:    "CHALLENGE_INVALID",
				Status:  http.StatusUnauthorized,
				Message: "commit token invalid",
				CommitCookieSignal: &service.CommitCookieSignal{
					Action: "clear",
					Kind:   service.CommitCookieKindLock,
				},
			}
		},
	})

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/lock_commit/abcdefghijklmnopqrstu",
		bytes.NewBufferString(`{"uuid":"abcdefghijklmnopqrstu","lockChallengeId":"challenge-id","lockProof":"bad-proof","receiverPubJwk":{"kty":"RSA","alg":"RSA-OAEP-256","n":"bm8","e":"AQAB","ext":true,"key_ops":["encrypt"]},"receiverPubFpr":"`+strings.Repeat("a", 64)+`","lockedAt":1730000000000}`),
	)
	req.RemoteAddr = "203.0.113.10:4321"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "curl/8.7.1")
	req.AddCookie(&http.Cookie{Name: "zl-lock-commit", Value: "commit-token-1"})
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if captured.CommitToken != "commit-token-1" {
		t.Fatalf("CommitToken = %q, want %q", captured.CommitToken, "commit-token-1")
	}

	setCookies := strings.Join(recorder.Header().Values("Set-Cookie"), "\n")
	if !strings.Contains(setCookies, "zl-lock-commit=") {
		t.Fatalf("Set-Cookie = %q, want cleared lock commit cookie", setCookies)
	}
	if !strings.Contains(setCookies, "Max-Age=0") {
		t.Fatalf("Set-Cookie = %q, want Max-Age=0", setCookies)
	}
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

func TestFileInitiateRouteAcceptsNanoIDUUIDAndReturnsTargets(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/file/initiate",
		strings.NewReader(`{"channelUuid":"aaaaaaaaaaaaaaaaaaaaa","chunkCount":2,"totalCiphertextBytes":64}`),
	)
	res := httptest.NewRecorder()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	realtimeHub := realtime.NewHub(logger)
	router := NewRouter(Dependencies{
		Logger:        logger,
		AllowedOrigin: "http://localhost:5173",
		Realtime:      realtimeHub,
		FileStore: stubFileStore{
			presignedUpload: func(_ context.Context, uploadID string, index int, _ time.Duration) (string, error) {
				return "https://s3.example/upload/" + uploadID + "/" + strconv.Itoa(index), nil
			},
		},
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
			stubProtocol{
				publicStatus: func(_ context.Context, uuid string) (service.PublicStatusOutput, error) {
					if uuid != "aaaaaaaaaaaaaaaaaaaaa" {
						t.Fatalf("unexpected uuid %q", uuid)
					}
					return service.PublicStatusOutput{OK: true, State: "locked", AdminMode: "password", SecurityProfile: "quick"}, nil
				},
			},
			logger,
		),
	})

	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", res.Code, res.Body.String())
	}

	var payload filestore.FileUploadInitiateResponse
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Chunks) != 2 {
		t.Fatalf("chunk count = %d, want 2", len(payload.Chunks))
	}
}

func TestFileInitiateRouteRejectsUnknownChannel(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/file/initiate",
		strings.NewReader(`{"channelUuid":"aaaaaaaaaaaaaaaaaaaaa","chunkCount":1,"totalCiphertextBytes":32}`),
	)
	res := httptest.NewRecorder()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	realtimeHub := realtime.NewHub(logger)
	router := NewRouter(Dependencies{
		Logger:        logger,
		AllowedOrigin: "http://localhost:5173",
		Realtime:      realtimeHub,
		FileStore:     stubFileStore{},
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
			stubProtocol{
				publicStatus: func(context.Context, string) (service.PublicStatusOutput, error) {
					return service.PublicStatusOutput{}, &service.ProtocolError{
						Code:    "NOT_FOUND",
						Status:  http.StatusNotFound,
						Message: "channel not found",
					}
				},
			},
			logger,
		),
	})

	router.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", res.Code)
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
