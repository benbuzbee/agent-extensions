#!/usr/bin/env bash
# Compatibility shim — the review server CLI lives entirely in dist/serve.mjs.
# All flags and the positional target pass through; see SKILL.md § Review mode.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/dist/serve.mjs" "$@"
