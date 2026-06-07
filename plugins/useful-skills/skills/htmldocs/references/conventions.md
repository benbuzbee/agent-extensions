# Conventions

Defaults for `data-*` vocabularies, IDs, and document-type schemas. If the target repo's existing docs disagree with anything here, follow the existing files — repo consistency wins.

## ID naming

- Kebab-case slug: `auth-token-bug`, `payments-architecture`, `incident-2026-05-22`.
- Unique within the file. Stable — do not rename once other docs link to it.
- For dated entries (incidents, handoffs), prefix with ISO date: `incident-2026-05-22-payments`.
- **Nested `<section>` IDs should be prefixed by the parent `<article>`'s ID** — e.g. `id="components-database"`, not `id="database"`. Only add an ID when the section is an actual link target; most aren't. The prefix prevents collisions when a generic name (`database`, `overview`, `api`) appears under multiple articles or across docs.

## `data-*` vocabularies

### `data-status` (any article that has a lifecycle)

| Value | Meaning |
|---|---|
| `open` | Known, not yet started or actively under investigation |
| `in-progress` | Work happening now |
| `blocked` | Waiting on `data-blocked-by` |
| `resolved` | Fixed; kept for history |
| `wontfix` | Decided not to address; reason in prose |

### `data-severity` (issues, bugs, risks)

| Value | Meaning |
|---|---|
| `low` | Cosmetic, minor inconvenience |
| `medium` | Degraded behavior, workaround exists |
| `high` | Major function broken, no clean workaround |
| `critical` | Production-down, data loss, security exposure |

### Relationship attributes

- `data-blocked-by="<id>"` — points to the article ID this one waits on. Use the doc-local ID; for cross-doc, use `data-blocked-by="other-file.html#issue-id"`.
- `data-depends-on="<id>"` — non-blocking dependency.
- `data-supersedes="<id>"` — this article replaces an older one.

### Ownership and dates

- `data-owner="<handle>"` — current owner (one handle, not a list).
- `data-opened="YYYY-MM-DD"` — when first logged.
- `data-resolved="YYYY-MM-DD"` — when closed (set alongside `data-status="resolved"`).

## Document-type schemas

Each doc type has a conventional top-level structure. These are starting points — add or drop sections as the content demands.

### Doc-level meta line

Every doc opens with a single `<p class="meta">` carrying `data-updated="YYYY-MM-DD"`. No `data-owner` at the document level — docs are shared. Work-item ownership (which person is handling a given bug, handoff, or task) goes on the relevant `<article>` via `data-owner`, not on the doc itself.

```html
<p class="meta" data-updated="2026-05-23">Last updated 2026-05-23</p>
```

Schemas below show additional meta attributes (`data-from`, `data-to`, `data-date`) where the doc type calls for them.

### Canonical opener

Every doc opens with the same three elements in order: an `<h1>` title, the meta line above, and a `<nav class="toc">` table of contents linking to the doc's top-level `<article>`s.

```html
<h1>Title</h1>
<p class="meta" data-updated="YYYY-MM-DD">Last updated YYYY-MM-DD</p>
<nav class="toc" aria-label="Table of contents">
  <strong>Contents</strong>
  <ol>
    <li><a href="#first-article">First article</a></li>
    <li><a href="#second-article">Second article</a></li>
  </ol>
</nav>
```

Skip the `<nav>` for very short docs (≤2–3 articles) — the headings carry enough signal on their own. Styling is left to each doc's embedded `<style>` block per the self-contained-files principle.

### `data-kind` is freeform

Several schemas below use `data-kind="components"`, `"flow"`, `"decisions"`, etc. These are illustrative — `data-kind` is freeform descriptive text. Use the noun that best names what the article holds. There is no fixed vocabulary to memorize.

### Known issues / bug log

```
<h1>Title</h1>
<nav>...table of contents...</nav>
<article id="..." data-status data-severity data-owner data-opened>
  <h2>Issue title</h2>
  <section><h3>Summary</h3>...</section>
  <section><h3>Reproduction</h3>...</section>
  <section><h3>Workaround</h3>...</section> (optional)
  <details><summary>Stack trace / logs</summary>...</details>
</article>
```

### Architecture spec

```
<h1>Component / system name</h1>
<article id="overview"><h2>Overview</h2>...inline SVG diagram...</article>
<article id="components" data-kind="components">
  <section id="..."><h3>Component</h3>...responsibilities, interfaces...</section>
  ...
</article>
<article id="data-flow" data-kind="flow">...</article>
<article id="decisions" data-kind="decisions">
  <section data-decision="..." data-date="..."><h3>Decision title</h3>...</section>
</article>
```

### Handoff

```
<h1>Handoff: <task name></h1>
<p class="meta" data-from="..." data-to="..." data-date="...">From X to Y on DATE</p>
<article id="context"><h2>Context</h2>...</article>
<article id="state" data-status>
  <h2>Current state</h2>
  <section><h3>Done</h3>...</section>
  <section><h3>In progress</h3>...</section>
  <section><h3>Not started</h3>...</section>
</article>
<article id="next-steps"><h2>Next steps</h2>...</article>
<article id="open-questions"><h2>Open questions</h2>...</article>
```

### Runbook

```
<h1>Runbook: <scenario></h1>
<aside><strong>When to use:</strong> ...trigger condition...</aside>
<article id="diagnose"><h2>Diagnose</h2>...</article>
<article id="mitigate"><h2>Mitigate</h2>...</article>
<article id="resolve"><h2>Resolve</h2>...</article>
<article id="postmortem-checklist"><h2>Postmortem checklist</h2>...</article>
```

## Safety rules

### Escape `<`, `>`, `&` inside `<pre><code>` blocks

When inserting raw logs, code snippets, or error traces that contain angle brackets or ampersands, escape them as `&lt;`, `&gt;`, `&amp;`. Otherwise the browser parses fragments like `Vec<String>` or `<MyComponent/>` as malformed HTML and the doc DOM breaks silently below that point.

```html
<!-- BAD: browser sees <String> as a tag, structure collapses -->
<pre><code>let xs: Vec<String> = Vec::new();</code></pre>

<!-- GOOD: -->
<pre><code>let xs: Vec&lt;String&gt; = Vec::new();</code></pre>
```

Applies the same way inside `<details><summary>` blocks (the content is still parsed).

### Embedding a diagram

A diagram is a `<figure data-kind="diagram">` wrapping a `<pre class="mermaid">` that holds Mermaid DSL, escaped per the rule above (`<`, `>`, `&` as `&lt; &gt; &amp;`), plus one Mermaid `<script>` per document. Full contract — figure shape, the exact script block, diagram-type table — in [`mermaid.md`](mermaid.md).

## Detecting existing conventions

Before applying these defaults, scan 1–2 existing docs and grep for the attribute keys actually in use:

```
grep -oE 'data-[a-z-]+' docs/*.html | sort -u
```

If the repo uses a different status vocabulary, ownership convention, or ID style, mirror it. Document the divergence in a `docs/CONVENTIONS.html` only if the user asks — do not create it unprompted.
