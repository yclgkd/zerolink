package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/config"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/httpapi"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/service"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

type Runtime struct {
	server          *http.Server
	shutdownTimeout time.Duration
	db              *store.Database
	realtime        realtime.Publisher
	logger          *slog.Logger
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*Runtime, error) {
	db, err := store.Open(ctx, cfg.Database)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	realtimeHub := realtime.NewHub(logger)
	verifier := webauthn.NewVerifier()
	protocolService := service.NewProtocolService(
		db,
		service.ProtocolConfig{
			RPID:      cfg.RP.ID,
			RPOrigin:  cfg.RP.Origin,
			Verifier:  verifier,
			Publisher: realtimeHub,
		},
	)
	services := service.New(
		db,
		verifier,
		realtimeHub,
		protocolService,
		logger,
	)

	handler := httpapi.NewRouter(httpapi.Dependencies{
		Logger:        logger,
		Services:      services,
		AllowedOrigin: cfg.RP.Origin,
		Realtime:      realtimeHub,
	})

	server := &http.Server{
		Addr:              cfg.HTTP.BindAddr,
		Handler:           handler,
		ReadTimeout:       cfg.HTTP.ReadTimeout,
		ReadHeaderTimeout: cfg.HTTP.ReadHeaderTimeout,
		WriteTimeout:      cfg.HTTP.WriteTimeout,
		IdleTimeout:       cfg.HTTP.IdleTimeout,
	}

	return &Runtime{
		server:          server,
		shutdownTimeout: cfg.HTTP.ShutdownTimeout,
		db:              db,
		realtime:        realtimeHub,
		logger:          logger,
	}, nil
}

func (r *Runtime) Run(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		errCh <- r.server.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), r.shutdownTimeout)
		defer cancel()
		return r.server.Shutdown(shutdownCtx)
	}
}

func (r *Runtime) Close() {
	logger := r.logger
	if logger == nil {
		logger = slog.Default()
	}

	if r.realtime != nil {
		if err := r.realtime.Close(); err != nil {
			logger.Error("close realtime publisher", "error", err)
		}
	}
	if r.db != nil {
		r.db.Close()
	}
}
