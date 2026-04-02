ALTER TABLE channels ADD COLUMN IF NOT EXISTS file_ref JSONB;

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_check2;

ALTER TABLE channels ADD CONSTRAINT channels_delivered_payload_check
  CHECK (delivered_at IS NULL OR (cipher_bundle IS NOT NULL OR file_ref IS NOT NULL));
