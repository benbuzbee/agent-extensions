#!/usr/bin/env bash
# Serve an htmldocs directory over http://127.0.0.1 so the comments widget
# can PUT its sidecar back to disk. Every .html / .htm response under the
# served root gets the review widget injected; each doc writes to a sidecar
# JSON under a dedicated sidecar directory (auto-tmp by default, or
# `--sidecar-dir <path>` for a stable resumable location). Foreground server;
# caller decides whether to background it.
#
# stdout contract — two fixed-prefix lines, emitted in order:
#   URL: http://127.0.0.1:<port>/<basename>     (printed by this script before exec)
#   SIDECAR_DIR: <path>                          (printed by node after bind)
#
# URL uses 127.0.0.1, not `localhost`: on macOS `localhost` resolves to ::1
# first, and an IPv6 listener owned by another process (e.g. Docker) on the
# same port silently wins. The bind-test probes IPv4 only — the URL must
# match what we actually verified is free.
#
# Usage:
#   bash serve.sh path/to/doc.html             # serve the doc's dir; URL targets the doc
#   bash serve.sh path/to/dir/                 # serve the dir; URL targets the dir root
#   bash serve.sh                              # serve the current directory
#   bash serve.sh --sidecar-dir /tmp/my-review path/to/doc.html
#                                              # pin sidecars to a stable dir (resume across runs)
#
# Either invocation makes every served .html reviewable — the file form is
# just a shortcut for "serve this file's folder and point me at this file".
#
# Port: auto-finds the first free port in 8000-8099. Binds to 127.0.0.1 only.

set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "serve.sh: node not found on PATH (required to run the review server)" >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$here/dist/serve.mjs" ]]; then
  echo "serve.sh: $here/dist/serve.mjs not found — run \`npm run build\` first" >&2
  exit 1
fi

sidecar_dir_arg=""
target=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sidecar-dir)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "serve.sh: --sidecar-dir requires a non-empty path argument" >&2
        exit 1
      fi
      sidecar_dir_arg="$2"
      shift 2
      ;;
    --sidecar-dir=*)
      sidecar_dir_arg="${1#--sidecar-dir=}"
      if [[ -z "$sidecar_dir_arg" ]]; then
        echo "serve.sh: --sidecar-dir= requires a non-empty path argument" >&2
        exit 1
      fi
      shift
      ;;
    --)
      shift
      target="${1:-}"
      break
      ;;
    -*)
      echo "serve.sh: unknown flag: $1" >&2
      exit 1
      ;;
    *)
      target="$1"
      shift
      ;;
  esac
done

target="${target:-.}"
if [[ ! -e "$target" ]]; then
  echo "serve.sh: not found: $target" >&2
  exit 1
fi

if [[ -d "$target" ]]; then
  serve_dir="$target"
  basename=""
else
  serve_dir="$(dirname "$target")"
  basename="$(basename "$target")"
fi

# Resolve to absolute so node's --root is unambiguous regardless of cwd.
serve_dir="$(cd "$serve_dir" && pwd)"

port=""
for p in $(seq 8000 8099); do
  if node -e "
const net = require('net');
const s = net.createServer();
s.once('error', () => process.exit(1));
s.once('listening', () => s.close(() => process.exit(0)));
s.listen($p, '127.0.0.1');
" 2>/dev/null; then
    port="$p"
    break
  fi
done

if [[ -z "$port" ]]; then
  echo "serve.sh: no free port in 8000-8099" >&2
  exit 1
fi

echo "URL: http://127.0.0.1:${port}/${basename}"

if [[ -n "$sidecar_dir_arg" ]]; then
  exec node "$here/dist/serve.mjs" --port "$port" --root "$serve_dir" --sidecar-dir "$sidecar_dir_arg"
else
  exec node "$here/dist/serve.mjs" --port "$port" --root "$serve_dir"
fi
