# Mermaid diagrams

For a diagram in an htmldocs doc, author it as inline Mermaid DSL inside a `<pre class="mermaid">`; the browser renders it to SVG on open. The DSL stays in the file as the canonical, diffable source.

## How to use it

Each diagram is a `<figure data-kind="diagram">` wrapping a `<pre class="mermaid">`, with an optional `<figcaption>`. Give the figure an `id` only when it's a link or comment target.

```html
<figure id="ingest-sequence" data-kind="diagram">
  <pre class="mermaid">sequenceDiagram
  participant W as Ingest worker
  participant DB as Postgres
  W-&gt;&gt;DB: write row
  DB--&gt;&gt;W: ack</pre>
  <figcaption>Ingest path: worker writes before publishing.</figcaption>
</figure>
```

Add the one-time script **once per document** (near `</body>`) if the doc doesn't already have it — `mermaid.run()` finds every `pre.mermaid` on the page, so one script covers all diagrams:

```html
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' });
  await mermaid.run();
</script>
```

## Picking the diagram type

Choose by what you're showing. These are the types proven to render on `mermaid@11`:

| Type | Good for |
|---|---|
| `flowchart` | A multi-stage process or dataflow that branches, merges, or produces intermediate artifacts. Use `subgraph` for swimlanes/actors. |
| `stateDiagram-v2` | An entity lifecycle: states with the events and loops between them. |
| `classDiagram` | Object-oriented structure: classes, fields/methods, inheritance/association. |
| `erDiagram` | A data schema: entities, attributes, relationship cardinality. |
| `sequenceDiagram` | An ordered exchange of messages between participants over time. |
| `gantt` | A schedule of tasks with durations, dependencies, milestones. |
| `gitGraph` | Branch/merge history, release flows. |
| `mindmap` | A concept broken into a hierarchy of sub-topics. |
| `timeline` | Chronological events grouped into eras or phases. |
| `pie` | A proportional breakdown across a few categories. |

Mermaid has ~28 types total; these are the ones verified on `@11`. For the rest, see upstream (below) and confirm rendering first.

## Gotchas

- **Escape `<`, `>`, `&` as `&lt; &gt; &amp;` inside the `<pre class="mermaid">`** — htmldocs's standard pre-escaping rule. The browser decodes them back to text before Mermaid parses, so the rendered diagram is correct. E.g. a class diagram's inheritance arrow is written `Animal &lt;|-- Dog`.
- **One script per document, not per diagram.** `mermaid.run()` processes every `pre.mermaid` on the page.
- **Rendering needs network** (the CDN). Offline, the `<pre>` shows its DSL as text — a readable fallback; the same DSL also renders in a ` ```mermaid ` fenced block on GitHub/GitLab, so it's portable beyond htmldocs.
- **Pinned to `mermaid@11`.** Newer diagram types (architecture, radar, treemap, packet, etc.) may not render on this version — stick to the table above or verify before relying on one.
- **This one external script is a sanctioned exception** to htmldocs's otherwise self-contained docs — added only in docs that contain a diagram.

## Where to find more

- Worked examples of every supported genre, each with a `Good for:` note, shipped with the skill: `../docs/mermaid-gallery.html`.
- Per-diagram syntax, authoritative and current: `https://mermaid.js.org/syntax/`. Pull specifics from there rather than memorizing — syntax may have changed since training.
