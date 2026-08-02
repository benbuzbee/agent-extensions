#!/usr/bin/env bash
# Smoke test for ../../scripts/comments-api.sh — the agent transport helper.
# Drives the helper against the REAL local review server (booted via
# node dist/serve.mjs) and a dumb static server, asserting the
# documented exit code + stderr
# contract for each failure class, and proving the token never leaks under
# `bash -x`.
#
# Bash + curl + grep only (no jq) — mirrors the serve smoke's posture and boot/
# teardown harness, kept off the Playwright runner so it stays a fast pre-flight
# check on the script-as-shipped.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_root="$(cd "$here/../.." && pwd)"
cd "$skill_root"

api="scripts/comments-api.sh"
tmp_dir="$(mktemp -d)"
server_pid=""
http_pid=""
exit_rc=1
cleanup() {
  exit_rc=$?
  for pid in "$server_pid" "$http_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$tmp_dir"
  exit "$exit_rc"
}
trap 'cleanup' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# Run the helper capturing stdout/stderr/exit without tripping `set -e`.
# Sets globals: RC, OUT (stdout), ERRTXT (stderr).
run_api() {
  local out_f="$tmp_dir/o" err_f="$tmp_dir/e"
  set +e
  bash "$api" "$@" >"$out_f" 2>"$err_f"
  RC=$?
  set -e
  OUT="$(cat "$out_f")"
  ERRTXT="$(cat "$err_f")"
}

# ── 1. Syntax ──────────────────────────────────────────────────────────────
bash -n "$api" || fail "bash -n $api"
echo "ok: bash -n clean"

# ── 2. Usage / bad args → exit 2 + synopsis ─────────────────────────────────
run_api
[[ "$RC" == 2 ]] || fail "bare invocation → $RC (want 2)"
grep -q 'usage:' <<<"$ERRTXT" || fail "bare invocation: no synopsis on stderr"
run_api resolve "http://127.0.0.1:9/x.html"   # threadId omitted
[[ "$RC" == 2 ]] || fail "resolve w/o threadId → $RC (want 2)"
grep -q 'usage:' <<<"$ERRTXT" || fail "resolve w/o threadId: no synopsis"
# A hostile threadId must be rejected BEFORE any request (envelope integrity),
# so a JSON-injection id can't collapse resolve into an irreversible delete.
run_api resolve "http://127.0.0.1:9/x.html" '","op":"delete'
[[ "$RC" == 2 ]] || fail "hostile threadId → $RC (want 2)"
grep -qi 'invalid threadId' <<<"$ERRTXT" || fail "hostile threadId: missing rejection message"
[[ -z "$OUT" ]] || fail "hostile threadId: no request should have fired (stdout non-empty)"
echo "ok: usage errors + hostile threadId → exit 2"

# ── 3. Connection refused (local) → exit 4 ──────────────────────────────────
run_api list "http://127.0.0.1:9/index.html"
[[ "$RC" == 4 ]] || fail "connection refused → $RC (want 4)"
grep -qi "server isn't running" <<<"$ERRTXT" || fail "conn-refused: missing server-not-running hint"
grep -q 'serve.mjs' <<<"$ERRTXT" || fail "conn-refused: missing serve.mjs guidance"
[[ -z "$OUT" ]] || fail "conn-refused: stdout should be empty"
echo "ok: connection refused → exit 4, serve.mjs guidance"

# ── 4. Hosted URL without token → exit 3, no request fired ──────────────────
# PATH-prepend a failing `gh` stub + empty GITHUB_TOKEN + a non-localhost URL.
stub_bin="$tmp_dir/bin"
mkdir -p "$stub_bin"
printf '#!/usr/bin/env bash\nexit 1\n' >"$stub_bin/gh"
chmod +x "$stub_bin/gh"
set +e
GITHUB_TOKEN="" PATH="$stub_bin:$PATH" bash "$api" list "https://example.invalid/repo/doc.html" \
  >"$tmp_dir/o" 2>"$tmp_dir/e"
RC=$?
set -e
ERRTXT="$(cat "$tmp_dir/e")"
[[ "$RC" == 3 ]] || fail "hosted-no-token → $RC (want 3)"
grep -q 'gh auth login' <<<"$ERRTXT" || fail "hosted-no-token: missing gh auth login fix"
grep -q 'GITHUB_TOKEN' <<<"$ERRTXT" || fail "hosted-no-token: missing GITHUB_TOKEN fix"
grep -qi 'No request was sent' <<<"$ERRTXT" || fail "hosted-no-token: should state no request fired"
echo "ok: hosted URL without token → exit 3 (preflight), actionable fix"

