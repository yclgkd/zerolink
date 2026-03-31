package store

import "testing"

func TestParseMigrationFilename(t *testing.T) {
	t.Parallel()

	version, name, ok := parseMigrationFilename("000001_service_bootstrap.sql")
	if !ok {
		t.Fatal("parseMigrationFilename() ok = false, want true")
	}
	if version != "000001" {
		t.Fatalf("version = %q, want 000001", version)
	}
	if name != "service_bootstrap" {
		t.Fatalf("name = %q, want service_bootstrap", name)
	}
}

func TestLoadMigrationFilesReturnsEmbeddedSQL(t *testing.T) {
	t.Parallel()

	files, err := loadMigrationFiles()
	if err != nil {
		t.Fatalf("loadMigrationFiles() error = %v", err)
	}
	if len(files) == 0 {
		t.Fatal("loadMigrationFiles() len = 0, want at least one migration")
	}
	if files[0].Version != "000001" {
		t.Fatalf("first migration version = %q, want 000001", files[0].Version)
	}
	if files[0].SQL == "" {
		t.Fatal("first migration SQL is empty")
	}
	if len(files) < 2 {
		t.Fatalf("loadMigrationFiles() len = %d, want at least 2 migrations", len(files))
	}
	if files[1].Version != "000002" {
		t.Fatalf("second migration version = %q, want 000002", files[1].Version)
	}
	if len(files) < 3 {
		t.Fatalf("loadMigrationFiles() len = %d, want at least 3 migrations", len(files))
	}
	if files[2].Version != "000003" {
		t.Fatalf("third migration version = %q, want 000003", files[2].Version)
	}
}
