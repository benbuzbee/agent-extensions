#!/usr/bin/env bash
# Thin passthrough to the self-sufficient node entry point. Kept for muscle
# memory and the smoke test; the documented invocation is now:
#
#   node <htmldocs-skill>/dist/serve.mjs path/to/doc.html
#
# node does everything this script used to: picks a free port (OS-assigned),
# resolves a file arg to serve-dir + basename, binds 127.0.0.1 only, and
# prints the two-line stdout contract:
#   URL: http://127.0.0.1:<port>/<basename>
#   SIDECAR_DIR: <path>
#
# Usage (all forwarded verbatim to serve.mjs):
#   bash serve.sh path/to/doc.html                       # serve the doc's dir; URL targets the doc
#   bash serve.sh path/to/dir/                           # serve the dir; URL targets the dir root
#   bash serve.sh                                        # serve the current directory
#   bash serve.sh --sidecar-dir /tmp/my-review doc.html  # pin sidecars to a stable dir (resume)
#   bash serve.sh --port 8080 doc.html                   # pin the port instead of OS-assigning

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

exec node "$here/dist/serve.mjs" "$@"