# ── 5. HTML-where-JSON → exit 7 (dumb static server ignoring ?comments) ─────
http_port=""
for p in $(seq 8100 8199); do
  if node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.once('listening',()=>s.close(()=>process.exit(0)));s.listen($p,'127.0.0.1');" 2>/dev/null; then
    http_port="$p"; break
  fi
done
[[ -n "$http_port" ]] || fail "no free port for http-server"
node_modules/.bin/http-server test/fixtures/clean -a 127.0.0.1 -p "$http_port" >/dev/null 2>&1 &
http_pid=$!
for _ in $(seq 1 50); do
  curl -fs -o /dev/null "http://127.0.0.1:$http_port/index.html" 2>/dev/null && break
  kill -0 "$http_pid" 2>/dev/null || fail "http-server died before ready"
  sleep 0.1
done
run_api list "http://127.0.0.1:$http_port/index.html"
[[ "$RC" == 7 ]] || fail "HTML-where-JSON → $RC (want 7)"
grep -qi 'expected JSON but got HTML' <<<"$ERRTXT" || fail "HTML case: missing wrong-shape message"
grep -q '?comments' <<<"$ERRTXT" || fail "HTML case: missing URL anatomy"
kill "$http_pid" 2>/dev/null || true
wait "$http_pid" 2>/dev/null || true
http_pid=""
echo "ok: HTML-where-JSON → exit 7, URL anatomy shown"

# ── 6. Round-trip + non-2xx passthrough against the REAL local server ───────
out_file="$tmp_dir/serve.out"
err_file="$tmp_dir/serve.err"
node dist/serve.mjs "test/fixtures/clean/" >"$out_file" 2>"$err_file" &
server_pid=$!
for _ in $(seq 1 50); do
  grep -q '^URL: ' "$out_file" && break
  kill -0 "$server_pid" 2>/dev/null || { cat "$err_file" >&2; fail "serve.mjs died before URL"; }
  sleep 0.1
done
base_url="$(grep -m1 '^URL: ' "$out_file" | sed 's/^URL: //')"
doc_url="${base_url}index.html"
for _ in $(seq 1 50); do
  curl -fs -o /dev/null "$base_url" 2>/dev/null && break
  kill -0 "$server_pid" 2>/dev/null || fail "serve.mjs died before accepting requests"
  sleep 0.1
done

