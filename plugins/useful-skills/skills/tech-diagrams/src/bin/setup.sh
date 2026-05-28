#!/usr/bin/env bash
# One-time setup for the tech-diagrams skill.
# Installs npm deps via pnpm and reports excalirender status.
# We deliberately do NOT auto-execute the excalirender installer (which
# pipes curl into sh). If it's missing we print the upstream command so
# the user can run it themselves.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing npm dependencies via pnpm"
pnpm install

echo
if command -v excalirender >/dev/null 2>&1; then
  echo "==> excalirender already on PATH: $(command -v excalirender)"
  echo "    PNG/PDF export via 'pnpm run render:image' is ready."
  echo "    (SVG is emitted natively by 'cli.ts render <yaml> -o out.svg' — no excalirender needed.)"
else
  cat <<'EOF'
==> excalirender is NOT installed.
    SVG and .excalidraw output work without it; only PNG/PDF export is affected.

    To enable PNG/PDF export, install it (one-time, upstream command):

      curl -fsSL https://raw.githubusercontent.com/JonRC/excalirender/main/install.sh | sh

    Source: https://github.com/JonRC/excalirender
    After install, re-run this setup to confirm.
EOF
fi

echo
echo "Setup complete."
