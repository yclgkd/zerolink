package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/app"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/buildinfo"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/config"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/logging"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	logger := logging.New(cfg.LogLevel, buildinfo.ServiceName, cfg.AppEnv)
	runtime, err := app.New(ctx, cfg, logger)
	if err != nil {
		logger.Error("bootstrap application", "error", err)
		os.Exit(1)
	}
	defer runtime.Close()

	logger.Info(
		"starting self-hosted api",
		"version", buildinfo.Version,
		"bind_addr", cfg.HTTP.BindAddr,
	)

	if err := runtime.Run(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("serve http", "error", err)
		os.Exit(1)
	}
}
