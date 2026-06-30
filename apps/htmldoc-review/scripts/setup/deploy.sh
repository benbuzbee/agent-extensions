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
# DEPLOY-FIRST ordering. The GitHub App's runtime callback_urls must point at the
# deployed Worker, but on a *.workers.dev quick start that URL isn't known until the
# first deploy. So we deploy first to learn the URL, then create the App with the
# correct callback baked in -- no manual GitHub-settings edit on initial setup.
#
# Steps (each guarded for idempotency):
#   pre) ensure deps installed + wrangler authenticated (logs in if needed)
#   1) read REPO_ORG from wrangler.toml (fail fast if still the placeholder)
#   2) create KV namespace SESSIONS, wire its id into wrangler.toml (skipped if set)
#   3) generate types + preflight build/config validation (dry-run)
#   4) learner deploy IF CALLBACK_URL is still the placeholder -> parse the deployed
#      URL, derive CALLBACK_URL = <url>/auth/callback, write it into wrangler.toml
#   5) GitHub App via the manifest flow, passing --callback-url (skipped if id set);
#      capture client_id/secret, wire client_id into wrangler.toml
#   6) push secrets (only those not already present; never rotates existing ones)
#   7) final deploy so the Worker runs with the real CALLBACK_URL + client_id
#   8) remind admin to confirm 'User-to-server token expiration' is ON
#
# This script lives in scripts/setup/ but operates on the app root (where
# wrangler.toml lives). We cd to the app root (two levels up) so it is in cwd.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$APP_ROOT"

# ---------------------------------------------------------------------------
# pre) Tooling + auth: make sure wrangler is available and you're logged in,
# failing fast (and interactively) here rather than partway through a deploy.
# ---------------------------------------------------------------------------
# wrangler is a devDependency; on a fresh vendored copy node_modules may be empty,
# in which case `npx wrangler` would try to fetch it. Install first if missing.
if [ ! -x node_modules/.bin/wrangler ]; then
  echo "==> Installing dependencies (wrangler not found in node_modules)..."
  npm install
fi

# NB: `wrangler whoami` exits 0 even when logged OUT (it just prints "You are not
# authenticated"), so we must match its OUTPUT, not its exit code. If logged out,
# run the interactive browser login (the one step that genuinely needs a human).
echo "==> Checking Cloudflare auth..."
if npx wrangler whoami 2>&1 | grep -qi "not authenticated"; then
  echo "    Not logged in to Cloudflare -- launching 'wrangler login' (opens a browser)..."
  npx wrangler login
  if npx wrangler whoami 2>&1 | grep -qi "not authenticated"; then
    echo "ERROR: still not authenticated after 'wrangler login'."; exit 1
  fi
fi
echo "    Authenticated."

