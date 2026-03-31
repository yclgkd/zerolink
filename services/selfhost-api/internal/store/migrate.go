package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	embedmigrations "github.com/yclgkd/ZeroLink/services/selfhost-api/migrations"
)

const migrationTableName = "schema_migrations"

type MigrationRecord struct {
	Version   string
	Name      string
	Checksum  string
	AppliedAt time.Time
}

type MigrationRunResult struct {
	Applied []MigrationRecord
	Skipped []MigrationRecord
}

type migrationFile struct {
	Version string
	Name    string
	Path    string
	SQL     string
}

func RunMigrations(ctx context.Context, db *Database) (MigrationRunResult, error) {
	if err := ensureMigrationTable(ctx, db.pool); err != nil {
		return MigrationRunResult{}, err
	}

	files, err := loadMigrationFiles()
	if err != nil {
		return MigrationRunResult{}, err
	}

	appliedMap, err := loadAppliedMigrations(ctx, db.pool)
	if err != nil {
		return MigrationRunResult{}, err
	}

	result := MigrationRunResult{
		Applied: make([]MigrationRecord, 0),
		Skipped: make([]MigrationRecord, 0),
	}

	for _, migration := range files {
		checksum := checksumForSQL(migration.SQL)
		if existing, ok := appliedMap[migration.Version]; ok {
			if existing.Checksum != checksum {
				return MigrationRunResult{}, fmt.Errorf(
					"migration %s checksum mismatch: applied=%s embedded=%s",
					migration.Version,
					existing.Checksum,
					checksum,
				)
			}
			result.Skipped = append(result.Skipped, existing)
			continue
		}

		record, err := applyMigration(ctx, db.pool, migration, checksum)
		if err != nil {
			return MigrationRunResult{}, err
		}
		result.Applied = append(result.Applied, record)
	}

	return result, nil
}

func loadMigrationFiles() ([]migrationFile, error) {
	entries, err := fs.ReadDir(embedmigrations.Files, ".")
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}

	files := make([]migrationFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}

		version, name, ok := parseMigrationFilename(entry.Name())
		if !ok {
			return nil, fmt.Errorf("invalid migration filename %q", entry.Name())
		}

		contents, err := fs.ReadFile(embedmigrations.Files, entry.Name())
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}

		files = append(files, migrationFile{
			Version: version,
			Name:    name,
			Path:    entry.Name(),
			SQL:     string(contents),
		})
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].Version < files[j].Version
	})

	return files, nil
}

func parseMigrationFilename(filename string) (version string, name string, ok bool) {
	if !strings.HasSuffix(filename, ".sql") {
		return "", "", false
	}

	base := strings.TrimSuffix(filename, ".sql")
	parts := strings.SplitN(base, "_", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}

	return parts[0], parts[1], true
}

func ensureMigrationTable(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, fmt.Sprintf(`
CREATE TABLE IF NOT EXISTS %s (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`, migrationTableName)); err != nil {
		return fmt.Errorf("ensure schema_migrations table: %w", err)
	}
	return nil
}

func loadAppliedMigrations(ctx context.Context, pool *pgxpool.Pool) (map[string]MigrationRecord, error) {
	rows, err := pool.Query(ctx, fmt.Sprintf(`
SELECT version, name, checksum, applied_at
FROM %s
ORDER BY version ASC`, migrationTableName))
	if err != nil {
		return nil, fmt.Errorf("query applied migrations: %w", err)
	}
	defer rows.Close()

	result := make(map[string]MigrationRecord)
	for rows.Next() {
		var record MigrationRecord
		if err := rows.Scan(&record.Version, &record.Name, &record.Checksum, &record.AppliedAt); err != nil {
			return nil, fmt.Errorf("scan applied migration: %w", err)
		}
		result[record.Version] = record
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate applied migrations: %w", err)
	}

	return result, nil
}

func applyMigration(ctx context.Context, pool *pgxpool.Pool, migration migrationFile, checksum string) (MigrationRecord, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return MigrationRecord{}, fmt.Errorf("begin migration %s: %w", migration.Version, err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, migration.SQL); err != nil {
		return MigrationRecord{}, fmt.Errorf("execute migration %s (%s): %w", migration.Version, migration.Path, err)
	}

	var record MigrationRecord
	record.Version = migration.Version
	record.Name = migration.Name
	record.Checksum = checksum

	if err := tx.QueryRow(
		ctx,
		fmt.Sprintf(`
INSERT INTO %s (version, name, checksum)
VALUES ($1, $2, $3)
RETURNING applied_at`, migrationTableName),
		record.Version,
		record.Name,
		record.Checksum,
	).Scan(&record.AppliedAt); err != nil {
		return MigrationRecord{}, fmt.Errorf("record migration %s: %w", migration.Version, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return MigrationRecord{}, fmt.Errorf("commit migration %s: %w", migration.Version, err)
	}

	return record, nil
}

func checksumForSQL(sql string) string {
	sum := sha256.Sum256([]byte(sql))
	return hex.EncodeToString(sum[:])
}
