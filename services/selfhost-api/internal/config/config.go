package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv   string
	LogLevel slog.Level
	HTTP     HTTPConfig
	Database DatabaseConfig
	File     FileConfig
	RP       RPConfig
}

type HTTPConfig struct {
	BindAddr          string
	ReadTimeout       time.Duration
	ReadHeaderTimeout time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
}

type DatabaseConfig struct {
	URL            string
	MaxConns       int32
	MinConns       int32
	ConnectTimeout time.Duration
	HealthTimeout  time.Duration
}

type FileConfig struct {
	MaxBytes                int64
	MultipartThresholdBytes int64
	ChunkSizeBytes          int64
	MaxChunks               int64
	MultipartSupported      bool
}

type RPConfig struct {
	ID     string
	Origin string
}

const (
	fileEnvelopeFixedBytes             = int64(8)
	fileHeaderMaxBytes                 = int64(16 * 1024)
	defaultFileMaxBytes                = int64(2_097_152) - fileEnvelopeFixedBytes - fileHeaderMaxBytes
	defaultFileMultipartThresholdBytes = defaultFileMaxBytes
	defaultFileChunkSizeBytes          = int64(262_144)
	defaultFileMaxChunks               = int64(8)
	maxInlineFileBytes                 = defaultFileMaxBytes
)

func Load() (Config, error) {
	return LoadFromEnv(os.LookupEnv)
}

func LoadFromEnv(lookup func(string) (string, bool)) (Config, error) {
	appEnv := envOrDefault(lookup, "SELFHOST_API_APP_ENV", "development")
	if err := validateAppEnv(appEnv); err != nil {
		return Config{}, err
	}

	logLevel, err := parseLogLevel(envOrDefault(lookup, "SELFHOST_API_LOG_LEVEL", "info"))
	if err != nil {
		return Config{}, err
	}

	dbURL, ok := lookup("SELFHOST_API_DATABASE_URL")
	if !ok || strings.TrimSpace(dbURL) == "" {
		return Config{}, fmt.Errorf("SELFHOST_API_DATABASE_URL is required")
	}

	httpCfg, err := loadHTTPConfig(lookup)
	if err != nil {
		return Config{}, err
	}

	dbCfg, err := loadDatabaseConfig(lookup, dbURL)
	if err != nil {
		return Config{}, err
	}

	fileCfg, err := loadFileConfig(lookup)
	if err != nil {
		return Config{}, err
	}

	rpCfg, err := loadRPConfig(lookup)
	if err != nil {
		return Config{}, err
	}

	return Config{
		AppEnv:   appEnv,
		LogLevel: logLevel,
		HTTP:     httpCfg,
		Database: dbCfg,
		File:     fileCfg,
		RP:       rpCfg,
	}, nil
}

func loadHTTPConfig(lookup func(string) (string, bool)) (HTTPConfig, error) {
	readTimeout, err := parseDurationEnv(lookup, "SELFHOST_API_HTTP_READ_TIMEOUT", 10*time.Second)
	if err != nil {
		return HTTPConfig{}, err
	}

	readHeaderTimeout, err := parseDurationEnv(lookup, "SELFHOST_API_HTTP_READ_HEADER_TIMEOUT", 5*time.Second)
	if err != nil {
		return HTTPConfig{}, err
	}

	writeTimeout, err := parseDurationEnv(lookup, "SELFHOST_API_HTTP_WRITE_TIMEOUT", 15*time.Second)
	if err != nil {
		return HTTPConfig{}, err
	}

	idleTimeout, err := parseDurationEnv(lookup, "SELFHOST_API_HTTP_IDLE_TIMEOUT", time.Minute)
	if err != nil {
		return HTTPConfig{}, err
	}

	shutdownTimeout, err := parseDurationEnv(lookup, "SELFHOST_API_HTTP_SHUTDOWN_TIMEOUT", 10*time.Second)
	if err != nil {
		return HTTPConfig{}, err
	}

	return HTTPConfig{
		BindAddr:          envOrDefault(lookup, "SELFHOST_API_BIND_ADDR", ":8788"),
		ReadTimeout:       readTimeout,
		ReadHeaderTimeout: readHeaderTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		ShutdownTimeout:   shutdownTimeout,
	}, nil
}

