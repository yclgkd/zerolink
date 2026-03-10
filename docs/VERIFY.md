# Verified Release & Build Integrity Verification

ZeroLink publishes a **signed build manifest** with every release, and official signed frontend
builds now use that manifest during bootstrap before the React app loads. This lets the browser
detect tampering in the published runtime assets before the user can interact with sensitive UI.

## What is verified

- **Ed25519 signature** — `manifest.sig` is a cryptographic signature over `manifest.json` using the ZeroLink signing key.
- **Signed entry binding** — `manifest.json` records the expected bootstrap entry bundle path in `entryAssetPath`, and the browser refuses to trust a release if the currently executing entry asset does not match it.
- **Runtime file hashes** — `manifest.json` lists SHA-256 hashes for the stable runtime build outputs under `dist/assets/`, such as hashed JS, CSS, fonts, and other immutable asset files.
- **Manifest hash** — `manifest-hash.txt` contains the SHA-256 of `manifest.json` itself; this is displayed in the app's **Verified Release** card as a public fingerprint, not as the trust anchor.

Pages control files such as `_headers` and `_redirects` are intentionally excluded from the signed
runtime manifest because they are deployment metadata, not browser-fetched release assets. Root
documents such as `index.html`, `robots.txt`, icons, and other non-asset files are also excluded.
The SPA entry document `index.html` in particular is left unsigned because edge platforms can
inject request-specific HTML into the bootstrap shell, which makes byte-for-byte signing of that
document unstable even when the underlying deployment is healthy.

## What the browser does during bootstrap

When a deployment is built with `VITE_RELEASE_VERIFICATION_REQUIRED=true`, ZeroLink starts with a
small bootstrap entry instead of loading the React app immediately. That bootstrap entry:

1. Fetches `manifest.json` and `manifest.sig`
2. Verifies the Ed25519 signature using the embedded public key
3. Confirms the currently executing bootstrap entry bundle matches `manifest.entryAssetPath`
4. Re-hashes the signed same-origin runtime assets
5. Loads the React app only if every check passes

If verification fails or cannot be completed, ZeroLink shows a blocking verification screen and
does not load the normal app UI. If the entry bundle does not match the signed manifest, ZeroLink
will attempt one controlled page reload before failing closed, which helps recover from stale entry
HTML or stale entry-bundle caches without looping forever.

Unsigned environments such as a plain `pnpm build`, `vite preview`, or a manual static upload
without signed release artifacts remain runnable, but they are treated as unverified boots and do
not show the `Verified Release` card.

## Artifacts per release

| File | Description |
|------|-------------|
| `dist/manifest.json` | Signed build manifest with `entryAssetPath` plus file hashes |
| `dist/manifest-hash.txt` | SHA-256 of `manifest.json` |
| `dist/manifest.sig` | Ed25519 signature over `manifest.json` |
| `keys/manifest-signing.pub` | Public key for verification (committed to this repo) |

All dist artifacts are uploaded as `frontend-dist` in GitHub Actions release runs. That workflow
also enables bootstrap verification by building the frontend with
`VITE_RELEASE_VERIFICATION_REQUIRED=true`.

## Browser trust surface

When bootstrap verification succeeds, the shell renders a `Verified Release` card with:

- App version
- Build date
- Commit
- Manifest hash
- Verified file count
- Publisher key fingerprint

Cloudflare Pages serves SPA entry requests with `Cache-Control: no-store` so the HTML/bootstrap
shell is never reused across deployments, while hashed `/assets/*` files remain immutable. The
signed manifest is intentionally limited to `dist/assets/*` runtime build outputs; the HTML
document itself is not hashed, but the bootstrap entry asset it launches must still match the
signed manifest.

## Quick verification (automated)

After downloading a release build into `packages/frontend/dist/`:

```bash
pnpm manifest:verify
```

This will:
1. Read `manifest.json`, `manifest.sig`, and `keys/manifest-signing.pub`
2. Verify the Ed25519 signature
3. Confirm `index.html` boots the same entry asset recorded in `manifest.entryAssetPath`
4. Re-hash every signed runtime file and compare against `manifest.json`
5. Print a pass/fail result for each file

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
# Check a signed runtime asset
sha256sum packages/frontend/dist/assets/index.js
# Compare with the value in manifest.json:
jq '.files["assets/index.js"]' packages/frontend/dist/manifest.json
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
