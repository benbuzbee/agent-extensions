# Optional companions

The CLI emits `.svg` (default) and `.excalidraw` natively. Two optional add-ons cover formats outside that set and live preview.

## PNG / PDF export via `excalirender`

For SVG, prefer the native CLI path (`tsx ... cli.ts render <yaml> -o out.svg`) — crisper, no headless-browser dependency. `excalirender` remains the route for PNG and PDF.

One-time setup from `${CLAUDE_PLUGIN_ROOT}/skills/tech-diagrams/src/`:

```
pnpm run setup
```

Installs npm deps and reports whether [`excalirender`](https://github.com/JonRC/excalirender) is on PATH. If missing, prints the upstream install command for the user to run.

Then render an image directly from a YAML spec:

```
pnpm run render:image <path-to-yaml> [<out.png|.pdf>]
```

Output format is inferred from the extension; defaults to `<input>.png`. Soft-fails with an install hint if `excalirender` isn't on PATH.

## Live preview via Excalidraw's official MCP

Excalidraw publishes a hosted MCP server that streams a live canvas back into supported chat clients. Register it once:

```
claude mcp add --transport http excalidraw https://mcp.excalidraw.com
```

After the `.excalidraw` file is written, ask the client to open or render it and the MCP returns an inline canvas. Independent of this skill — skip if only the file is needed.
