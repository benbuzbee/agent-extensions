#!/usr/bin/env bash
# comments-api.sh — the agent's transport helper for the htmldocs review API.
#
# This is the review server's read/write twin. `node <skill>/dist/serve.mjs`
# BOOTS a local review server; this script TALKS to a review collection (local
# or hosted) over the one
# `<doc-url>?comments` HTTP API. It is PURE TRANSPORT: it composes the URL,
# sources a token, sends the request, and translates the outcome into a raw
# JSON body on stdout plus an actionable diagnostic + distinct exit code on
# stderr. It knows nothing about op semantics beyond composing three fixed
# op envelopes (resolve/reopen/delete) — the SERVER's Zod layer is the
# validator, not this script.
#
# ── Usage ────────────────────────────────────────────────────────────────
#   comments-api.sh list    <doc-url>
#   comments-api.sh resolve <doc-url> <threadId>     # soft-close, reversible
#   comments-api.sh reopen  <doc-url> <threadId>     # clear a resolve
#   comments-api.sh delete  <doc-url> <threadId>     # hard purge
#   comments-api.sh post    <doc-url> <op-json|->    # escape hatch, see below
#
# `<doc-url>` is whatever URL serves the doc:
#   local:   http://127.0.0.1:<port>/<path>
#   hosted:  https://<host>/<repo>/<path>
# The `?comments` marker is appended for you; an existing `?ref=<ref>` is
# preserved (you get `?ref=<ref>&comments`).
#
# `post` is the deliberate-exception escape hatch: its <op-json> argument is a
# raw request body, passed through VERBATIM — a single op object
# (e.g. '{"op":"create","anchor":{"exact":"..."},"text":"..."}') OR a batch
# JSON array of op objects. Pass `-` to read the body from stdin. There is no
# `create` subcommand: v1 agents do not author comments (that is User's job via
# the widget); reach for `post` only for a deliberate, considered exception.
#
# ── The token rule (never printed, never logged, never traced) ────────────
#   * A token is sourced ONLY when the URL is NOT localhost:
#       $GITHUB_TOKEN if set, else `gh auth token`.
#   * It is attached as `Authorization: Bearer <token>` via curl's stdin
#     config file — never on the argv (so it can't leak via `ps`).
#   * All token handling runs under `set +x` (restored after), so a caller's
#     `bash -x comments-api.sh …` cannot trace it. This script never enables
#     `set -x` itself.
#   * A local URL never sources or attaches a token, even if GITHUB_TOKEN is set.
#
# ── Response / exit discipline ────────────────────────────────────────────
#   The response body is streamed to stdout UNTOUCHED (even on an HTTP error — a
#   JSON 404 body is useful). `HTTP <code>` and any diagnostic go to stderr. A
#   207 (batch) is transport SUCCESS (exit 0) — inspect the per-op `results`
#   yourself. Exit codes:
#     0  success (2xx, including a 207 batch)
#     2  usage / bad args        → synopsis, or a specific hint (e.g. bad threadId)
#     3  hosted URL but no token → detected BEFORE any request; how to fix
#     4  connection refused / unreachable (local → "start dist/serve.mjs")
#     5  HTTP 401  → token invalid or expired; re-authenticate
#     6  HTTP 404  → deliberately ambiguous (see the message)
#     7  HTML/redirect where JSON was expected → wrong URL shape / browser path
#     8  other non-2xx (e.g. 400 malformed envelope, 5xx server error)
#
# Requires: bash, curl. (`gh` only when a hosted URL needs a token.)

set -euo pipefail

# ── leak guard: token handling must never be traced by a caller's `bash -x`.
_had_x=0
case "$-" in *x*) _had_x=1 ;; esac

_body_file=""
cleanup() { [[ -n "$_body_file" ]] && rm -f "$_body_file" || true; }
trap cleanup EXIT

err() { printf '%s\n' "$*" >&2; }

