package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/buildinfo"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/config"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/logging"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	logger := logging.New(cfg.LogLevel, buildinfo.ServiceName+"-migrate", cfg.AppEnv)

	db, err := store.Open(ctx, cfg.Database)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	result, err := store.RunMigrations(ctx, db)
	if err != nil {
		logger.Error("run migrations", "error", err)
		os.Exit(1)
	}

	logger.Info(
		"migrations complete",
		"applied_count", len(result.Applied),
		"skipped_count", len(result.Skipped),
	)

	for _, migration := range result.Applied {
		logger.Info(
			"applied migration",
			"version", migration.Version,
			"name", migration.Name,
			"checksum", migration.Checksum,
		)
	}

	if len(result.Applied) == 0 {
		fmt.Println("No pending migrations.")
	}
}