# ---------------------------------------------------------------------------
# 1) REPO_ORG: single source of truth for the org/owner. Fail fast on placeholder.
# ---------------------------------------------------------------------------
REPO_ORG="$(grep -E '^REPO_ORG' wrangler.toml | sed -E 's/.*= *"([^"]*)".*/\1/')"
if [[ "$REPO_ORG" == REPLACE_ME_* || -z "$REPO_ORG" ]]; then
  echo "ERROR: set REPO_ORG in wrangler.toml to your GitHub org/user slug before deploying."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2) create KV namespace, parse the 32-hex id (wrangler does NOT auto-edit config)
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
# 3) preflight: generate types, then bundle + config validation (no upload/creds)
# ---------------------------------------------------------------------------
# `wrangler types` reads .dev.vars to emit the secret keys into the Env type, so
# .dev.vars must exist BEFORE typegen or tsc/tests fail on a missing Env field.
# These are FAKE local values (real secrets are pushed in step 6); see
# .dev.vars.example. On a fresh vendored copy .dev.vars won't exist yet.
[ -f .dev.vars ] || { [ -f .dev.vars.example ] && cp .dev.vars.example .dev.vars; }
echo "==> Generating Worker types (wrangler types)..."
npx wrangler types

echo "==> Preflight (dry-run) build/config check..."
npx wrangler deploy --dry-run --outdir dist

# ---------------------------------------------------------------------------
# 4) learner deploy: if CALLBACK_URL is still the placeholder, deploy once to learn
#    the workers.dev URL, then derive + write CALLBACK_URL. The Worker deploys fine
#    with a placeholder client_id and no secrets yet — it only needs them at request
#    time — so this bootstrap deploy is safe and is what reveals the origin.
# ---------------------------------------------------------------------------
CURRENT_CALLBACK="$(grep -E '^CALLBACK_URL' wrangler.toml | sed -E 's/.*= *"([^"]*)".*/\1/')"
if [[ "$CURRENT_CALLBACK" == *REPLACE_ME* || -z "$CURRENT_CALLBACK" ]]; then
  echo "==> CALLBACK_URL not set -- deploying once to discover the workers.dev URL..."
  DEPLOY_OUT="$(npx wrangler deploy 2>&1)"
  echo "$DEPLOY_OUT"
  # wrangler prints the live URL(s) after deploy; grab the first https://...workers.dev.
  WORKER_URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -n1)"
  [ -n "$WORKER_URL" ] || { echo "ERROR: could not parse the deployed workers.dev URL from wrangler output."; exit 1; }
  CALLBACK_URL="${WORKER_URL}/auth/callback"
  echo "==> Discovered Worker URL: $WORKER_URL"
  echo "==> Setting CALLBACK_URL=$CALLBACK_URL"
  # Match only the quoted value ("[^"]*"), NOT greedy ".*" — the line has a comment
  # that may itself contain quotes, and .* would swallow through them and corrupt it.
  sed -i.bak "s|^CALLBACK_URL = \"[^\"]*\"|CALLBACK_URL = \"$CALLBACK_URL\"|" wrangler.toml && rm -f wrangler.toml.bak
else
  CALLBACK_URL="$CURRENT_CALLBACK"
  echo "==> CALLBACK_URL already set ($CALLBACK_URL) -- skipping discovery deploy."
fi

# ---------------------------------------------------------------------------
# 5) GitHub App manifest flow -> client_id / client_secret (returned ONCE)
# ---------------------------------------------------------------------------
# create-worker-app.mjs builds the manifest inline (callback_urls = CALLBACK_URL,
# redirect_url = its own localhost), serves the auto-submitting form, captures
# ?code=&state=, POSTs /app-manifests/{code}/conversions, prints creds to stdout.
#
# Idempotency: minting an App is NOT repeatable (you'd get a second App + new secret).
# If GITHUB_CLIENT_ID is already real, assume the App exists and skip. The secret is
# returned ONCE at creation, so on a skip we can't re-push it — fine, it was pushed on
# the first run (step 6 won't overwrite an existing secret).
CURRENT_CLIENT_ID="$(grep -E '^GITHUB_CLIENT_ID' wrangler.toml | sed -E 's/.*= *"([^"]*)".*/\1/')"
GITHUB_CLIENT_SECRET=""
if [[ "$CURRENT_CLIENT_ID" == REPLACE_ME_* || -z "$CURRENT_CLIENT_ID" ]]; then
  echo "==> Creating the GitHub App via the manifest flow (browser will open)..."
  APP_OUT="$(node "$SCRIPT_DIR/create-worker-app.mjs" --org "$REPO_ORG" --callback-url "$CALLBACK_URL")"
  echo "$APP_OUT"
  GITHUB_CLIENT_ID="$(printf '%s\n' "$APP_OUT" | grep -E '^GITHUB_CLIENT_ID=' | head -n1 | cut -d= -f2-)"
  GITHUB_CLIENT_SECRET="$(printf '%s\n' "$APP_OUT" | grep -E '^GITHUB_CLIENT_SECRET=' | head -n1 | cut -d= -f2-)"
  [ -n "$GITHUB_CLIENT_ID" ] || { echo "ERROR: could not parse client_id from create-worker-app.mjs"; exit 1; }
  [ -n "$GITHUB_CLIENT_SECRET" ] || { echo "ERROR: could not parse client_secret from create-worker-app.mjs"; exit 1; }
  # Wire the (non-secret) client id into wrangler.toml [vars]. Match only the quoted
  # value ("[^"]*"), NOT greedy ".*": the comment on this line contains quotes and a
  # greedy match would swallow through them and corrupt the TOML.
  sed -i.bak "s|^GITHUB_CLIENT_ID = \"[^\"]*\"|GITHUB_CLIENT_ID = \"$GITHUB_CLIENT_ID\"|" wrangler.toml && rm -f wrangler.toml.bak
else
  echo "==> GitHub App client id already set ($CURRENT_CLIENT_ID) -- skipping manifest flow."
fi

# ---------------------------------------------------------------------------
# 6) secrets: push only what's missing; never rotate an existing secret
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
# 7) final deploy: re-run so the Worker serves with the real CALLBACK_URL +
#    GITHUB_CLIENT_ID now written into wrangler.toml (the learner deploy in step 4
#    ran with the placeholders). Deploy is idempotent — it replaces the version.
# ---------------------------------------------------------------------------
echo "==> Final deploy (with real CALLBACK_URL + client id)..."
npx wrangler deploy

# ---------------------------------------------------------------------------
# 8) REQUIRED next step: install the App on the org. Deploying + creating the
#    App is NOT enough -- a user-to-server token only grants access to repos
#    where the App is INSTALLED, and GitHub has no API to install on your
#    behalf. Skipping this is the #1 setup trap: every doc returns a neutral
#    404 with no hint why. So we end on the install URL, not a bare "Done".
# ---------------------------------------------------------------------------
INSTALL_URL="https://github.com/apps/htmldoc-review-${REPO_ORG}/installations/new"
echo ""
echo "Deployed. KV id=$KV_ID. Worker callback: $CALLBACK_URL"
echo ""
echo "ONE REQUIRED STEP LEFT -- install the GitHub App on your org/account:"
echo "  $INSTALL_URL"
echo "Pick 'All repositories' (or just the ones with docs). Until you install it,"
echo "every doc returns a neutral 404 -- creating the App does NOT grant repo access."
echo ""
echo "Also confirm 'User-to-server token expiration' is ON under the App's Optional"
echo "features -- arctic's silent refresh depends on it."