usage() {
  err "usage:"
  err "  comments-api.sh list    <doc-url>"
  err "  comments-api.sh resolve <doc-url> <threadId>"
  err "  comments-api.sh reopen  <doc-url> <threadId>"
  err "  comments-api.sh delete  <doc-url> <threadId>"
  err "  comments-api.sh post    <doc-url> <op-json|->"
}

die_usage() { usage; exit 2; }

# Append the bare `comments` marker unless already present; preserve `?ref=`.
# A `#fragment` is client-side only — appending after it would hide the marker
# from the server — so it is stripped first.
compose_url() {
  local url="${1%%#*}"
  local re='[?&]comments($|[&=])'
  if [[ "$url" =~ $re ]]; then
    printf '%s' "$url"
  elif [[ "$url" == *\?* ]]; then
    printf '%s&comments' "$url"
  else
    printf '%s?comments' "$url"
  fi
}

# True when the URL's host is a loopback/local address → no token required.
is_local() {
  local url="$1"
  local re='://(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:[0-9]+)?(/|$|\?)'
  [[ "$url" =~ $re ]]
}

# $GITHUB_TOKEN, else `gh auth token`. Emits the token on stdout (callers run
# this only inside the no-trace guard). Empty output = no token available.
resolve_token() {
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    printf '%s' "$GITHUB_TOKEN"
    return 0
  fi
  if command -v gh >/dev/null 2>&1; then
    local t
    t="$(gh auth token 2>/dev/null)" || t=""
    printf '%s' "$t"
  fi
}

# Send one request and classify the outcome.
#   request <METHOD> <doc-url> <body-or-empty>
request() {
  local method="$1" raw_url="$2" body="${3:-}"
  local url token=""
  url="$(compose_url "$raw_url")"

  if ! is_local "$url"; then
    # Token sourcing + the request itself run untraced.
    set +x
    token="$(resolve_token)"
    if [[ -z "$token" ]]; then
      [[ "$_had_x" == 1 ]] && set -x
      err "comments-api.sh: no GitHub token available for a hosted doc URL."
      err "  This URL is not localhost, so a token is required to authenticate."
      err "  Fix one of:"
      err "    - Run:  gh auth login            (this script then reads \`gh auth token\`)"
      err "    - Or:   export GITHUB_TOKEN=<your-token>"
      err "  No request was sent."
      exit 3
    fi
  fi

  _body_file="$(mktemp)"
  local -a curl_args=( -sS -o "$_body_file" -w '%{http_code}\t%{content_type}' -X "$method" )
  if [[ -n "$body" ]]; then
    curl_args+=( -H 'Content-Type: application/json' --data-raw "$body" )
  fi

  local meta curl_rc
  if [[ -n "$token" ]]; then
    # Token goes in via stdin config — never on argv, never traced (set +x above).
    if meta="$(printf 'header = "Authorization: Bearer %s"\n' "$token" \
                 | curl "${curl_args[@]}" --config - "$url")"; then
      curl_rc=0
    else
      curl_rc=$?
    fi
  else
    if meta="$(curl "${curl_args[@]}" "$url" </dev/null)"; then
      curl_rc=0
    else
      curl_rc=$?
    fi
  fi
  # Token no longer referenced beyond this point — safe to restore tracing.
  token=""
  [[ "$_had_x" == 1 ]] && set -x

  # Connection-fail (4): curl couldn't complete the exchange at all.
  if (( curl_rc != 0 )); then
    err "comments-api.sh: could not connect to $url (curl exit $curl_rc)."
    err "  If this is a LOCAL doc, the review server isn't running."
    err "  Start it with:  node <skill>/dist/serve.mjs <target>   (see SKILL.md § Review mode)"
    err "  If the host is remote, check the URL and your network."
    exit 4
  fi

  local http_code content_type
  http_code="${meta%%$'\t'*}"
  content_type="${meta#*$'\t'}"

  # Stream the body to stdout untouched, then the status to stderr — always.
  cat "$_body_file"
  err "HTTP $http_code"

  # HTML/redirect (7): before status classing, so a 200-HTML browser response
  # is caught. A 3xx (we don't follow) or an html content-type always count. The
  # body-sniff is a FALLBACK, run only when the content-type is absent or not
  # application/json — otherwise a legitimate JSON payload that quotes HTML in
  # its first 512 bytes (reviewers routinely comment on HTML docs) would be
  # misread as an HTML page. Read the bytes into a var so grep can't SIGPIPE
  # `head` under pipefail.
  local looks_html=0
  if [[ "$http_code" == 3?? || "$content_type" == *text/html* ]]; then
    looks_html=1
  elif [[ "$content_type" != *application/json* ]]; then
    local body_head
    body_head="$(head -c 512 "$_body_file")"
    if grep -qiE '<!doctype html|<html[ >]' <<<"$body_head"; then
      looks_html=1
    fi
  fi
  if (( looks_html )); then
    err "comments-api.sh: expected JSON but got HTML/redirect (HTTP $http_code, content-type: ${content_type:-none})."
    err "  Likely the URL shape is wrong, or you hit the unauthenticated browser path."
    err "  The collection URL anatomy is  <doc-url>?comments  (a pinned ref becomes  <doc-url>?ref=<ref>&comments):"
    err "    local:   http://127.0.0.1:<port>/<path>?comments"
    err "    hosted:  https://<host>/<repo>/<path>?comments"
    err "  The body above is what the server actually returned."
    exit 7
  fi

  case "$http_code" in
    2??)
      exit 0
      ;;
    401)
      err "comments-api.sh: HTTP 401 — the GitHub token was rejected (invalid or expired)."
      err "  Re-authenticate:  gh auth login   (or refresh GITHUB_TOKEN), then retry."
      exit 5
      ;;
    404)
      err "comments-api.sh: HTTP 404 — deliberately ambiguous. It means ONE of:"
      err "    - the doc or thread doesn't exist,"
      err "    - you lack read access to the repo, or"
      err "    - the GitHub App isn't installed on that repo."
      err "  The API never confirms a doc's existence to a caller who can't see it, so"
      err "  these are indistinguishable by design. If a JSON body"
      err "  {\"ok\":false,...,\"code\":\"not_found\"} is above, the doc WAS readable but that"
      err "  threadId is gone — re-list. A bare/neutral 404 means the doc itself is"
      err "  unreadable with this credential."
      err "  Check: the URL (repo + path + ?ref), that you can open the doc in a browser"
      err "  while logged in, and that the GitHub App is installed on the repo."
      exit 6
      ;;
    *)
      err "comments-api.sh: HTTP $http_code — request was not successful."
      err "  The response body is above (e.g. a 400 reports a malformed envelope; 5xx is a server error)."
      exit 8
      ;;
  esac
}

