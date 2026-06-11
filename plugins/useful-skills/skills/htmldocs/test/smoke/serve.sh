#!/usr/bin/env bash
# Smoke test for the review server (dist/serve.mjs): boots it against the
# clean fixture, asserts the URL:/SIDECAR_DIR: stdout contract, exercises
# both the dir-arg and file-arg URL shapes, and drives a PUT round-trip
# through the bundled server to verify a real CommentsModel lands at the
# mirrored path under SIDECAR_DIR.
#
# Bash + curl only — kept off the Playwright runner so this stays a fast
# pre-flight check on the bundle-as-shipped. Playwright specs cover the
# server logic in-process; this smoke is the one thing that exercises the
# shipped dist/serve.mjs CLI end to end (arg parsing, port bind, stdout).

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

# Each phase: boot `node dist/serve.mjs $arg`, capture both stdout lines, assert the
# URL matches the shape regex, and confirm any status-code expectations
# the caller listed as <path>:<status> pairs.
run_phase() {
  local label="$1" arg="$2" url_shape_regex="$3"
  shift 3
  local out_file="$tmp_dir/${label}.out"
  local err_file="$tmp_dir/${label}.err"

  node dist/serve.mjs "$arg" >"$out_file" 2>"$err_file" &
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

  # Stash for the dir-phase PUT round-trip below.
  if [[ "$label" == "dir" ]]; then
    echo "$url" > "$tmp_dir/dir.url"
    echo "$sidecar_dir" > "$tmp_dir/dir.sidecar_dir"
  fi

  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  server_pid=""
}

# Phase 1: directory arg → URL ends in `/`.
run_phase "dir" "test/fixtures/clean/" '/$' \
  "index.html:200" \
  "does-not-exist.html:404"

# Phase 2: file arg → URL ends in `/index.html`. Re-checks that the CLI's
# basename-derivation still works (coverage the in-process Playwright specs
# cannot give, since they call startReviewServer and bypass arg parsing).
run_phase "file" "test/fixtures/clean/index.html" '/index\.html$' \
  ":200"

# Phase 3: PUT round-trip from the dir-phase server. We re-boot here against
# the dir arg so the server is fresh for the PUT and we can record fixture
# mtime/hash before-and-after the write — that's the leak-detection signal.
fixture_sidecar="test/fixtures/clean/index.comments.json"
fixture_hash_before="$(sha256sum "$fixture_sidecar" | awk '{print $1}')"

put_url="$(cat "$tmp_dir/dir.url" 2>/dev/null || true)"
put_sidecar_dir="$(cat "$tmp_dir/dir.sidecar_dir" 2>/dev/null || true)"

# The dir-phase server was killed at end of run_phase; boot a fresh one for
# the PUT so the sidecar dir is a fresh auto-tmp (the prior phase's dir was
# cleaned up implicitly when the server exited and tmp_dir teardown runs
# at EXIT).
out_file="$tmp_dir/put.out"
err_file="$tmp_dir/put.err"
node dist/serve.mjs "test/fixtures/clean/" >"$out_file" 2>"$err_file" &
server_pid=$!
for _ in $(seq 1 50); do
  if grep -q '^URL: ' "$out_file" && grep -q '^SIDECAR_DIR: ' "$out_file"; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { echo "FAIL[put]: server died" >&2; cat "$err_file" >&2; exit 1; }
  sleep 0.1
done
put_url="$(grep -m1 '^URL: ' "$out_file" | sed 's/^URL: //')"
put_sidecar_dir="$(grep -m1 '^SIDECAR_DIR: ' "$out_file" | sed 's/^SIDECAR_DIR: //')"
for _ in $(seq 1 50); do
  curl -fs -o /dev/null "${put_url}" 2>/dev/null && break
  kill -0 "$server_pid" 2>/dev/null || { echo "FAIL[put]: server died before accepting" >&2; exit 1; }
  sleep 0.1
done

put_body='{"doc":"index.html","schema":1,"comments":[{"id":"smoke-1","anchor":{"sections":["alpha"],"prefix":"The ","exact":"quick brown fox","suffix":" jumps"},"body":"smoke","author":"user","created_at":"2026-05-26T00:00:00Z"}]}'

got="$(curl -s -o /dev/null -w '%{http_code}' -X PUT --max-time 10 \
  -H 'Content-Type: application/json' \
  --data-raw "$put_body" \
  "${put_url}__htmldocs/sidecar/index.html")"
[[ "$got" == "204" ]] || { echo "FAIL[put]: PUT sidecar → $got (want 204)" >&2; cat "$err_file" >&2; exit 1; }
echo "ok[put]: PUT sidecar → 204"

landed="$put_sidecar_dir/index.comments.json"
[[ -f "$landed" ]] || { echo "FAIL[put]: sidecar did not land at $landed" >&2; exit 1; }
# Whitespace-tolerant body match so a JSON-formatting change doesn't break
# the smoke for unrelated reasons.
grep -Eq '"body"[[:space:]]*:[[:space:]]*"smoke"' "$landed" || {
  echo "FAIL[put]: landed sidecar missing expected body" >&2
  cat "$landed" >&2
  exit 1
}
echo "ok[put]: sidecar landed at $landed with expected body"

# Hash-based leak detection — catches ANY write to the served-tree sidecar,
# not just one whose body happens to contain "smoke".
fixture_hash_after="$(sha256sum "$fixture_sidecar" | awk '{print $1}')"
[[ "$fixture_hash_before" == "$fixture_hash_after" ]] || {
  echo "FAIL[put]: served-tree sidecar was mutated by the PUT" >&2
  echo "  before: $fixture_hash_before" >&2
  echo "  after:  $fixture_hash_after" >&2
  exit 1
}
echo "ok[put]: served tree unchanged by PUT"

kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
server_pid=""

echo "PASS: review-server smoke"
exit_rc=0
