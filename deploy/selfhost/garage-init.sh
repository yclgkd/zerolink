#!/bin/sh
# Bootstrap a single-node Garage instance: layout, API key, bucket.
# Idempotent — safe to re-run on an already-initialised cluster.
set -e

command -v curl > /dev/null 2>&1 && command -v jq > /dev/null 2>&1 \
  || apk add --no-cache curl jq > /dev/null 2>&1

ADMIN_URL="http://garage:3903"
AUTH="Authorization: Bearer ${GARAGE_ADMIN_TOKEN}"
BUCKET="${SELFHOST_API_S3_BUCKET:-zerolink-files}"
KEY_NAME="zerolink"

# ── helpers ──────────────────────────────────────────────────────
api() { curl -sf -H "${AUTH}" -H "Content-Type: application/json" "$@"; }

wait_ready() {
  echo "Waiting for Garage admin API..."
  ATTEMPTS=0
  MAX_ATTEMPTS=60
  until api "${ADMIN_URL}/v2/GetClusterStatus" > /dev/null 2>&1; do
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "${ATTEMPTS}" -ge "${MAX_ATTEMPTS}" ]; then
      echo "ERROR: Garage did not become ready within ${MAX_ATTEMPTS}s."
      exit 1
    fi
    sleep 1
  done
  echo "Garage is ready."
}

# ── layout ───────────────────────────────────────────────────────
ensure_layout() {
  LAYOUT=$(api "${ADMIN_URL}/v2/GetClusterLayout")
  NODE_COUNT=$(echo "${LAYOUT}" | jq '.roles | length')

  if [ "${NODE_COUNT}" -gt 0 ]; then
    echo "Layout already applied (${NODE_COUNT} node(s)), skipping."
    return
  fi

  NODE_ID=$(api "${ADMIN_URL}/v2/GetClusterStatus" | jq -r '.nodes[0].id')
  echo "Assigning layout for node ${NODE_ID}..."

  BODY=$(printf '{"roles":[{"id":"%s","zone":"dc1","capacity":1073741824,"tags":[]}]}' "${NODE_ID}")
  api -X POST "${ADMIN_URL}/v2/UpdateClusterLayout" -d "${BODY}" > /dev/null

  VERSION=$(api "${ADMIN_URL}/v2/GetClusterLayout" | jq '.version + 1')
  api -X POST "${ADMIN_URL}/v2/ApplyClusterLayout" \
    -d "{\"version\":${VERSION}}" > /dev/null

  echo "Layout applied."
}

# ── API key ──────────────────────────────────────────────────────
ensure_key() {
  if [ -z "${GARAGE_S3_ACCESS_KEY_ID}" ] || [ -z "${GARAGE_S3_SECRET_ACCESS_KEY}" ]; then
    echo "ERROR: GARAGE_S3_ACCESS_KEY_ID and GARAGE_S3_SECRET_ACCESS_KEY must be set."
    exit 1
  fi

  EXISTING=$(api "${ADMIN_URL}/v2/ListKeys" | jq -r ".[] | select(.id == \"${GARAGE_S3_ACCESS_KEY_ID}\") | .id")
  if [ -n "${EXISTING}" ]; then
    echo "API key already exists, skipping."
    return
  fi

  echo "Importing API key..."
  api -X POST "${ADMIN_URL}/v2/ImportKey" \
    -d "{\"name\":\"${KEY_NAME}\",\"accessKeyId\":\"${GARAGE_S3_ACCESS_KEY_ID}\",\"secretAccessKey\":\"${GARAGE_S3_SECRET_ACCESS_KEY}\"}" > /dev/null
  echo "API key imported."
}

# ── bucket ───────────────────────────────────────────────────────
ensure_bucket() {
  EXISTING=$(api "${ADMIN_URL}/v2/ListBuckets" | jq -r ".[] | select(.globalAliases[]? == \"${BUCKET}\") | .id")
  if [ -n "${EXISTING}" ]; then
    echo "Bucket '${BUCKET}' already exists (${EXISTING}), ensuring permissions..."
    BUCKET_ID="${EXISTING}"
  else
    echo "Creating bucket '${BUCKET}'..."
    BUCKET_ID=$(api -X POST "${ADMIN_URL}/v2/CreateBucket" \
      -d "{\"globalAlias\":\"${BUCKET}\"}" | jq -r '.id')
    echo "Bucket created (${BUCKET_ID})."
  fi

  api -X POST "${ADMIN_URL}/v2/AllowBucketKey" \
    -d "{\"bucketId\":\"${BUCKET_ID}\",\"accessKeyId\":\"${GARAGE_S3_ACCESS_KEY_ID}\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":true}}" > /dev/null
  echo "Bucket permissions granted."
}

# ── main ─────────────────────────────────────────────────────────
wait_ready
ensure_layout
ensure_key
ensure_bucket
echo "Garage bootstrap complete."
