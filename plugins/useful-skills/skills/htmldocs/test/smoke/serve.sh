#!/usr/bin/env bash
# Smoke test for ../../serve.sh: boots it against the clean fixture, asserts
# the URL:/SIDECAR_DIR: stdout contract, exercises both the dir-arg and
# file-arg URL shapes, and drives an op round-trip over the <doc>?comments API
# (POST create, then GET list) through the bundled server to verify the op lands
# and the sidecar mirrors under SIDECAR_DIR — with a served-tree leak check.
#
# Bash + curl only — kept off the Playwright runner so this stays a fast
# pre-flight check on the bundle-as-shipped. Playwright specs cover the
# server logic in-process; this smoke is the one thing that exercises
# serve.sh + dist/serve.mjs as a unit.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_root="$(cd "$here/../.." && pwd)"
cd "$skill_root"

tmp_dir="$(mktemp -d)"
server_pid=""
exit_rc=1
cleanup() {
  exit_rc=$?
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp_dir"
  exit "$exit_rc"
}
trap 'cleanup' EXIT

# Each phase: boot `serve.sh $arg`, capture both stdout lines, assert the
# URL matches the shape regex, and confirm any status-code expectations
# the caller listed as <path>:<status> pairs.
run_phase() {
  local label="$1" arg="$2" url_shape_regex="$3"
  shift 3
  local out_file="$tmp_dir/${label}.out"
  local err_file="$tmp_dir/${label}.err"

  bash serve.sh "$arg" >"$out_file" 2>"$err_file" &
  server_pid=$!

  local url="" sidecar_dir=""
  local i
  for i in $(seq 1 50); do
    if grep -q '^URL: ' "$out_file" && grep -q '^SIDECAR_DIR: ' "$out_file"; then
      url="$(grep -m1 '^URL: ' "$out_file" | sed 's/^URL: //')"
      sidecar_dir="$(grep -m1 '^SIDECAR_DIR: ' "$out_file" | sed 's/^SIDECAR_DIR: //')"
      break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      echo "FAIL[$label]: server exited before printing both stdout lines" >&2
      echo "--- stdout ---" >&2; cat "$out_file" >&2
      echo "--- stderr ---" >&2; cat "$err_file" >&2
      return 1
    fi
    sleep 0.1
  done

  if [[ -z "$url" || -z "$sidecar_dir" ]]; then
    echo "FAIL[$label]: timed out waiting for URL: and SIDECAR_DIR: lines" >&2
    return 1
  fi

  if ! [[ "$url" =~ $url_shape_regex ]]; then
    echo "FAIL[$label]: URL shape mismatch: '$url' !~ /$url_shape_regex/" >&2
    return 1
  fi
  echo "ok[$label]: URL=$url"
  echo "ok[$label]: SIDECAR_DIR=$sidecar_dir"

  [[ -d "$sidecar_dir" ]] || { echo "FAIL[$label]: SIDECAR_DIR not a directory: $sidecar_dir" >&2; return 1; }

  # Wait until the server accepts the base URL.
  for i in $(seq 1 50); do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      echo "FAIL[$label]: server died after stdout but before accepting requests" >&2
      cat "$err_file" >&2
      return 1
    fi
    if curl -fs -o /dev/null "${url}" 2>/dev/null; then break; fi
    sleep 0.1
  done

  # Status-code checks from the caller.
  local pair p_path want got
  for pair in "$@"; do
    p_path="${pair%%:*}"
    want="${pair##*:}"
    got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${url}${p_path}")"
    if [[ "$got" != "$want" ]]; then
      echo "FAIL[$label]: ${url}${p_path} → $got (want $want)" >&2
      return 1
    fi
    echo "ok[$label]: ${url}${p_path} → $got"
  done

  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  server_pid=""
}

# Phase 1: directory arg → URL ends in `/`.
run_phase "dir" "test/fixtures/clean/" '/$' \
  "index.html:200" \
  "does-not-exist.html:404"

# Phase 2: file arg → URL ends in `/index.html`. Re-checks that serve.sh's
# basename-derivation still works (was deleted-then-restored coverage that
# the in-process Playwright specs cannot cover, since they bypass serve.sh).
run_phase "file" "test/fixtures/clean/index.html" '/index\.html$' \
  ":200"

# Phase 3: op round-trip over the <doc>?comments API. We re-boot here against
# the dir arg so the server is fresh, and record the served-tree fixture hash
# before-and-after the op — that's the leak-detection signal.
fixture_sidecar="test/fixtures/clean/index.comments.json"
fixture_hash_before="$(sha256sum "$fixture_sidecar" | awk '{print $1}')"

