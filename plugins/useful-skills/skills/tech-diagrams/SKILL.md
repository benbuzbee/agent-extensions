---
name: tech-diagrams
description: This skill should be used when the user asks to draw, render, sketch, or visualize a technical diagram — system architecture, data flow, pipeline, state machine, class hierarchy or UML, entity-relationship (ER) or schema diagram, component graph, or any boxes-and-arrows technical diagram. Example phrasings — "draw a diagram of X", "render a system diagram", "make me a flowchart", "diagram this pipeline", "draw a class diagram", "create a UML diagram", "sketch the class hierarchy", "draw an ER diagram", "create an excalidraw for X", "visualize the architecture of X", "sketch the components". Produces an .svg file by default (crisp output for embedding in docs/HTML); also supports .excalidraw for users who want to open the diagram in excalidraw.com, the VS Code Excalidraw extension, or Obsidian.
---

# tech-diagrams

Produce small-scale boxes-and-arrows diagrams — `.svg` by default (for embedding), or `.excalidraw` for editing in excalidraw.com / VS Code / Obsidian.

## Workflow

1. **Identify the genre** and read the matching guide before drafting YAML. Each guide is short and covers what nodes represent, what arrows mean, and which arrowheads to use for that genre.

   | Request shape | Genre | Read |
   |---|---|---|
   | "system diagram", "service map", "architecture" | architecture | `references/architecture.md` |
   | "pipeline", "ETL", "data flow", "flowchart" | dataflow | `references/dataflow.md` |
   | "state machine", "state diagram", "transitions" | state | `references/state.md` |
   | "class diagram", "UML class", "class hierarchy" | class | `references/class.md` |
   | "ER diagram", "schema diagram", "data model" | er | `references/er.md` |

   For requests outside these genres (Venn, mind map, gantt, sequence diagram), say so — this skill is for boxes-and-arrows only.

2. **Draft YAML** per `references/grammar.md`. Save to a temporary path (e.g. `/tmp/diagram.yaml`). Worked examples per genre: `references/examples.md`.

3. **Render** via the CLI. SVG is the default and is what you want for embedding in docs/HTML — it's emitted natively (no headless-browser dependency, no hachure):
   ```
   tsx ${CLAUDE_PLUGIN_ROOT}/skills/tech-diagrams/src/cli.ts render <path-to-yaml> -o <path-to-svg>
   ```
   Pass `--format excalidraw` (or use an `.excalidraw` extension on `-o`) when the user explicitly wants an editable Excalidraw file — e.g. to open in excalidraw.com, the VS Code extension, or Obsidian.
   - Exit 0: file is at the `-o` path. Report it.
   - Exit 1: stderr is a JSON validation error. Parse, fix the YAML, retry. Cap at 3 retries. Error codes and structure: `references/grammar.md`.
   - Exit 3: usage error (e.g. `--format` conflicts with `-o` extension).

## Defaults to keep in mind

- `direction: right`, `layout: layered`, node shape `rectangle`, edge `endArrow: arrow` and `startArrow: none`.
- Lanes (`lanes: [a, b, c]`) stack along the flow direction. With `direction: down` they're horizontal bands; with `direction: right`, vertical columns. For perpendicular swimlanes (e.g. BPMN), set direction perpendicular to the mental flow.
- Readability collapses past ~30 nodes. If the request implies more, narrow scope or split before drafting.

## Optional companions

PNG/PDF export (`excalirender`) and live preview via Excalidraw's official MCP: `references/companions.md`.

If the user keeps markdown-based notes, render with `--format excalidraw` and suggest the [Obsidian Excalidraw plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin) — it embeds `.excalidraw` files inline so the diagram lives alongside the notes that reference it.