# post a create envelope (escape hatch — the agent verb set has no create).
seed='{"op":"create","anchor":{"sections":["alpha"],"prefix":"The ","exact":"quick brown fox","suffix":" jumps"},"text":"api-smoke"}'
run_api post "$doc_url" "$seed"
[[ "$RC" == 0 ]] || fail "post create → $RC (want 0); stderr: $ERRTXT"
grep -q '"op":"create"' <<<"$OUT" || fail "post create: response missing op:create"
tid="$(grep -o '"id":"[^"]*"' <<<"$OUT" | head -1 | sed 's/.*"id":"//;s/"//')"
[[ -n "$tid" ]] || fail "post create: could not extract thread id"
echo "ok: post create → 200, tid=$tid"

run_api list "$doc_url"
[[ "$RC" == 0 ]] || fail "list → $RC (want 0)"
grep -q "\"id\":\"$tid\"" <<<"$OUT" || fail "list: created thread not present"
echo "ok: list → 200 contains the thread"

run_api resolve "$doc_url" "$tid"
[[ "$RC" == 0 ]] || fail "resolve → $RC (want 0)"
grep -qE '"resolvedAt":[0-9]+' <<<"$OUT" || fail "resolve: resolvedAt not a number"
echo "ok: resolve → 200, resolvedAt is a number"

run_api reopen "$doc_url" "$tid"
[[ "$RC" == 0 ]] || fail "reopen → $RC (want 0)"
grep -q '"resolvedAt":null' <<<"$OUT" || fail "reopen: resolvedAt not null"
echo "ok: reopen → 200, resolvedAt back to null"

# non-2xx passthrough: delete a bogus id → HTTP 404 → exit 6, JSON body intact.
run_api delete "$doc_url" "does-not-exist"
[[ "$RC" == 6 ]] || fail "delete bogus → $RC (want 6)"
grep -q '"code":"not_found"' <<<"$OUT" || fail "delete bogus: not_found body not on stdout untouched"
grep -qi 'deliberately ambiguous' <<<"$ERRTXT" || fail "delete bogus: missing 404-ambiguity message"
echo "ok: delete bogus → exit 6, JSON body untouched on stdout"

run_api delete "$doc_url" "$tid"
[[ "$RC" == 0 ]] || fail "delete real → $RC (want 0)"
grep -q "\"threadId\":\"$tid\"" <<<"$OUT" || fail "delete real: body missing threadId echo"
run_api list "$doc_url"
[[ "$RC" == 0 ]] || fail "final list → $RC (want 0)"
grep -q "\"id\":\"$tid\"" <<<"$OUT" && fail "final list: deleted thread still present"
echo "ok: delete real → 200, thread gone from list"

# ── 6b. HTML markup inside a JSON body must NOT trip the exit-7 HTML sniff ───
# A 200 application/json list whose thread text quotes '<!doctype html' is a
# SUCCESS — reviewers routinely comment on HTML docs. The body-sniff must not
# misclassify it. Seed such a thread, then list and assert exit 0.
html_seed='{"op":"create","anchor":{"exact":"quick brown fox"},"text":"the <!doctype html declaration is missing"}'
run_api post "$doc_url" "$html_seed"
[[ "$RC" == 0 ]] || fail "post create w/ HTML in body → $RC (want 0); stderr: $ERRTXT"
grep -qi 'expected JSON but got HTML' <<<"$ERRTXT" && fail "post w/ HTML body: false exit-7 HTML-sniff positive"
html_tid="$(grep -o '"id":"[^"]*"' <<<"$OUT" | head -1 | sed 's/.*"id":"//;s/"//')"
run_api list "$doc_url"
[[ "$RC" == 0 ]] || fail "list w/ HTML-quoting thread → $RC (want 0, not the exit-7 sniff); stderr: $ERRTXT"
grep -qi 'expected JSON but got HTML' <<<"$ERRTXT" && fail "list w/ HTML body: false exit-7 HTML-sniff positive"
if [[ -n "$html_tid" ]]; then run_api delete "$doc_url" "$html_tid"; fi   # cleanup
echo "ok: HTML markup inside a JSON comment body does not trip the exit-7 sniff"

# ── 7. URL-compose double-marker guard doesn't misfire on a ?ref value ──────
# A ref value containing the substring 'comments' must still get &comments.
run_api list "${doc_url}?ref=has-comments-in-it"
[[ "$RC" == 0 ]] || fail "?ref w/ 'comments' substring → $RC (want 0; the &comments marker must still be appended)"
echo "ok: ?ref value containing 'comments' still gets the &comments marker"

# A #fragment must be stripped before the marker is appended — otherwise the
# marker lands inside the fragment and never reaches the server.
run_api list "${doc_url}#some-section"
[[ "$RC" == 0 ]] || fail "URL w/ #fragment → $RC (want 0; fragment must be stripped, marker still sent)"
grep -q '"threads"' <<<"$OUT" || fail "URL w/ #fragment: no threads JSON (marker was lost)"
echo "ok: #fragment is stripped; ?comments marker still reaches the server"

# ── 8. Token non-leak under bash -x, on a local AND a remote path ───────────
canary="SENTINEL_ghp_LEAKCANARY_$$"
# local: token present in env but NOT attached (local URL) → must not appear.
set +e
GITHUB_TOKEN="$canary" bash -x "$api" list "$doc_url" >"$tmp_dir/lo" 2>"$tmp_dir/le"
set -e
grep -q "$canary" "$tmp_dir/lo" && fail "LEAK: canary on stdout (local path)"
grep -q "$canary" "$tmp_dir/le" && fail "LEAK: canary on stderr/trace (local path)"
# remote: token IS attached, request fails at DNS → must still not appear.
set +e
GITHUB_TOKEN="$canary" bash -x "$api" list "https://example.invalid/r/d.html" >"$tmp_dir/ro" 2>"$tmp_dir/re"
set -e
grep -q "$canary" "$tmp_dir/ro" && fail "LEAK: canary on stdout (remote path)"
grep -q "$canary" "$tmp_dir/re" && fail "LEAK: canary on stderr/trace (remote path)"
echo "ok: token never leaks under bash -x (local + remote paths)"

kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
server_pid=""

echo "PASS: comments-api.sh smoke"
exit_rc=0
