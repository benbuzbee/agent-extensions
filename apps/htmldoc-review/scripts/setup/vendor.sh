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
#   # set REPO_ORG in wrangler.toml (deploy.sh fills CALLBACK_URL after first deploy)
#   ./scripts/setup/deploy.sh   # installs wrangler itself
#
# What it ships: the COMPILED Worker (dist/ — built here at vendor time with
# `wrangler deploy --dry-run --outdir`), the D1 migrations, the setup scripts,
# and a minimal package.json (wrangler + open) — never TypeScript source. The
# vendored copy deploys the prebuilt artifacts as-is (its wrangler.toml sets
# `main = "dist/index.js"` + `no_bundle`), so it needs no tsconfig, no tests,
# and no access to this monorepo. A PROVENANCE.md records the exact upstream
# commit so updates are a known re-vendor.
#
# wrangler.toml is special: it is the ONE file you own (REPO_ORG, CALLBACK_URL,
# and the client id + KV id deploy.sh writes in). On a FIRST vendor we emit the
# operator config (the upstream template transformed to prebuilt mode). On a
# RE-vendor we never overwrite yours — instead we drop the fresh transformed
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

# The build needs the app's own wrangler (a devDependency); install if missing.
if [ ! -x "$APP_ROOT/node_modules/.bin/wrangler" ]; then
  echo "==> Installing upstream dependencies (wrangler not found in node_modules)..."
  ( cd "$APP_ROOT" && npm install )
fi

# The @shared/* alias resolves into the skill's source tree, so esbuild resolves
# the skill's bare imports (zod) against the SKILL's node_modules — the app's own
# install doesn't cover them. Install the skill's deps too if missing.
SKILL_ROOT="$(cd "$APP_ROOT/../../plugins/useful-skills/skills/htmldocs" && pwd)"
if [ ! -d "$SKILL_ROOT/node_modules/zod" ]; then
  echo "==> Installing skill dependencies (zod not found in the skill's node_modules)..."
  ( cd "$SKILL_ROOT" && npm install )
fi

# Build the Worker into a FRESH temp dir — never the app's dist/ — so stale
# content-hashed additional modules from earlier builds can never ride along.
# --dry-run bundles + validates without uploading, so no Cloudflare auth is
# needed. Output: index.js + index.js.map + the content-hashed widget Text
# module (<hash>-comments.mjs — the skill's dist bundle, emitted as text via
# wrangler.toml's scoped [[rules]] entry) that index.js imports relatively.
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
echo "==> Building the Worker (wrangler deploy --dry-run --outdir)..."
( cd "$APP_ROOT" && npx wrangler deploy --dry-run --outdir "$BUILD_DIR" )

# Assemble the destination from curated copies: the built dist/, the D1
# migrations, and the setup scripts (deploy.sh + create-worker-app.mjs;
# vendor.sh itself only ever runs from the upstream checkout, so it is not
# shipped). No src/, no tests, no tsconfig — the operator copy has nothing to
# compile.
copy_tree() {
  local from="$1" to="$2"; shift 2
  mkdir -p "$to"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$@" "$from"/ "$to"/
  else
    local tar_args=()
    while [ $# -gt 0 ]; do
      [ "$1" = "--exclude" ] && { tar_args+=(--exclude "$2"); shift 2; continue; }
      shift
    done
    rm -rf "$to"; mkdir -p "$to"
    # ${arr[@]+...} keeps an empty exclude list from tripping set -u on bash < 4.4
    # (macOS /bin/bash), the very hosts this no-rsync fallback exists for.
    ( cd "$from" && tar cf - ${tar_args[@]+"${tar_args[@]}"} . ) | ( cd "$to" && tar xf - )
  fi
}
# The build also emits a timestamp-stamped README.md and a source map whose
# sourceRoot/sources embed this machine's temp and checkout paths. Neither is
# part of the deploy upload (the module rules cover only the *-comments.mjs
# widget Text module), and shipping them would dirty every re-vendor with
# per-run noise — exclude them so an unchanged upstream re-vendors byte-identical.
copy_tree "$BUILD_DIR" "$DEST/dist" --exclude README.md --exclude index.js.map
copy_tree "$APP_ROOT/migrations" "$DEST/migrations"
copy_tree "$APP_ROOT/scripts/setup" "$DEST/scripts/setup" --exclude vendor.sh
# Operator README: the app README minus the dev sections from "Running tests" on
# — they drive files (tests, tsconfig, .dev.vars.example) the prebuilt copy
# doesn't ship. Everything before that (setup, config reference, API) applies
# verbatim to the vendored copy.
awk '/^## Running tests$/ { exit } { print }' "$APP_ROOT/README.md" > "$DEST/README.md"

# Minimal operator package.json, generated from the app's so there is no second
# manifest to drift: wrangler (deploy.sh drives it) and open
# (create-worker-app.mjs imports it), nothing else.
node - "$APP_ROOT/package.json" "$DEST/package.json" <<'EOF'
const { readFileSync, writeFileSync } = require("node:fs");
const [src, dest] = process.argv.slice(2);
const app = JSON.parse(readFileSync(src, "utf8"));
writeFileSync(
  dest,
  JSON.stringify(
    {
      name: app.name,
      private: true,
      type: "module",
      scripts: { deploy: "./scripts/setup/deploy.sh" },
      devDependencies: {
        wrangler: app.devDependencies.wrangler,
        open: app.devDependencies.open,
      },
    },
    null,
    2,
  ) + "\n",
);
EOF

# The operator repo must COMMIT dist/ (it is the deployable payload), so the
# app's own .gitignore — which ignores dist/ as a build artifact — must not be
# copied. Emit one scoped to what the operator copy actually generates.
cat > "$DEST/.gitignore" <<'EOF'
node_modules/
.wrangler/

# Fresh template dropped by vendor.sh on re-vendor for manual merge; not your config.
wrangler.toml.upstream
EOF

# Operator wrangler.toml: the upstream template transformed to prebuilt mode —
# main points at the built dist/index.js and wrangler uploads the artifact set
# as-is instead of bundling. Deterministic, so the re-vendor comparison below
# runs against the SAME transformed output every time the template is unchanged.
emit_operator_toml() {
  local out="$1"
  sed 's|^main = "src/worker/index.ts"|main = "dist/index.js"|' "$APP_ROOT/wrangler.toml" \
    | awk '{
        print
        if ($0 ~ /^main = "dist\/index.js"/) {
          print "# Prebuilt deploy: dist/ ships the already-bundled Worker (index.js plus the"
          print "# content-hashed widget Text module it imports). Wrangler uploads these files"
          print "# as-is — no bundling here, no src/ in this copy. find_additional_modules picks"
          print "# up the sidecar module via the Text rule appended at the END of this file,"
          print "# whose glob matches the emitted <hash>-comments.mjs name (the source-mode"
          print "# [[rules]] entry below is inert here — its glob matches nothing in the"
          print "# prebuilt layout)."
          print "no_bundle = true"
          print "find_additional_modules = true"
        }
      }
      END {
        print ""
        print "# The prebuilt widget Text module (see the note under `main` above)."
        print "[[rules]]"
        print "type = \"Text\""
        print "globs = [\"**/*-comments.mjs\"]"
        print "fallthrough = true"
      }' > "$out"
}

