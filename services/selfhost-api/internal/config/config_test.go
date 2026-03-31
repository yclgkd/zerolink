package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadFromEnvSuccess(t *testing.T) {
	t.Parallel()

	cfg, err := LoadFromEnv(func(key string) (string, bool) {
		values := map[string]string{
			"SELFHOST_API_DATABASE_URL":             "postgres://postgres:postgres@127.0.0.1:5432/zerolink?sslmode=disable",
			"SELFHOST_API_APP_ENV":                  "production",
			"SELFHOST_API_LOG_LEVEL":                "debug",
			"SELFHOST_API_BIND_ADDR":                ":9999",
			"SELFHOST_API_RP_ID":                    "localhost",
			"SELFHOST_API_RP_ORIGIN":                "http://localhost:5173",
			"SELFHOST_API_HTTP_SHUTDOWN_TIMEOUT":    "30s",
			"SELFHOST_API_DB_MAX_CONNS":             "12",
			"SELFHOST_API_DB_MIN_CONNS":             "2",
			"SELFHOST_API_DB_CONNECT_TIMEOUT":       "7s",
			"SELFHOST_API_DB_HEALTH_TIMEOUT":        "3s",
			"SELFHOST_API_HTTP_READ_TIMEOUT":        "11s",
			"SELFHOST_API_HTTP_READ_HEADER_TIMEOUT": "6s",
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
