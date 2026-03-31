package logging

import (
	"log/slog"
	"os"
)

func New(level slog.Level, serviceName, appEnv string) *slog.Logger {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	})

	return slog.New(handler).With(
		"service", serviceName,
		"app_env", appEnv,
	)
}