# First vendor: the transformed template becomes your wrangler.toml, and the
# SAME bytes land as wrangler.toml.upstream (gitignored) — the baseline of "last
# template you saw". On re-vendor we never overwrite your wrangler.toml; we
# compare the fresh transformed template against that baseline and only when the
# template actually CHANGED do we refresh the sidecar and nag you to diff/merge
# it — an unchanged template re-vendors silently, no matter how much of your own
# config (REPO_ORG, ids, callback) you have filled in.
REVENDORED=""
SIDECAR="$DEST/wrangler.toml.upstream"
FRESH_TOML="$BUILD_DIR/wrangler.toml.operator"
emit_operator_toml "$FRESH_TOML"
if [ -f "$DEST/wrangler.toml" ]; then
  if [ ! -f "$SIDECAR" ] || ! cmp -s "$FRESH_TOML" "$SIDECAR"; then
    cp "$FRESH_TOML" "$SIDECAR"
    REVENDORED=1
  fi
else
  cp "$FRESH_TOML" "$DEST/wrangler.toml"
  cp "$FRESH_TOML" "$SIDECAR"
fi

# Stamp provenance.
cat > "$DEST/PROVENANCE.md" <<EOF
# Provenance

This directory is a **vendored prebuilt copy** of the upstream htmldoc-review
template: \`dist/\` was compiled at vendor time from the source commit below (no
TypeScript source ships here). Local edits (wrangler.toml config, etc.) are
expected and intentional.

- Source repo:   $SRC_REMOTE
- Source path:   apps/htmldoc-review
- Source commit: $SRC_COMMIT$SRC_DIRTY

## Updating

To pull a newer version, re-run \`vendor.sh <this-dir>\` from a fresh checkout of
the upstream repo at the desired commit — it rebuilds and refreshes \`dist/\`,
\`migrations/\`, \`scripts/setup/\`, and \`package.json\`. Your \`wrangler.toml\` is
never overwritten; if the template changed, the new one lands as
\`wrangler.toml.upstream\` for you to diff/merge by hand. Secrets (Worker-side)
and the KV namespace are untouched. Review the diff before deploying.
EOF

echo "==> Wrote $DEST/PROVENANCE.md"
if [ -n "$REVENDORED" ]; then
  echo ""
  echo "Re-vendored; you may need to merge any changes in wrangler.toml.upstream with your wrangler.toml manually."
else
  echo ""
  echo "Next:"
  echo "  cd $DEST"
  echo "  # edit wrangler.toml: set REPO_ORG (your org/user slug) -- the only value you set by hand"
  echo "  ./scripts/setup/deploy.sh   # installs wrangler, deploys to discover the URL, creates the"
  echo "                              # GitHub App with that callback, pushes secrets, redeploys"
fi
