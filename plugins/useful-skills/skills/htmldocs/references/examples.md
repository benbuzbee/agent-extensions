# Examples

Bad/good pairs for each principle in `SKILL.md`. Use these to illustrate a finding or sanity-check a draft.

## Link, don't restate

**Bad** — overview doc restates the canonical workflow + principles in its own words. Two files now diverge silently every time `SKILL.md` is edited:

```html
<article id="workflow">
  <h2>Workflow</h2>
  <ol>
    <li>Locate the docs folder...</li>
    <li>Read 1–2 existing docs...</li>
    <li>Update or create the doc...</li>
  </ol>
</article>
<article id="principles">
  <h2>Principles</h2>
  <!-- ...six sections paraphrased from SKILL.md... -->
</article>
```

**Good** — link to the canonical source, link outward to related context:

```html
<article id="where-the-detail-lives">
  <h2>Where the detail lives</h2>
  <ul>
    <li><a href="../SKILL.md">SKILL.md</a> — triggers, workflow, principles</li>
    <li><a href="../references/conventions.md">conventions.md</a> — vocabularies and schemas</li>
  </ul>
  <p>Related: <a href="./architecture.html">architecture spec</a>, <a href="./runbook-incident.html">incident runbook</a>.</p>
</article>
```

The rule cuts both directions: don't copy upstream content into your doc, *and* link outward to sibling docs that frame or extend yours.

## Semantic structure

**Bad** — generic containers, agents have nothing stable to target:

```html
<div class="issue blocked">
  <div class="title">Auth refresh fails</div>
  <div class="body">...</div>
</div>
```

**Good** — semantic element, stable ID, state in attributes:

```html
<article id="auth-refresh-fails" data-status="blocked" data-severity="high">
  <h2>Auth refresh fails after 24h</h2>
  <section>...</section>
</article>
```

## State in attributes, not prose

**Bad** — agent must parse natural language to learn the status:

```html
<article id="bug-42">
  <h2>Bug 42</h2>
  <p>This is currently blocked on bug 17 and is high severity.</p>
</article>
```

**Good** — canonical state in attributes; prose mirrors for humans:

```html
<article id="bug-42" data-status="blocked" data-severity="high" data-blocked-by="bug-17">
  <h2>Bug 42</h2>
  <p class="meta">Status: blocked on <a href="#bug-17">bug 17</a> · Severity: high</p>
</article>
```

## Progressive disclosure

**Bad** — 400-line log inline, doc becomes unscannable:

```html
<section>
  <h3>Error log</h3>
  <pre><code>2026-05-22 10:01:02 ERROR ...
... 400 more lines ...</code></pre>
</section>
```

**Good** — folded, but still in the DOM for agents:

```html
<section>
  <h3>Error log</h3>
  <details>
    <summary>Full log (412 lines)</summary>
    <pre><code>2026-05-22 10:01:02 ERROR ...</code></pre>
  </details>
</section>
```

## Visualization

**Bad** — boxes-and-arrows described in prose:

```html
<p>The request goes from the client to the gateway, then to the auth service,
then to the database. If auth fails, the gateway returns 401.</p>
```

**Good** — inline SVG, prose is the caption not the diagram:

```html
<figure>
  <svg viewBox="0 0 420 80" role="img" aria-label="Request flow: client → gateway → auth → db">
    <!-- four <rect>s + connecting <line>s with marker-end arrows -->
  </svg>
  <figcaption>Request flow. Gateway returns 401 if auth fails.</figcaption>
</figure>
```

For more than ~6 nodes or any non-trivial layout, render with the `tech-diagrams` skill and embed the resulting SVG instead of hand-coding.

## Portability

**Bad** — external dependency, breaks when copied or shared:

```html
<link rel="stylesheet" href="https://cdn.example.com/docs.css">
<script src="/assets/highlight.js"></script>
```

**Good** — one embedded `<style>` block, no scripts:

```html
<style>
  :root { --bg: #fff; --fg: #1a1a1a; /* ...light tokens... */ }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1115; --fg: #e6e6e6; /* ...dark tokens... */ }
  }
  body { color: var(--fg); background: var(--bg); }
</style>
```

## Escaping inside `<pre><code>`

**Bad** — raw angle brackets break the DOM parser silently from this point down:

```html
<pre><code>let xs: Vec<String> = Vec::new();
const c = <MyComponent prop={x} />;</code></pre>
```

**Good** — escape `<`, `>`, `&` as entities:

```html
<pre><code>let xs: Vec&lt;String&gt; = Vec::new();
const c = &lt;MyComponent prop={x} /&gt;;</code></pre>
```

## When updating an existing file

**Bad** — invent new attribute keys that don't match the file's existing schema:

```html
<!-- existing file uses data-status="blocked"; you add: -->
<article id="new-issue" data-state="in-flight" data-priority="P1">
```

**Good** — read the file first, match what's already in use:

```html
<article id="new-issue" data-status="in-progress" data-severity="high">
```

If you have a strong reason to extend the schema (e.g. adding `data-owner` where it didn't exist), apply it consistently across the file and note the addition in the commit message.
