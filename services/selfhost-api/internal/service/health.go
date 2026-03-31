package service

import (
	"context"
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
) *Container {
	return &Container{
		Health:   &HealthService{checker: checker},
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
	status := Status{
		OK:        true,
		Status:    "ok",
		Timestamp: time.Now().UTC(),
		Checks: map[string]string{
			"database": "up",
		},
	}

	if err := s.checker.Ping(ctx); err != nil {
		status.OK = false
		status.Status = "degraded"
		status.Checks["database"] = "down"
	}

	return status
}
