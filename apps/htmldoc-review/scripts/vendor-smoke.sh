#!/usr/bin/env bash
set -euo pipefail

# Offline smoke gate for the vendoring pipeline (npm run vendor:smoke). Vendors
# into a temp dir and asserts the operator-copy contract:
#   1) shipped shape — prebuilt dist/ (one content-hashed widget Text module),
#      migrations, setup scripts; NO TypeScript source, tests, or tsconfig; a
#      .gitignore that does not ignore the dist/ payload.
#   2) the emitted no_bundle/find_additional_modules wrangler.toml accepts the
#      artifact set: `wrangler deploy --dry-run` passes FROM the vendored dir.
#   3) re-vendor semantics — the operator's edited wrangler.toml survives, and
#      an unchanged template neither rewrites the sidecar baseline nor nags.
# Uses the monorepo's own wrangler binary so the gate needs no install step and
# no network. deploy.sh's npm-install path is an operator concern, not this gate's.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

# --- 1) vendor into the temp dir --------------------------------------------
"$APP_ROOT/scripts/setup/vendor.sh" "$TMP" >/dev/null

# --- 2) shipped shape ---------------------------------------------------------
[ -f "$TMP/dist/index.js" ] || fail "dist/index.js missing"
WIDGET_COUNT="$(find "$TMP/dist" -name '*-comments.mjs' | wc -l | tr -d ' ')"
[ "$WIDGET_COUNT" = "1" ] || fail "expected exactly one dist/*-comments.mjs widget module, found $WIDGET_COUNT"
[ -f "$TMP/migrations/0001_create_comments.sql" ] || fail "migrations/0001_create_comments.sql missing"
[ -f "$TMP/scripts/setup/deploy.sh" ] || fail "scripts/setup/deploy.sh missing"
[ ! -e "$TMP/src" ] || fail "src/ must not ship"
[ ! -e "$TMP/test" ] || fail "test/ must not ship"
[ ! -e "$TMP/tsconfig.json" ] || fail "tsconfig.json must not ship"
[ ! -e "$TMP/scripts/setup/vendor.sh" ] || fail "vendor.sh must not ship"
grep -q "dist" "$TMP/.gitignore" && fail ".gitignore must not ignore dist/ (it is the payload)"
ok "shipped shape (prebuilt dist, migrations, scripts; no source)"

# --- 3) operator-side dry-run against the no_bundle toml ----------------------
( cd "$TMP" && "$APP_ROOT/node_modules/.bin/wrangler" deploy --dry-run >/dev/null 2>&1 ) \
  || fail "operator-side 'wrangler deploy --dry-run' failed against the prebuilt artifact set"
ok "operator dry-run accepts the prebuilt artifact set"

# --- 4) re-vendor semantics ----------------------------------------------------
sed -i.bak 's/REPLACE_ME_GITHUB_ORG_SLUG/smoke-org/' "$TMP/wrangler.toml" && rm -f "$TMP/wrangler.toml.bak"
SIDECAR_BEFORE="$(cat "$TMP/wrangler.toml.upstream")"
REVENDOR_OUT="$("$APP_ROOT/scripts/setup/vendor.sh" "$TMP")"
grep -q "smoke-org" "$TMP/wrangler.toml" || fail "re-vendor overwrote the operator's wrangler.toml"
printf '%s' "$REVENDOR_OUT" | grep -q "Re-vendored" && fail "re-vendor nagged although the template is unchanged"
[ "$(cat "$TMP/wrangler.toml.upstream")" = "$SIDECAR_BEFORE" ] || fail "re-vendor rewrote the sidecar baseline although the template is unchanged"
ok "re-vendor preserves the operator config and stays silent on an unchanged template"

echo "PASS: vendor smoke"
