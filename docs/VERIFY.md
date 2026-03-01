# Build Integrity Verification

ZeroLink publishes a **signed build manifest** with every release. This lets you independently verify that the frontend code running in your browser has not been tampered with since it was built.

## What is verified

- **Ed25519 signature** — `manifest.sig` is a cryptographic signature over `manifest.json` using the ZeroLink signing key.
- **File hashes** — `manifest.json` lists SHA-256 hashes for every file in the release build.
- **Manifest hash** — `manifest-hash.txt` contains the SHA-256 of `manifest.json` itself; this is also displayed in the app's **Build Manifest** card.

## Artifacts per release

| File | Description |
|------|-------------|
| `dist/manifest.json` | Signed build manifest with file hashes |
| `dist/manifest-hash.txt` | SHA-256 of `manifest.json` |
| `dist/manifest.sig` | Ed25519 signature over `manifest.json` |
| `keys/manifest-signing.pub` | Public key for verification (committed to this repo) |

All dist artifacts are uploaded as `frontend-dist` in GitHub Actions release runs.

## Quick verification (automated)

After downloading a release build into `packages/frontend/dist/`:

```bash
pnpm manifest:verify
```

This will:
1. Read `manifest.json`, `manifest.sig`, and `keys/manifest-signing.pub`
2. Verify the Ed25519 signature
3. Re-hash every file and compare against `manifest.json`
4. Print a pass/fail result for each file

## Manual verification

### 1. Verify the Ed25519 signature

```bash
# Decode the base64url signature to binary (adds required = padding)
SIG=$(cat packages/frontend/dist/manifest.sig | tr -d '\n' | \
  tr -- '-_' '+/' | \
  awk '{ l=length($0); pad=(4-l%4)%4; printf "%s%.*s\n", $0, pad, "====" }' | \
  base64 --decode)

# Verify using openssl
openssl pkeyutl \
  -verify \
  -pubin \
  -inkey keys/manifest-signing.pub \
  -sigfile <(printf '%s' "$SIG") \
  -in packages/frontend/dist/manifest.json
```

### 2. Verify a specific file hash

```bash
# Check index.html
sha256sum packages/frontend/dist/index.html
# Compare with the value in manifest.json:
jq '.files["index.html"]' packages/frontend/dist/manifest.json
```

### 3. Verify the manifest hash

```bash
sha256sum packages/frontend/dist/manifest.json
cat packages/frontend/dist/manifest-hash.txt
# Both should match
```

## Public key fingerprint

To confirm you are using the correct public key, compute its fingerprint:

```bash
openssl pkey -in keys/manifest-signing.pub -pubin -outform DER | sha256sum
```

Compare the output against the fingerprint listed in `keys/manifest-signing.pub`.

## Key rotation

If the signing key is rotated, a new public key will be committed to `keys/manifest-signing.pub` and announced in the release notes. Old signatures remain valid for old releases.

## Reporting issues

If verification fails for a published release, please open a security issue at <https://github.com/yclgkd/ZeroLink/security>.
