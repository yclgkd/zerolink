CREATE TABLE IF NOT EXISTS service_metadata (
  metadata_key TEXT PRIMARY KEY,
  metadata_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO service_metadata (metadata_key, metadata_value)
VALUES ('service_name', 'zerolink-selfhost-api')
ON CONFLICT (metadata_key) DO NOTHING;
