package config

import (
	"net/netip"
	"strings"
	"testing"
	"time"
)

func TestLoadFromEnvSuccess(t *testing.T) {
	t.Parallel()

	cfg, err := LoadFromEnv(func(key string) (string, bool) {
		values := map[string]string{
			"SELFHOST_API_DATABASE_URL":                   "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
			"SELFHOST_API_APP_ENV":                        "production",
			"SELFHOST_API_LOG_LEVEL":                      "debug",
			"SELFHOST_API_BIND_ADDR":                      ":9999",
			"SELFHOST_API_RP_ID":                          "localhost",
			"SELFHOST_API_RP_ORIGIN":                      "http://localhost:5173",
			"SELFHOST_API_HTTP_SHUTDOWN_TIMEOUT":          "30s",
			"SELFHOST_API_DB_MAX_CONNS":                   "12",
			"SELFHOST_API_DB_MIN_CONNS":                   "2",
			"SELFHOST_API_DB_CONNECT_TIMEOUT":             "7s",
			"SELFHOST_API_DB_HEALTH_TIMEOUT":              "3s",
			"SELFHOST_API_HTTP_READ_TIMEOUT":              "11s",
			"SELFHOST_API_HTTP_READ_HEADER_TIMEOUT":       "6s",
			"SELFHOST_API_FILE_MAX_BYTES":                 "1048576",
			"SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES": "1048576",
			"SELFHOST_API_FILE_CHUNK_SIZE_BYTES":          "262144",
			"SELFHOST_API_FILE_MAX_CHUNKS":                "4",
			"SELFHOST_API_FILE_STORAGE_BACKEND":           "inline",
			"SELFHOST_API_COMMIT_TOKEN_SECRET":            "test-secret",
			"SELFHOST_API_TRUSTED_PROXY_CIDRS":            "10.0.0.0/8,127.0.0.1",
		}

		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}

	if cfg.AppEnv != "production" {
		t.Fatalf("AppEnv = %q, want production", cfg.AppEnv)
	}
	if cfg.HTTP.BindAddr != ":9999" {
		t.Fatalf("BindAddr = %q, want :9999", cfg.HTTP.BindAddr)
	}
	if cfg.HTTP.ShutdownTimeout != 30*time.Second {
		t.Fatalf("ShutdownTimeout = %v, want 30s", cfg.HTTP.ShutdownTimeout)
	}
	if cfg.Database.MaxConns != 12 {
		t.Fatalf("MaxConns = %d, want 12", cfg.Database.MaxConns)
	}
	if cfg.Database.MinConns != 2 {
		t.Fatalf("MinConns = %d, want 2", cfg.Database.MinConns)
	}
	if cfg.Database.ConnectTimeout != 7*time.Second {
		t.Fatalf("ConnectTimeout = %v, want 7s", cfg.Database.ConnectTimeout)
	}
	if cfg.RP.ID != "localhost" {
		t.Fatalf("RP.ID = %q, want localhost", cfg.RP.ID)
	}
	if cfg.RP.Origin != "http://localhost:5173" {
		t.Fatalf("RP.Origin = %q, want http://localhost:5173", cfg.RP.Origin)
	}
	if cfg.File.MaxBytes != 1_048_576 {
		t.Fatalf("File.MaxBytes = %d, want 1048576", cfg.File.MaxBytes)
	}
	if cfg.File.MaxChunks != 4 {
		t.Fatalf("File.MaxChunks = %d, want 4", cfg.File.MaxChunks)
	}
	if cfg.File.StorageBackend != "inline" {
		t.Fatalf("File.StorageBackend = %q, want inline", cfg.File.StorageBackend)
	}
	if cfg.CommitTokenSecret != "test-secret" {
		t.Fatalf("CommitTokenSecret = %q, want test-secret", cfg.CommitTokenSecret)
	}
	if len(cfg.HTTP.TrustedProxyCIDRs) != 2 {
		t.Fatalf("TrustedProxyCIDRs len = %d, want 2", len(cfg.HTTP.TrustedProxyCIDRs))
	}
	if cfg.HTTP.TrustedProxyCIDRs[0] != netip.MustParsePrefix("10.0.0.0/8") {
		t.Fatalf("TrustedProxyCIDRs[0] = %v, want 10.0.0.0/8", cfg.HTTP.TrustedProxyCIDRs[0])
	}
	if cfg.HTTP.TrustedProxyCIDRs[1] != netip.MustParsePrefix("127.0.0.1/32") {
		t.Fatalf("TrustedProxyCIDRs[1] = %v, want 127.0.0.1/32", cfg.HTTP.TrustedProxyCIDRs[1])
	}
}

func TestLoadFromEnvCanonicalizesRPOrigin(t *testing.T) {
	t.Parallel()

	cfg, err := LoadFromEnv(func(key string) (string, bool) {
		values := map[string]string{
			"SELFHOST_API_DATABASE_URL":        "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
			"SELFHOST_API_RP_ID":               "localhost",
			"SELFHOST_API_RP_ORIGIN":           "HTTPS://Example.COM:443/",
			"SELFHOST_API_COMMIT_TOKEN_SECRET": "test-secret",
		}
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}

	if cfg.RP.Origin != "https://example.com" {
		t.Fatalf("RP.Origin = %q, want https://example.com", cfg.RP.Origin)
	}
}

func TestLoadFromEnvUsesLegacyCommitTokenSecretFallback(t *testing.T) {
	t.Parallel()

	cfg, err := LoadFromEnv(func(key string) (string, bool) {
		values := map[string]string{
			"SELFHOST_API_DATABASE_URL": "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
			"SELFHOST_API_RP_ID":        "localhost",
			"SELFHOST_API_RP_ORIGIN":    "http://localhost:5173",
			"COMMIT_TOKEN_SECRET":       "legacy-secret",
		}
		value, ok := values[key]
		return value, ok
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.CommitTokenSecret != "legacy-secret" {
		t.Fatalf("CommitTokenSecret = %q, want legacy-secret", cfg.CommitTokenSecret)
	}
}

func TestLoadFromEnvRejectsInvalidTrustedProxyCIDRs(t *testing.T) {
	t.Parallel()

	_, err := LoadFromEnv(func(key string) (string, bool) {
		values := map[string]string{
			"SELFHOST_API_DATABASE_URL":        "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
			"SELFHOST_API_RP_ID":               "localhost",
			"SELFHOST_API_RP_ORIGIN":           "http://localhost:5173",
			"SELFHOST_API_COMMIT_TOKEN_SECRET": "test-secret",
			"SELFHOST_API_TRUSTED_PROXY_CIDRS": "10.0.0.0/8,not-a-cidr",
		}
		value, ok := values[key]
		return value, ok
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want invalid trusted proxy error")
	}
	if !strings.Contains(err.Error(), "SELFHOST_API_TRUSTED_PROXY_CIDRS") {
		t.Fatalf("LoadFromEnv() error = %v, want SELFHOST_API_TRUSTED_PROXY_CIDRS mention", err)
	}
}

func TestLoadFromEnvRequiresDatabaseURL(t *testing.T) {
	t.Parallel()

	_, err := LoadFromEnv(func(string) (string, bool) {
		return "", false
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want required database url error")
	}
	if !strings.Contains(err.Error(), "SELFHOST_API_DATABASE_URL") {
		t.Fatalf("LoadFromEnv() error = %v, want SELFHOST_API_DATABASE_URL mention", err)
	}
}

func TestLoadFromEnvRejectsInvalidPoolBounds(t *testing.T) {
	t.Parallel()

	_, err := LoadFromEnv(func(key string) (string, bool) {
		values := map[string]string{
			"SELFHOST_API_DATABASE_URL": "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
			"SELFHOST_API_RP_ID":        "localhost",
			"SELFHOST_API_RP_ORIGIN":    "http://localhost:5173",
			"SELFHOST_API_DB_MAX_CONNS": "2",
			"SELFHOST_API_DB_MIN_CONNS": "4",
		}
		value, ok := values[key]
		return value, ok
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want invalid pool bounds error")
	}
}

func TestLoadFromEnvRequiresRPConfig(t *testing.T) {
	t.Parallel()

	_, err := LoadFromEnv(func(key string) (string, bool) {
		values := map[string]string{
			"SELFHOST_API_DATABASE_URL": "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
		}
		value, ok := values[key]
		return value, ok
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want required rp config error")
	}
	if !strings.Contains(err.Error(), "SELFHOST_API_RP_ID") {
		t.Fatalf("LoadFromEnv() error = %v, want SELFHOST_API_RP_ID mention", err)
	}
}

func TestLoadFromEnvRejectsInvalidFilePolicy(t *testing.T) {
	t.Parallel()

	_, err := LoadFromEnv(func(key string) (string, bool) {
		values := map[string]string{
			"SELFHOST_API_DATABASE_URL":                   "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
			"SELFHOST_API_RP_ID":                          "localhost",
			"SELFHOST_API_RP_ORIGIN":                      "http://localhost:5173",
			"SELFHOST_API_FILE_MAX_BYTES":                 "2048",
			"SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES": "4096",
			"SELFHOST_API_FILE_CHUNK_SIZE_BYTES":          "512",
			"SELFHOST_API_FILE_MAX_CHUNKS":                "4",
		}
		value, ok := values[key]
		return value, ok
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want invalid file policy error")
	}
	if !strings.Contains(err.Error(), "SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES") {
		t.Fatalf("LoadFromEnv() error = %v, want SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES mention", err)
	}
}

func TestLoadFromEnvRejectsInvalidFileStorageBackend(t *testing.T) {
	t.Parallel()

	_, err := LoadFromEnv(func(key string) (string, bool) {
		values := map[string]string{
			"SELFHOST_API_DATABASE_URL":         "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
			"SELFHOST_API_RP_ID":                "localhost",
			"SELFHOST_API_RP_ORIGIN":            "http://localhost:5173",
			"SELFHOST_API_FILE_STORAGE_BACKEND": "unknown",
		}
		value, ok := values[key]
		return value, ok
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want invalid backend error")
	}
	if !strings.Contains(err.Error(), "SELFHOST_API_FILE_STORAGE_BACKEND") {
		t.Fatalf("LoadFromEnv() error = %v, want SELFHOST_API_FILE_STORAGE_BACKEND mention", err)
	}
}

func TestLoadFromEnvRejectsNonCanonicalRPOrigin(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		origin  string
		message string
	}{
		{
			name:    "path",
			origin:  "https://example.com/app",
			message: "must not include a path",
		},
		{
			name:    "query",
			origin:  "https://example.com?foo=bar",
			message: "must not include a query string",
		},
		{
			name:    "fragment",
			origin:  "https://example.com#section",
			message: "must not include a fragment",
		},
		{
			name:    "userinfo",
			origin:  "https://user@example.com",
			message: "must not include user info",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := LoadFromEnv(func(key string) (string, bool) {
				values := map[string]string{
					"SELFHOST_API_DATABASE_URL": "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
					"SELFHOST_API_RP_ID":        "localhost",
					"SELFHOST_API_RP_ORIGIN":    tt.origin,
				}
				value, ok := values[key]
				return value, ok
			})
			if err == nil {
				t.Fatalf("LoadFromEnv() error = nil, want %q", tt.message)
			}
			if !strings.Contains(err.Error(), tt.message) {
				t.Fatalf("LoadFromEnv() error = %v, want %q", err, tt.message)
			}
		})
	}
}
