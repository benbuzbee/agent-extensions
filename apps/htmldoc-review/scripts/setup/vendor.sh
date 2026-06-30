#!/usr/bin/env bash
set -euo pipefail

# Vendor the htmldoc-review app into your own infra repo, then deploy from there.
#
# Why vendor instead of deploying in place: htmldoc-review is self-hosted per-org.
# The real config (org slug, client id, KV id, callback URL) and operational
# ownership belong to YOUR repo, not to the upstream template. deploy.sh edits
# wrangler.toml in place, so it must run against your copy — never the upstream.
#
# Usage (run from the upstream checkout):
#   ./scripts/setup/vendor.sh <dest-dir>
# Example:
#   ./scripts/setup/vendor.sh ~/infrastructure/htmldocs-app
#
# Then:
#   cd <dest-dir>
#   # set DOC_OWNER (+ CALLBACK_URL once you know your workers.dev subdomain) in wrangler.toml
#   npm install
#   ./scripts/setup/deploy.sh
#
# What it copies: the whole app EXCEPT build artifacts, deps, and local secrets
# (node_modules/, dist/, .dev.vars*, generated types). The app's own .gitignore is
# copied too, so those stay ignored in your repo. A PROVENANCE.md is written
# recording the exact upstream commit so updates are a known re-copy.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DEST="${1:-}"
if [ -z "$DEST" ]; then
  echo "usage: $0 <dest-dir>   (e.g. ~/infrastructure/htmldocs-app)" >&2
  exit 2
fi

# Expand a leading ~ and resolve to an absolute path without requiring it to exist yet.
DEST="${DEST/#\~/$HOME}"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

if [ "$DEST" = "$APP_ROOT" ]; then
  echo "error: destination is the upstream app itself — vendor to a DIFFERENT repo." >&2
  exit 1
fi

# Provenance: record where this copy came from and at what commit, so a future
# update is "re-run vendor.sh from upstream <newer-sha>" rather than guesswork.
SRC_REMOTE="$(git -C "$APP_ROOT" remote get-url origin 2>/dev/null || echo 'unknown')"
SRC_COMMIT="$(git -C "$APP_ROOT" rev-parse HEAD 2>/dev/null || echo 'unknown')"
SRC_SHORT="$(git -C "$APP_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
SRC_DIRTY=""
if ! git -C "$APP_ROOT" diff --quiet HEAD -- "$APP_ROOT" 2>/dev/null; then
  SRC_DIRTY=" (+uncommitted local changes at vendor time)"
fi

echo "==> Vendoring htmldoc-review -> $DEST"
echo "    from $SRC_REMOTE @ $SRC_SHORT$SRC_DIRTY"

# rsync if available (clean excludes); else fall back to tar with the same excludes.
EXCLUDES=(node_modules dist .dev.vars .dev.vars.* worker-configuration.d.ts .git)
if command -v rsync >/dev/null 2>&1; then
  RSYNC_ARGS=(-a --delete)
  for e in "${EXCLUDES[@]}"; do RSYNC_ARGS+=(--exclude "$e"); done
  rsync "${RSYNC_ARGS[@]}" "$APP_ROOT"/ "$DEST"/
else
  TAR_ARGS=()
  for e in "${EXCLUDES[@]}"; do TAR_ARGS+=(--exclude "$e"); done
  ( cd "$APP_ROOT" && tar cf - "${TAR_ARGS[@]}" . ) | ( cd "$DEST" && tar xf - )
fi

# Stamp provenance.
cat > "$DEST/PROVENANCE.md" <<EOF
# Provenance

This directory was **vendored** (copied) from the upstream htmldoc-review template.
Local edits here (wrangler.toml config, etc.) are expected and intentional.

- Source repo:   $SRC_REMOTE
- Source path:   apps/htmldoc-review
- Source commit: $SRC_COMMIT$SRC_DIRTY

## Updating

To pull a newer version of the template, re-run \`vendor.sh <this-dir>\` from a fresh
checkout of the upstream repo at the desired commit. It copies code only — your
wrangler.toml values, secrets (Worker-side), and KV namespace are untouched by a
redeploy. Review the diff before deploying.
EOF

echo "==> Wrote $DEST/PROVENANCE.md"
echo ""
echo "Next:"
echo "  cd $DEST"
echo "  # edit wrangler.toml: set DOC_OWNER (your org/user slug)."
echo "  npm install"
echo "  ./scripts/setup/deploy.sh        # mints the GitHub App, creates KV, deploys, pushes secrets"
echo "  # after the first deploy prints your workers.dev URL, set CALLBACK_URL to"
echo "  # https://htmldoc-review.<your-subdomain>.workers.dev/auth/callback and re-run deploy.sh"
