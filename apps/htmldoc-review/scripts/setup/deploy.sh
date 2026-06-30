#!/usr/bin/env bash
set -euo pipefail

# Per-org deploy for the htmldoc-review Worker (Deliverable 1: proxy + auth).
# No D1, no Durable Objects. Session storage is Workers KV with native per-key TTL.
#
# Run this from YOUR copy of the app (see the README "Vendor it" step) — it edits
# wrangler.toml in place, so it must run against your own vendored copy, never the
# upstream template.
#
# Idempotent: safe to re-run. Each step detects whether it's already done and skips
# it, so re-running redeploys code without minting a second GitHub App, creating a
# duplicate KV namespace, or rotating STATE_SIGNING_KEY (which would log everyone out).
#
# Steps (each guarded):
#   0) GitHub App via the manifest flow -> client_id/secret  (skipped if id already set)
#   1) create KV namespace SESSIONS, wire its id into wrangler.toml (skipped if set)
#   2) preflight build/config validation (dry-run)
#   3) deploy the Worker (always; this is the redeploy on a re-run)
#   4) push secrets (only those not already present; never rotates existing ones)
#   5) remind admin to confirm 'User-to-server token expiration' is ON
#
# This script lives in scripts/setup/ but operates on the app root (where
# wrangler.toml lives). We cd to the app root (two levels up) so it is in cwd.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$APP_ROOT"

# ---------------------------------------------------------------------------
# 0) GitHub App manifest flow -> client_id / client_secret (returned ONCE)
# ---------------------------------------------------------------------------
# create-worker-app.mjs renders app-manifest.json (ORG substituted), serves the
# auto-submitting form, captures ?code=&state= on /manifest/callback, POSTs
# /app-manifests/{code}/conversions, and prints the creds to stdout.
#
# Idempotency: minting an App is NOT repeatable (you'd get a second App and a new
# secret). If GITHUB_CLIENT_ID is already a real value in wrangler.toml, we assume
# the App exists and skip the flow. The client_secret is only returned ONCE at
# creation, so on a skip we cannot re-push it — that's fine, it was pushed on the
# first run (step 4 won't overwrite an existing secret).
CURRENT_CLIENT_ID="$(grep -E '^GITHUB_CLIENT_ID' wrangler.toml | sed -E 's/.*= *"([^"]*)".*/\1/')"
GITHUB_CLIENT_SECRET=""
if [[ "$CURRENT_CLIENT_ID" == REPLACE_ME_* || -z "$CURRENT_CLIENT_ID" ]]; then
  echo "==> Creating the GitHub App via the manifest flow (browser will open)..."
  APP_OUT="$(node "$SCRIPT_DIR/create-worker-app.mjs")"
  echo "$APP_OUT"
  GITHUB_CLIENT_ID="$(printf '%s\n' "$APP_OUT" | grep -E '^GITHUB_CLIENT_ID=' | head -n1 | cut -d= -f2-)"
  GITHUB_CLIENT_SECRET="$(printf '%s\n' "$APP_OUT" | grep -E '^GITHUB_CLIENT_SECRET=' | head -n1 | cut -d= -f2-)"
  [ -n "$GITHUB_CLIENT_ID" ] || { echo "ERROR: could not parse client_id from create-worker-app.mjs"; exit 1; }
  [ -n "$GITHUB_CLIENT_SECRET" ] || { echo "ERROR: could not parse client_secret from create-worker-app.mjs"; exit 1; }
  # Wire the (non-secret) client id into wrangler.toml [vars].
  sed -i.bak "s|GITHUB_CLIENT_ID = \".*\"|GITHUB_CLIENT_ID = \"$GITHUB_CLIENT_ID\"|" wrangler.toml && rm -f wrangler.toml.bak
else
  echo "==> GitHub App client id already set ($CURRENT_CLIENT_ID) -- skipping manifest flow."
fi

# ---------------------------------------------------------------------------
# 1) create KV namespace, parse the 32-hex id (wrangler does NOT auto-edit config)
# ---------------------------------------------------------------------------
# Idempotency: only create if the id is still the placeholder. Re-running with a
# real id would create an orphan namespace and leak the binding.
if grep -q "REPLACE_WITH_KV_NAMESPACE_ID" wrangler.toml; then
  echo "==> Creating KV namespace SESSIONS..."
  CREATE_OUT="$(npx wrangler kv namespace create SESSIONS)"
  echo "$CREATE_OUT"
  KV_ID="$(printf '%s\n' "$CREATE_OUT" | grep -oE '[0-9a-f]{32}' | head -n1)"
  [ -n "$KV_ID" ] || { echo "ERROR: could not parse KV namespace id"; exit 1; }
  sed -i.bak "s/REPLACE_WITH_KV_NAMESPACE_ID/$KV_ID/" wrangler.toml && rm -f wrangler.toml.bak
else
  KV_ID="$(grep -A3 'binding = "SESSIONS"' wrangler.toml | grep -oE '[0-9a-f]{32}' | head -n1)"
  echo "==> KV namespace already wired (id=$KV_ID) -- skipping create."
fi

# ---------------------------------------------------------------------------
# 2) preflight: bundle + config validation, no upload, no creds needed
# ---------------------------------------------------------------------------
echo "==> Preflight (dry-run) build/config check..."
npx wrangler deploy --dry-run --outdir dist

# ---------------------------------------------------------------------------
# 3) deploy: creates (or redeploys) the live Worker + KV binding
# ---------------------------------------------------------------------------
# The Worker must exist before `secret put`, and a re-run lands here to push new
# code. Deploy is naturally idempotent (it replaces the running version).
echo "==> Deploying Worker..."
npx wrangler deploy

# ---------------------------------------------------------------------------
# 4) secrets: push only what's missing; never rotate an existing secret
# ---------------------------------------------------------------------------
# `wrangler secret list` is the source of truth for what's already set. We never
# overwrite: rotating STATE_SIGNING_KEY invalidates every signed state nonce, and
# we can't re-push GITHUB_CLIENT_SECRET on a re-run anyway (returned once).
echo "==> Reconciling secrets..."
EXISTING_SECRETS="$(npx wrangler secret list 2>/dev/null || echo '[]')"

if printf '%s' "$EXISTING_SECRETS" | grep -q "GITHUB_CLIENT_SECRET"; then
  echo "    GITHUB_CLIENT_SECRET already set -- leaving as-is."
elif [ -n "$GITHUB_CLIENT_SECRET" ]; then
  printf %s "$GITHUB_CLIENT_SECRET" | npx wrangler secret put GITHUB_CLIENT_SECRET
else
  echo "    WARNING: GITHUB_CLIENT_SECRET is not set and the App already existed, so"
  echo "    we no longer have it (GitHub returns it once). If auth fails, generate a new"
  echo "    client secret in the GitHub App settings and run:"
  echo "      printf %s '<new-secret>' | npx wrangler secret put GITHUB_CLIENT_SECRET"
fi

if printf '%s' "$EXISTING_SECRETS" | grep -q "STATE_SIGNING_KEY"; then
  echo "    STATE_SIGNING_KEY already set -- leaving as-is (rotating would log everyone out)."
else
  printf %s "$(openssl rand -base64 32)" | npx wrangler secret put STATE_SIGNING_KEY
fi

# ---------------------------------------------------------------------------
# 5) remind admin about the user-token expiration toggle (arctic refresh depends on it)
# ---------------------------------------------------------------------------
echo ""
echo "Done. KV id=$KV_ID."
echo "IMPORTANT: open the GitHub App settings and confirm 'User-to-server token expiration'"
echo "is ON under Optional features -- arctic's silent refresh depends on it."
