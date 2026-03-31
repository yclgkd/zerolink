-- name: AcquireChannelAdvisoryLock :exec
SELECT pg_advisory_xact_lock($1);

-- name: GetChannel :one
SELECT
  uuid,
  state,
  created_at,
  expires_at,
  ttl_ms,
  security_profile,
  admin_mode,
  admin_credential,
  lock_key,
  receiver_pub_jwk,
  receiver_pub_fpr,
  locked_at,
  cipher_bundle,
  update_delivery_proof,
  delivered_at,
  version
FROM channels
WHERE uuid = $1
LIMIT 1;

-- name: UpsertChannel :one
INSERT INTO channels (
  uuid,
  state,
  created_at,
  expires_at,
  ttl_ms,
  security_profile,
  admin_mode,
  admin_credential,
  lock_key,
  receiver_pub_jwk,
  receiver_pub_fpr,
  locked_at,
  cipher_bundle,
  update_delivery_proof,
  delivered_at,
  version
) VALUES (
  $1,
  $2,
  $3,
  $4,
  $5,
  $6,
  $7,
  $8,
  $9,
  $10,
  $11,
  $12,
  $13,
  $14,
  $15,
  $16
)
ON CONFLICT (uuid) DO UPDATE SET
  state = EXCLUDED.state,
  created_at = EXCLUDED.created_at,
  expires_at = EXCLUDED.expires_at,
  ttl_ms = EXCLUDED.ttl_ms,
  security_profile = EXCLUDED.security_profile,
  admin_mode = EXCLUDED.admin_mode,
  admin_credential = EXCLUDED.admin_credential,
  lock_key = EXCLUDED.lock_key,
  receiver_pub_jwk = EXCLUDED.receiver_pub_jwk,
  receiver_pub_fpr = EXCLUDED.receiver_pub_fpr,
  locked_at = EXCLUDED.locked_at,
  cipher_bundle = EXCLUDED.cipher_bundle,
  update_delivery_proof = EXCLUDED.update_delivery_proof,
  delivered_at = EXCLUDED.delivered_at,
  version = EXCLUDED.version
RETURNING
  uuid,
  state,
  created_at,
  expires_at,
  ttl_ms,
  security_profile,
  admin_mode,
  admin_credential,
  lock_key,
  receiver_pub_jwk,
  receiver_pub_fpr,
  locked_at,
  cipher_bundle,
  update_delivery_proof,
  delivered_at,
  version;

-- name: DeleteChannel :exec
DELETE FROM channels
WHERE uuid = $1;

-- name: GetActiveChallenge :one
SELECT
  channel_id,
  kind,
  challenge_id,
  challenge_value,
  challenge_seed,
  issued_at,
  expires_at,
  consumed_at,
  commit_token_mode
FROM active_challenges
WHERE channel_id = $1
  AND kind = $2
LIMIT 1;

-- name: UpsertActiveChallenge :one
INSERT INTO active_challenges (
  channel_id,
  kind,
  challenge_id,
  challenge_value,
  challenge_seed,
  issued_at,
  expires_at,
  consumed_at,
  commit_token_mode
) VALUES (
  $1,
  $2,
  $3,
  $4,
  $5,
  $6,
  $7,
  $8,
  $9
)
ON CONFLICT (channel_id, kind) DO UPDATE SET
  challenge_id = EXCLUDED.challenge_id,
  challenge_value = EXCLUDED.challenge_value,
  challenge_seed = EXCLUDED.challenge_seed,
  issued_at = EXCLUDED.issued_at,
  expires_at = EXCLUDED.expires_at,
  consumed_at = EXCLUDED.consumed_at,
  commit_token_mode = EXCLUDED.commit_token_mode
RETURNING
  channel_id,
  kind,
  challenge_id,
  challenge_value,
  challenge_seed,
  issued_at,
  expires_at,
  consumed_at,
  commit_token_mode;

-- name: MarkChallengeConsumed :one
UPDATE active_challenges
SET consumed_at = $3
WHERE channel_id = $1
  AND kind = $2
RETURNING
  channel_id,
  kind,
  challenge_id,
  challenge_value,
  challenge_seed,
  issued_at,
  expires_at,
  consumed_at,
  commit_token_mode;

-- name: DeleteActiveChallenge :exec
DELETE FROM active_challenges
WHERE channel_id = $1
  AND kind = $2;

-- name: DeleteExpiredChallenges :execrows
DELETE FROM active_challenges
WHERE expires_at IS NOT NULL
  AND expires_at <= $1;

-- name: FinalizeExpiredChannels :execrows
WITH expired_channels AS (
  DELETE FROM channels
  WHERE expires_at <= $1
  RETURNING uuid
)
INSERT INTO terminal_tombstones (
  channel_id,
  reason,
  finalized_at
)
SELECT
  uuid,
  'expired',
  $1
FROM expired_channels
ON CONFLICT (channel_id) DO UPDATE SET
  reason = EXCLUDED.reason,
  finalized_at = EXCLUDED.finalized_at;

-- name: GetUsedNonce :one
SELECT
  channel_id,
  nonce,
  used_at,
  expires_at
FROM used_nonces
WHERE channel_id = $1
  AND nonce = $2
LIMIT 1;

-- name: UpsertUsedNonce :one
INSERT INTO used_nonces (
  channel_id,
  nonce,
  used_at,
  expires_at
) VALUES (
  $1,
  $2,
  $3,
  $4
)
ON CONFLICT (channel_id, nonce) DO UPDATE SET
  used_at = EXCLUDED.used_at,
  expires_at = EXCLUDED.expires_at
RETURNING
  channel_id,
  nonce,
  used_at,
  expires_at;

-- name: DeleteExpiredUsedNonces :execrows
DELETE FROM used_nonces
WHERE expires_at <= $1;

-- name: GetTerminalTombstone :one
SELECT
  channel_id,
  reason,
  finalized_at
FROM terminal_tombstones
WHERE channel_id = $1
LIMIT 1;

-- name: UpsertTerminalTombstone :one
INSERT INTO terminal_tombstones (
  channel_id,
  reason,
  finalized_at
) VALUES (
  $1,
  $2,
  $3
)
ON CONFLICT (channel_id) DO UPDATE SET
  reason = EXCLUDED.reason,
  finalized_at = EXCLUDED.finalized_at
RETURNING
  channel_id,
  reason,
  finalized_at;
