CREATE TABLE IF NOT EXISTS channels (
  uuid TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'locked', 'delivered')),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ttl_ms BIGINT NOT NULL CHECK (ttl_ms > 0),
  security_profile TEXT NOT NULL CHECK (security_profile IN ('quick', 'secure')),
  admin_mode TEXT CHECK (admin_mode IN ('webauthn', 'password', 'softkey')),
  admin_credential JSONB,
  lock_key TEXT,
  receiver_pub_jwk JSONB,
  receiver_pub_fpr TEXT,
  locked_at TIMESTAMPTZ,
  cipher_bundle JSONB,
  update_delivery_proof JSONB,
  delivered_at TIMESTAMPTZ,
  version BIGINT NOT NULL CHECK (version >= 0),
  CHECK (
    (admin_mode IS NULL AND admin_credential IS NULL AND lock_key IS NULL)
    OR (admin_mode IS NOT NULL AND admin_credential IS NOT NULL AND lock_key IS NOT NULL)
  ),
  CHECK (
    (receiver_pub_jwk IS NULL AND receiver_pub_fpr IS NULL AND locked_at IS NULL)
    OR (receiver_pub_jwk IS NOT NULL AND receiver_pub_fpr IS NOT NULL AND locked_at IS NOT NULL)
  ),
  CHECK (delivered_at IS NULL OR cipher_bundle IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS channels_expires_at_idx ON channels (expires_at);

CREATE TABLE IF NOT EXISTS active_challenges (
  channel_id TEXT NOT NULL REFERENCES channels (uuid) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'lock', 'compound')),
  challenge_id TEXT,
  challenge_value TEXT,
  challenge_seed TEXT,
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  commit_token_mode TEXT,
  PRIMARY KEY (channel_id, kind),
  CHECK (
    kind <> 'create'
    OR (
      challenge_id IS NULL
      AND challenge_value IS NOT NULL
      AND challenge_seed IS NULL
      AND expires_at IS NULL
    )
  ),
  CHECK (
    kind <> 'lock'
    OR (
      challenge_id IS NOT NULL
      AND challenge_value IS NOT NULL
      AND challenge_seed IS NULL
      AND expires_at IS NOT NULL
    )
  ),
  CHECK (
    kind <> 'compound'
    OR (
      challenge_id IS NOT NULL
      AND challenge_value IS NULL
      AND challenge_seed IS NOT NULL
      AND expires_at IS NOT NULL
    )
  ),
  CHECK (
    commit_token_mode IS NULL
    OR commit_token_mode IN ('caller-cookie-v1')
  )
);

CREATE INDEX IF NOT EXISTS active_challenges_expires_at_idx
  ON active_challenges (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS used_nonces (
  channel_id TEXT NOT NULL REFERENCES channels (uuid) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (channel_id, nonce)
);

CREATE INDEX IF NOT EXISTS used_nonces_expires_at_idx ON used_nonces (expires_at);

CREATE TABLE IF NOT EXISTS terminal_tombstones (
  channel_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('deleted', 'expired')),
  finalized_at TIMESTAMPTZ NOT NULL
);
