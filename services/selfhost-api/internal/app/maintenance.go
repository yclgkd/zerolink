package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
)

const (
	defaultMaintenanceInterval     = time.Hour
	defaultMultipartOrphanStaleAge = 15 * time.Minute
)

func (r *Runtime) runMaintenanceLoop(ctx context.Context) {
	ticker := time.NewTicker(defaultMaintenanceInterval)
	defer ticker.Stop()

	run := func() {
		if err := r.runMaintenanceOnce(ctx, time.Now().UTC()); err != nil {
			r.maintenanceLogger().Error("run self-host maintenance failed", "error", err)
		}
	}

	run()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func (r *Runtime) runMaintenanceOnce(ctx context.Context, now time.Time) error {
	summary, err := store.CleanupOrphanMultipartChunks(
		ctx,
		r.db,
		r.multipartStore,
		now,
		defaultMultipartOrphanStaleAge,
	)
	if err != nil {
		return fmt.Errorf("cleanup orphan multipart chunks: %w", err)
	}

	r.maintenanceLogger().Info(
		"self-host multipart maintenance complete",
		"scanned_objects", summary.ScannedObjects,
		"deleted_objects", summary.DeletedObjects,
		"kept_active_objects", summary.KeptActiveObjects,
		"skipped_fresh_objects", summary.SkippedFreshObjects,
		"skipped_malformed_objects", summary.SkippedMalformedObjects,
	)
	return nil
}

func (r *Runtime) maintenanceLogger() *slog.Logger {
	if r != nil && r.logger != nil {
		return r.logger
	}
	return slog.Default()
}