# The dir-phase server was killed at end of run_phase; boot a fresh one for the
# op round-trip so the sidecar dir is a fresh auto-tmp (the prior phase's dir was
# cleaned up implicitly when the server exited and tmp_dir teardown runs at EXIT).
out_file="$tmp_dir/op.out"
err_file="$tmp_dir/op.err"
bash serve.sh "test/fixtures/clean/" >"$out_file" 2>"$err_file" &
server_pid=$!
for _ in $(seq 1 50); do
  if grep -q '^URL: ' "$out_file" && grep -q '^SIDECAR_DIR: ' "$out_file"; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { echo "FAIL[op]: server died" >&2; cat "$err_file" >&2; exit 1; }
  sleep 0.1
done
op_url="$(grep -m1 '^URL: ' "$out_file" | sed 's/^URL: //')"
op_sidecar_dir="$(grep -m1 '^SIDECAR_DIR: ' "$out_file" | sed 's/^SIDECAR_DIR: //')"
for _ in $(seq 1 50); do
  curl -fs -o /dev/null "${op_url}" 2>/dev/null && break
  kill -0 "$server_pid" 2>/dev/null || { echo "FAIL[op]: server died before accepting" >&2; exit 1; }
  sleep 0.1
done

# The collection URL for the served index.html: the doc path + ?comments.
comments_url="${op_url}index.html?comments"
op_body='{"op":"create","anchor":{"sections":["alpha"],"prefix":"The ","exact":"quick brown fox","suffix":" jumps"},"text":"smoke"}'

# POST the create op -> 200 with the new thread.
create_out="$(curl -s -w '\n%{http_code}' -X POST --max-time 10 \
  -H 'Content-Type: application/json' \
  --data-raw "$op_body" \
  "${comments_url}")"
create_code="$(printf '%s' "$create_out" | tail -n1)"
create_json="$(printf '%s' "$create_out" | sed '$d')"
[[ "$create_code" == "200" ]] || { echo "FAIL[op]: POST create → $create_code (want 200)" >&2; echo "$create_json" >&2; cat "$err_file" >&2; exit 1; }
printf '%s' "$create_json" | grep -q '"op":"create"' || { echo "FAIL[op]: create response missing op:create" >&2; echo "$create_json" >&2; exit 1; }
echo "ok[op]: POST create → 200"

# GET the collection -> 200 {threads:[...]} listing the created thread.
list_out="$(curl -s -w '\n%{http_code}' --max-time 10 "${comments_url}")"
list_code="$(printf '%s' "$list_out" | tail -n1)"
list_json="$(printf '%s' "$list_out" | sed '$d')"
[[ "$list_code" == "200" ]] || { echo "FAIL[op]: GET list → $list_code (want 200)" >&2; echo "$list_json" >&2; exit 1; }
printf '%s' "$list_json" | grep -q '"threads"' || { echo "FAIL[op]: list response missing threads" >&2; echo "$list_json" >&2; exit 1; }
printf '%s' "$list_json" | grep -q '"body":"smoke"' || { echo "FAIL[op]: created thread not listed" >&2; echo "$list_json" >&2; exit 1; }
echo "ok[op]: GET list contains the created thread"

# The sidecar landed under SIDECAR_DIR in the (unchanged) legacy on-disk shape.
landed="$op_sidecar_dir/index.comments.json"
[[ -f "$landed" ]] || { echo "FAIL[op]: sidecar did not land at $landed" >&2; exit 1; }
grep -Eq '"body"[[:space:]]*:[[:space:]]*"smoke"' "$landed" || {
  echo "FAIL[op]: landed sidecar missing expected body" >&2
  cat "$landed" >&2
  exit 1
}
echo "ok[op]: sidecar landed at $landed with expected body"

# Hash-based leak detection — catches ANY write to the served-tree sidecar.
fixture_hash_after="$(sha256sum "$fixture_sidecar" | awk '{print $1}')"
[[ "$fixture_hash_before" == "$fixture_hash_after" ]] || {
  echo "FAIL[op]: served-tree sidecar was mutated by the op" >&2
  echo "  before: $fixture_hash_before" >&2
  echo "  after:  $fixture_hash_after" >&2
  exit 1
}
echo "ok[op]: served tree unchanged by the op"

kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
server_pid=""

echo "PASS: serve.sh smoke"
exit_rc=0
