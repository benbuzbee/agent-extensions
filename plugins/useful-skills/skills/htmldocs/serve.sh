#!/usr/bin/env bash
# Compatibility shim — the review server CLI lives entirely in dist/serve.mjs.
# All flags and the positional target pass through; see SKILL.md § Review mode.
# The two preflight guards turn the common broken-environment failures — no node
# on PATH, an unbuilt checkout — into one-line actionable errors instead of a raw
# `exec: node: not found` or a Node module-resolution stack trace.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "serve.sh: node not found on PATH (required to run the review server)" >&2
  exit 1
fi
if [[ ! -f "$here/dist/serve.mjs" ]]; then
  echo "serve.sh: $here/dist/serve.mjs not found — run \`npm run build\` first" >&2
  exit 1
fi

exec node "$here/dist/serve.mjs" "$@"
