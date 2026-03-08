# Verified Release & Build Integrity Verification

ZeroLink publishes a **signed build manifest** with every release, and the production frontend now
uses that manifest during bootstrap before the React app loads. This lets the browser detect
tampering in the published runtime assets before the user can interact with sensitive UI.

## What is verified

- **Ed25519 signature** — `manifest.sig` is a cryptographic signature over `manifest.json` using the ZeroLink signing key.
- **Runtime file hashes** — `manifest.json` lists SHA-256 hashes for the publicly fetchable runtime files in the release build, including `index.html` and hashed assets.
- **Manifest hash** — `manifest-hash.txt` contains the SHA-256 of `manifest.json` itself; this is displayed in the app's **Verified Release** card as a public fingerprint, not as the trust anchor.

Pages control files such as `_headers` and `_redirects` are intentionally excluded from the signed
runtime manifest because they are deployment metadata, not browser-fetched release assets.

## What the browser does during bootstrap

In production builds, ZeroLink starts with a small bootstrap entry instead of loading the React app
immediately. That bootstrap entry:

1. Fetches `manifest.json` and `manifest.sig`
2. Verifies the Ed25519 signature using the embedded public key
3. Re-hashes the signed same-origin runtime assets
4. Loads the React app only if every check passes

If verification fails or cannot be completed, ZeroLink shows a blocking verification screen and
does not load the normal app UI.

## Artifacts per release

| File | Description |
|------|-------------|
| `dist/manifest.json` | Signed build manifest with file hashes |
| `dist/manifest-hash.txt` | SHA-256 of `manifest.json` |
| `dist/manifest.sig` | Ed25519 signature over `manifest.json` |
| `keys/manifest-signing.pub` | Public key for verification (committed to this repo) |

All dist artifacts are uploaded as `frontend-dist` in GitHub Actions release runs.

## Browser trust surface

When bootstrap verification succeeds, the shell renders a `Verified Release` card with:

- App version
- Build date
- Commit
- Manifest hash
- Verified file count
- Publisher key fingerprint

## Quick verification (automated)

After downloading a release build into `packages/frontend/dist/`:

```bash
pnpm manifest:verify
```

This will:
1. Read `manifest.json`, `manifest.sig`, and `keys/manifest-signing.pub`
2. Verify the Ed25519 signature
3. Re-hash every signed runtime file and compare against `manifest.json`
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

Compare the output against the fingerprint shown in the app's `Verified Release` card or the
fingerprint listed in `keys/manifest-signing.pub`.

## Key rotation

If the signing key is rotated, a new public key will be committed to `keys/manifest-signing.pub` and announced in the release notes. Old signatures remain valid for old releases.

## Reporting issues

If verification fails for a published release, please open a security issue at <https://github.com/yclgkd/ZeroLink/security>.
