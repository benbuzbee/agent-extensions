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
# What it copies: the whole app EXCEPT build artifacts, deps, local secrets, and
# wrangler's local state (node_modules/, dist/, .dev.vars*, generated types,
# .wrangler/). The app's own .gitignore is copied too, so those stay ignored in
# your repo. A PROVENANCE.md is written recording the exact upstream commit so
# updates are a known re-copy.
#
# wrangler.toml is special: it is the ONE file you own (DOC_OWNER, CALLBACK_URL,
# and the client id + KV id deploy.sh writes in). On a FIRST vendor we copy the
# template. On a RE-vendor we never overwrite yours — instead we drop the fresh
# template beside it as wrangler.toml.upstream (gitignored) so you can diff/merge
# any template changes by hand.

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

# wrangler.toml is operator-owned, so it's excluded from the bulk copy and handled
# separately below — rsync --delete must never touch it.
# wrangler.toml (operator-owned) and wrangler.toml.upstream (the re-vendor baseline)
# are both handled below and must survive rsync --delete, so exclude them here.
EXCLUDES=(node_modules dist .dev.vars .dev.vars.* worker-configuration.d.ts .wrangler wrangler.toml wrangler.toml.upstream .git)
if command -v rsync >/dev/null 2>&1; then
  RSYNC_ARGS=(-a --delete)
  for e in "${EXCLUDES[@]}"; do RSYNC_ARGS+=(--exclude "$e"); done
  rsync "${RSYNC_ARGS[@]}" "$APP_ROOT"/ "$DEST"/
else
  TAR_ARGS=()
  for e in "${EXCLUDES[@]}"; do TAR_ARGS+=(--exclude "$e"); done
  ( cd "$APP_ROOT" && tar cf - "${TAR_ARGS[@]}" . ) | ( cd "$DEST" && tar xf - )
fi

# wrangler.toml: first vendor copies the template. On re-vendor we never overwrite
# yours; instead we keep the latest template beside it as wrangler.toml.upstream
# (gitignored) so you can diff/merge. The sidecar doubles as the baseline of "last
# template you saw", so we only nag when the template actually CHANGED since the
# last re-vendor (new template != existing sidecar) rather than on every run.
REVENDORED=""
SIDECAR="$DEST/wrangler.toml.upstream"
if [ -f "$DEST/wrangler.toml" ]; then
  if [ ! -f "$SIDECAR" ] || ! cmp -s "$APP_ROOT/wrangler.toml" "$SIDECAR"; then
    cp "$APP_ROOT/wrangler.toml" "$SIDECAR"
    REVENDORED=1
  fi
else
  cp "$APP_ROOT/wrangler.toml" "$DEST/wrangler.toml"
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
checkout of the upstream repo at the desired commit. Your \`wrangler.toml\` is never
overwritten; if the template's changed, the new one lands as \`wrangler.toml.upstream\`
for you to diff/merge by hand. Secrets (Worker-side) and the KV namespace are
untouched. Review the diff before deploying.
EOF

echo "==> Wrote $DEST/PROVENANCE.md"
if [ -n "$REVENDORED" ]; then
  echo ""
  echo "Re-vendored; you may need to merge any changes in wrangler.toml.upstream with your wrangler.toml manually."
else
  echo ""
  echo "Next:"
  echo "  cd $DEST"
  echo "  # edit wrangler.toml: set DOC_OWNER (your org/user slug)."
  echo "  npm install"
  echo "  ./scripts/setup/deploy.sh        # mints the GitHub App, creates KV, deploys, pushes secrets"
  echo "  # after the first deploy prints your workers.dev URL, set CALLBACK_URL to"
  echo "  # https://htmldoc-review.<your-subdomain>.workers.dev/auth/callback and re-run deploy.sh"
fi
