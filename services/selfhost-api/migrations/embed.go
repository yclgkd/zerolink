package migrations

import "embed"

// Files contains the embedded SQL migrations for the self-hosted API service.
//
//go:embed *.sql
var Files embed.FS
