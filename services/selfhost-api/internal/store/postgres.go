package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/config"
	"github.com/yclgkd/ZeroLink/services/selfhost-api/internal/store/filestore"
)

type MultipartCleaner interface {
	DeleteUpload(context.Context, filestore.MultipartFileRef) error
}

type Database struct {
	pool             *pgxpool.Pool
	healthTimeout    time.Duration
	multipartCleaner MultipartCleaner
}

func Open(ctx context.Context, cfg config.DatabaseConfig) (*Database, error) {
	poolConfig, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	poolConfig.MaxConns = cfg.MaxConns
	poolConfig.MinConns = cfg.MinConns
	poolConfig.MaxConnLifetime = 30 * time.Minute
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	poolConfig.HealthCheckPeriod = 30 * time.Second
	poolConfig.ConnConfig.ConnectTimeout = cfg.ConnectTimeout

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}

	db := &Database{
		pool:          pool,
		healthTimeout: cfg.HealthTimeout,
	}

	if err := db.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	return db, nil
}

func (d *Database) Pool() *pgxpool.Pool {
	return d.pool
}

func (d *Database) SetMultipartCleaner(cleaner MultipartCleaner) {
	d.multipartCleaner = cleaner
}

func (d *Database) Ping(ctx context.Context) error {
	pingCtx := ctx
	if d.healthTimeout > 0 {
		var cancel context.CancelFunc
		pingCtx, cancel = context.WithTimeout(ctx, d.healthTimeout)
		defer cancel()
	}

	if err := d.pool.Ping(pingCtx); err != nil {
		return fmt.Errorf("ping postgres pool: %w", err)
	}

	return nil
}

func (d *Database) Close() {
	if d.pool != nil {
		d.pool.Close()
	}
}