# ── dispatch ──────────────────────────────────────────────────────────────
sub="${1:-}"
[[ -n "$sub" ]] || die_usage
shift

case "$sub" in
  list)
    url="${1:-}"
    [[ -n "$url" ]] || die_usage
    request GET "$url" ""
    ;;
  resolve|reopen|delete)
    url="${1:-}"
    tid="${2:-}"
    [[ -n "$url" && -n "$tid" ]] || die_usage
    # Envelope integrity (not op-semantics): a threadId is a server-minted id, so
    # constrain it to a safe charset before splicing it into the JSON body. This
    # blocks a hostile id (e.g. one carrying `","op":"delete`) from smuggling a
    # second key past `printf` and collapsing the envelope into a different op.
    if ! [[ "$tid" =~ ^[A-Za-z0-9._:-]+$ ]]; then
      err "comments-api.sh: invalid threadId — expected only [A-Za-z0-9._:-]."
      err "  Thread ids are server-minted; copy the \`id\` field from a \`list\` result verbatim."
      exit 2
    fi
    request POST "$url" "$(printf '{"op":"%s","threadId":"%s"}' "$sub" "$tid")"
    ;;
  post)
    url="${1:-}"
    [[ -n "$url" && $# -ge 2 ]] || die_usage
    body="$2"
    if [[ "$body" == "-" ]]; then
      body="$(cat)"
    fi
    request POST "$url" "$body"
    ;;
  *)
    die_usage
    ;;
esac
