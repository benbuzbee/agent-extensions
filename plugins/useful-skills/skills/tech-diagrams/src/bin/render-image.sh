#!/usr/bin/env bash
# Render a YAML diagram spec to a PNG/PDF image via excalirender.
# Usage: render-image.sh <input.yaml> [<output.png|.pdf>]
# Pipeline: YAML --(cli.ts)--> .excalidraw --(excalirender)--> image.
# For SVG, use `cli.ts render <yaml> -o out.svg` directly — the CLI emits
# SVG natively, no headless-browser round-trip needed.
# Output extension determines the image format; defaults to <input>.png.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: render-image.sh <input.yaml> [<output.png|.pdf>]" >&2
  exit 2
fi

if ! command -v excalirender >/dev/null 2>&1; then
  cat >&2 <<'EOF'
excalirender is not on PATH.
Install it once with:

  curl -fsSL https://raw.githubusercontent.com/JonRC/excalirender/main/install.sh | sh

Or run `pnpm run setup` from src/ for the full setup flow.
EOF
  exit 127
fi

# Resolve paths before any cd, so they work whether the user invoked us from
# src/ (via pnpm) or anywhere else.
script_dir="$(cd "$(dirname "$0")/.." && pwd)"
input_abs="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
output_arg="${2:-${1%.yaml}.png}"
output_abs="$(cd "$(dirname "$output_arg")" 2>/dev/null && pwd || pwd)/$(basename "$output_arg")"

tmp="$(mktemp -t diagram.XXXXXX).excalidraw"
trap 'rm -f "$tmp"' EXIT

(cd "$script_dir" && npx tsx cli.ts render "$input_abs" -o "$tmp") >/dev/null
excalirender "$tmp" -o "$output_abs"

echo "$output_abs"