func loadDatabaseConfig(lookup func(string) (string, bool), url string) (DatabaseConfig, error) {
	maxConns, err := parseInt32Env(lookup, "SELFHOST_API_DB_MAX_CONNS", 8)
	if err != nil {
		return DatabaseConfig{}, err
	}

	minConns, err := parseInt32Env(lookup, "SELFHOST_API_DB_MIN_CONNS", 0)
	if err != nil {
		return DatabaseConfig{}, err
	}

	connectTimeout, err := parseDurationEnv(lookup, "SELFHOST_API_DB_CONNECT_TIMEOUT", 5*time.Second)
	if err != nil {
		return DatabaseConfig{}, err
	}

	healthTimeout, err := parseDurationEnv(lookup, "SELFHOST_API_DB_HEALTH_TIMEOUT", 2*time.Second)
	if err != nil {
		return DatabaseConfig{}, err
	}

	if minConns < 0 || maxConns <= 0 || minConns > maxConns {
		return DatabaseConfig{}, fmt.Errorf("invalid database pool bounds: min=%d max=%d", minConns, maxConns)
	}

	return DatabaseConfig{
		URL:            strings.TrimSpace(url),
		MaxConns:       maxConns,
		MinConns:       minConns,
		ConnectTimeout: connectTimeout,
		HealthTimeout:  healthTimeout,
	}, nil
}

func loadFileConfig(lookup func(string) (string, bool)) (FileConfig, error) {
	maxBytes, err := parseInt64Env(lookup, "SELFHOST_API_FILE_MAX_BYTES", defaultFileMaxBytes)
	if err != nil {
		return FileConfig{}, err
	}

	multipartThresholdBytes, err := parseInt64Env(
		lookup,
		"SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES",
		defaultFileMultipartThresholdBytes,
	)
	if err != nil {
		return FileConfig{}, err
	}

	chunkSizeBytes, err := parseInt64Env(
		lookup,
		"SELFHOST_API_FILE_CHUNK_SIZE_BYTES",
		defaultFileChunkSizeBytes,
	)
	if err != nil {
		return FileConfig{}, err
	}

	maxChunks, err := parseInt64Env(lookup, "SELFHOST_API_FILE_MAX_CHUNKS", defaultFileMaxChunks)
	if err != nil {
		return FileConfig{}, err
	}

	if maxBytes <= 0 || maxBytes > maxInlineFileBytes {
		return FileConfig{}, fmt.Errorf(
			"SELFHOST_API_FILE_MAX_BYTES must be between 1 and %d",
			maxInlineFileBytes,
		)
	}
	if multipartThresholdBytes <= 0 || multipartThresholdBytes > maxBytes {
		return FileConfig{}, fmt.Errorf(
			"SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES must be between 1 and SELFHOST_API_FILE_MAX_BYTES",
		)
	}
	if chunkSizeBytes <= 0 {
		return FileConfig{}, fmt.Errorf("SELFHOST_API_FILE_CHUNK_SIZE_BYTES must be positive")
	}
	if maxChunks <= 0 {
		return FileConfig{}, fmt.Errorf("SELFHOST_API_FILE_MAX_CHUNKS must be positive")
	}
	if chunkSizeBytes*maxChunks < maxBytes {
		return FileConfig{}, fmt.Errorf(
			"SELFHOST_API_FILE_CHUNK_SIZE_BYTES * SELFHOST_API_FILE_MAX_CHUNKS must cover SELFHOST_API_FILE_MAX_BYTES",
		)
	}

	multipartSupported, err := parseBoolEnv(lookup, "SELFHOST_API_FILE_MULTIPART_SUPPORTED", false)
	if err != nil {
		return FileConfig{}, err
	}

	return FileConfig{
		MaxBytes:                maxBytes,
		MultipartThresholdBytes: multipartThresholdBytes,
		ChunkSizeBytes:          chunkSizeBytes,
		MaxChunks:               maxChunks,
		MultipartSupported:      multipartSupported,
	}, nil
}

