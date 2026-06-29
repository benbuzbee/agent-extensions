#!/usr/bin/env bash
set -euo pipefail

# One-time per-org installer for the htmldoc-review Worker (Deliverable 1: proxy + auth).
# No D1, no Durable Objects. Session storage is Workers KV with native per-key TTL.
#
# Order:
#   0) obtain GitHub App OAuth creds via the manifest flow (create-app.mjs)
#   1) create KV namespace SESSIONS, parse the 32-hex id, sed it into wrangler.toml
#   2) preflight build/config validation (dry-run)
#   3) first real deploy (creates the live Worker + KV binding; must exist before secret put)
#   4) push secrets via piped stdin (printf %s -> no trailing newline; each redeploys)
#   5) remind admin to confirm 'User-to-server token expiration' is ON
#
# Run from the app directory (apps/htmldoc-review) so wrangler.toml is in cwd.

cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# 0) GitHub App manifest flow -> client_id / client_secret (returned ONCE)
# ---------------------------------------------------------------------------
# create-app.mjs renders app-manifest.json (ORG substituted), serves the
# auto-submitting form, captures ?code=&state= on /manifest/callback, POSTs
# /app-manifests/{code}/conversions, and prints the creds to stdout.
echo "==> Creating the GitHub App via the manifest flow (browser will open)..."
APP_OUT="$(node create-app.mjs)"
echo "$APP_OUT"
GITHUB_CLIENT_ID="$(printf '%s\n' "$APP_OUT" | grep -E '^GITHUB_CLIENT_ID=' | head -n1 | cut -d= -f2-)"
GITHUB_CLIENT_SECRET="$(printf '%s\n' "$APP_OUT" | grep -E '^GITHUB_CLIENT_SECRET=' | head -n1 | cut -d= -f2-)"
[ -n "$GITHUB_CLIENT_ID" ] || { echo "ERROR: could not parse client_id from create-app.mjs"; exit 1; }
[ -n "$GITHUB_CLIENT_SECRET" ] || { echo "ERROR: could not parse client_secret from create-app.mjs"; exit 1; }

# Wire the (non-secret) client id into wrangler.toml [vars].
sed -i.bak "s|GITHUB_CLIENT_ID = \".*\"|GITHUB_CLIENT_ID = \"$GITHUB_CLIENT_ID\"|" wrangler.toml && rm -f wrangler.toml.bak

# ---------------------------------------------------------------------------
# 1) create KV namespace, parse the 32-hex id (stable wrangler does NOT auto-edit config)
# ---------------------------------------------------------------------------
echo "==> Creating KV namespace SESSIONS..."
CREATE_OUT="$(npx wrangler kv namespace create SESSIONS)"
echo "$CREATE_OUT"
KV_ID="$(printf '%s\n' "$CREATE_OUT" | grep -oE '[0-9a-f]{32}' | head -n1)"
[ -n "$KV_ID" ] || { echo "ERROR: could not parse KV namespace id"; exit 1; }
sed -i.bak "s/REPLACE_WITH_KV_NAMESPACE_ID/$KV_ID/" wrangler.toml && rm -f wrangler.toml.bak

# ---------------------------------------------------------------------------
# 2) preflight: bundle + config validation, no upload, no creds needed
# ---------------------------------------------------------------------------
echo "==> Preflight (dry-run) build/config check..."
npx wrangler deploy --dry-run --outdir dist

# ---------------------------------------------------------------------------
# 3) first real deploy: creates live Worker + KV binding (must exist before secret put)
# ---------------------------------------------------------------------------
echo "==> Deploying Worker..."
npx wrangler deploy

# ---------------------------------------------------------------------------
# 4) secrets via piped stdin (printf %s avoids trailing newline); each redeploys
# ---------------------------------------------------------------------------
echo "==> Pushing secrets..."
printf %s "$GITHUB_CLIENT_SECRET" | npx wrangler secret put GITHUB_CLIENT_SECRET
printf %s "$(openssl rand -base64 32)" | npx wrangler secret put STATE_SIGNING_KEY

# ---------------------------------------------------------------------------
# 5) remind admin about the user-token expiration toggle (arctic refresh depends on it)
# ---------------------------------------------------------------------------
echo ""
echo "Done. KV id=$KV_ID."
echo "IMPORTANT: open the GitHub App settings and confirm 'User-to-server token expiration'"
echo "is ON under Optional features -- arctic's silent refresh depends on it."
