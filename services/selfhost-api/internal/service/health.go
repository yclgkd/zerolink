package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/realtime"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/webauthn"
)

type ReadinessChecker interface {
	Ping(ctx context.Context) error
}

type Container struct {
	Health   *HealthService
	Verifier webauthn.Verifier
	Realtime realtime.Publisher
	Protocol Protocol
}

type HealthService struct {
	checker ReadinessChecker
	logger  *slog.Logger
}

type Status struct {
	OK        bool              `json:"ok"`
	Status    string            `json:"status"`
	Timestamp time.Time         `json:"timestamp"`
	Checks    map[string]string `json:"checks,omitempty"`
}

func New(
	checker ReadinessChecker,
	verifier webauthn.Verifier,
	publisher realtime.Publisher,
	protocol Protocol,
	logger *slog.Logger,
) *Container {
	if logger == nil {
		logger = slog.Default()
	}

	return &Container{
		Health:   &HealthService{checker: checker, logger: logger},
		Verifier: verifier,
		Realtime: publisher,
		Protocol: protocol,
	}
}

func (s *HealthService) Live() Status {
	return Status{
		OK:        true,
		Status:    "ok",
		Timestamp: time.Now().UTC(),
		Checks: map[string]string{
			"http": "up",
		},
	}
}

func (s *HealthService) Ready(ctx context.Context) Status {
	logger := s.logger
	if logger == nil {
		logger = slog.Default()
	}

	status := Status{
		OK:        true,
		Status:    "ok",
		Timestamp: time.Now().UTC(),
		Checks: map[string]string{
			"database": "up",
		},
	}

	if err := s.checker.Ping(ctx); err != nil {
		logger.Error("readiness check failed", "check", "database", "error", err)
		status.OK = false
		status.Status = "degraded"
		status.Checks["database"] = "down"
	}

	return status
}