func loadRPConfig(lookup func(string) (string, bool)) (RPConfig, error) {
	rpID, ok := lookup("SELFHOST_API_RP_ID")
	if !ok || strings.TrimSpace(rpID) == "" {
		return RPConfig{}, fmt.Errorf("SELFHOST_API_RP_ID is required")
	}

	rpOrigin, ok := lookup("SELFHOST_API_RP_ORIGIN")
	if !ok || strings.TrimSpace(rpOrigin) == "" {
		return RPConfig{}, fmt.Errorf("SELFHOST_API_RP_ORIGIN is required")
	}

	normalizedOrigin, err := normalizeRPOrigin(rpOrigin)
	if err != nil {
		return RPConfig{}, err
	}

	return RPConfig{
		ID:     strings.TrimSpace(rpID),
		Origin: normalizedOrigin,
	}, nil
}

func normalizeRPOrigin(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", fmt.Errorf("SELFHOST_API_RP_ORIGIN must be a valid URL: %w", err)
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", fmt.Errorf("SELFHOST_API_RP_ORIGIN must start with http:// or https://")
	}
	if parsed.Host == "" || parsed.Hostname() == "" {
		return "", fmt.Errorf("SELFHOST_API_RP_ORIGIN must include a host")
	}
	if parsed.User != nil {
		return "", fmt.Errorf("SELFHOST_API_RP_ORIGIN must not include user info")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", fmt.Errorf("SELFHOST_API_RP_ORIGIN must not include a path")
	}
	if parsed.RawQuery != "" || parsed.ForceQuery {
		return "", fmt.Errorf("SELFHOST_API_RP_ORIGIN must not include a query string")
	}
	if parsed.Fragment != "" {
		return "", fmt.Errorf("SELFHOST_API_RP_ORIGIN must not include a fragment")
	}

	host := strings.ToLower(parsed.Hostname())
	port := parsed.Port()
	if port == "" || isDefaultOriginPort(scheme, port) {
		if strings.Contains(host, ":") {
			host = "[" + host + "]"
		}
		return scheme + "://" + host, nil
	}

	return scheme + "://" + net.JoinHostPort(host, port), nil
}

func isDefaultOriginPort(scheme, port string) bool {
	return (scheme == "http" && port == "80") || (scheme == "https" && port == "443")
}

func validateAppEnv(value string) error {
	switch value {
	case "development", "test", "production":
		return nil
	default:
		return fmt.Errorf("SELFHOST_API_APP_ENV must be one of development, test, production")
	}
}

func parseLogLevel(value string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("SELFHOST_API_LOG_LEVEL must be one of debug, info, warn, error")
	}
}

func parseDurationEnv(lookup func(string) (string, bool), key string, fallback time.Duration) (time.Duration, error) {
	value := envOrDefault(lookup, key, fallback.String())
	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid duration: %w", key, err)
	}
	return duration, nil
}

func parseInt32Env(lookup func(string) (string, bool), key string, fallback int32) (int32, error) {
	value := envOrDefault(lookup, key, strconv.FormatInt(int64(fallback), 10))
	parsed, err := strconv.ParseInt(value, 10, 32)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid int32: %w", key, err)
	}
	return int32(parsed), nil
}

func parseInt64Env(lookup func(string) (string, bool), key string, fallback int64) (int64, error) {
	value := envOrDefault(lookup, key, strconv.FormatInt(fallback, 10))
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid int64: %w", key, err)
	}
	return parsed, nil
}

func parseBoolEnv(lookup func(string) (string, bool), key string, fallback bool) (bool, error) {
	fallbackStr := "false"
	if fallback {
		fallbackStr = "true"
	}
	value := envOrDefault(lookup, key, fallbackStr)
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be \"true\" or \"false\": %w", key, err)
	}
	return parsed, nil
}

func envOrDefault(lookup func(string) (string, bool), key, fallback string) string {
	if value, ok := lookup(key); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}
