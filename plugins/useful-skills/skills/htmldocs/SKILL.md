---
name: htmldocs
description: This skill should be used when the user asks to "update the docs", "update the html docs", "add to the docs", "make an html plan", "review the html doc", or any documentation work in a repo whose `docs/` folder (or equivalent) is HTML-based. Produces self-contained `.html` files structured for both human reading and agent-targeted parsing
---

# htmldocs

Maintain and create HTML documentation (issue logs, architecture specs, handoffs, runbooks) so the files read well for humans *and* parse predictably for downstream agents. Treat the DOM as the workspace: elements are addressable units, `data-*` attributes carry state, and the structure itself is the index.

## When to use

The target docs folder contains `.html` files. If the project uses markdown documentation, defer to the project's convention — this skill does not apply.

## Workflow

1. **Locate the docs folder.** Default is `docs/` at the repo root. If absent, ask the user where docs live before drafting.

2. **Read 1–2 existing docs first.** Try to find related ones. Match their conventions where possible. Repo consistency outweighs the defaults in this skill — if the existing files disagree with `references/conventions.md`, follow the existing files, or recommend a thoughtful upgrade.

3. **Update, review or create the doc(s).**  Following the guidelines below

## Principles

### Link, don't restate

A doc's job is structure and entry points; canonical content lives where it's authored — `SKILL.md`, upstream specs, sibling docs. When a fact already lives there, link to it rather than copying. Two copies drift the moment one is edited (single source of truth + progressive disclosure).

The same applies outward: link to related docs — the architecture spec that frames a bug, the runbook that mitigates an incident, the handoff that supersedes an open question — so a reader on one doc is one click from anything that adjusts what they take away.

### Semantic HTML5 over generic containers

Reach for `<article>`, `<section>`, `<aside>`, `<nav>`, `<details>`, `<figure>`, `<table>` before `<div>`. Each named element gives downstream agents — and humans skimming — a stable target.

- `<article>` — a distinct unit (an issue, a component, a phase). Always has an `id` and any operational `data-*` attributes.
- `<section>` — a logical phase or grouping inside an article.
- `<aside>` — warnings, callouts, tangential context.
- `<nav>` — table of contents or cross-doc links.

Use `<div>` only when no semantic element fits.

### State lives in `data-*` attributes, not prose

Anything an agent needs to read — status, severity, dependencies, owner, dates — belongs in `data-*` attributes on the relevant element. Prose can mirror the value for human readers, but the attribute is canonical.

```html
<article id="auth-token-bug" data-status="blocked" data-severity="high" data-blocked-by="issue-42" data-owner="alice">
  <h2>Auth token refresh fails after 24h</h2>
  ...
</article>
```

Default vocabularies for `data-status`, `data-severity`, and document-type schemas are in `references/conventions.md`. If existing repo docs disagree, the existing files win.

### Fold long content with `<details>`

Stack traces, raw logs, prior iterations, dense API responses — wrap them in `<details><summary>`. Humans get a scannable doc; agents still see the full content in the DOM.

```html
<details>
  <summary>Stack trace</summary>
  <pre><code>...</code></pre>
</details>
```

Inside `<pre><code>` (folded or not), escape `<`, `>`, `&` as `&lt;`, `&gt;`, `&amp;` — otherwise the browser parses fragments like `Vec<String>` as tags and the doc DOM breaks silently below that point. See `references/conventions.md` for examples.

### Tables and inline SVG for visualization

Matrices, comparisons, decision tables — native `<table>`. Architecture, flowcharts, state machines — inline `<svg>` in the document. Keep SVG simple (rectangles, arrows, labels). For diagrams beyond a few (three or so) simple shapes, htmldocs supports inline rendering of Mermaid diagrams — see `references/mermaid.md`.

### Self-contained files

Default to portable: one `<style>` block in `<head>`, no external CSS, JS, or fonts. Style for both light and dark mode via `prefers-color-scheme`. If existing repo docs already establish a style, copy theirs verbatim — consistency outweighs polish. The goal is to be mindful of the reading and portability experience, not to forbid every dependency.

## Review mode (optional)

If User wants to leave inline comments on a doc — or several related docs in the same folder — run `bash <htmldocs-skill>/serve.sh path/to/doc.html` via `Bash` with `run_in_background=true` (`<htmldocs-skill>` = this skill's root on disk). The server emits two stdout lines: `URL: …` (hand to User) and `SIDECAR_DIR: …` (an on-disk backup of the comments, for inspection). Read and act on comments through `scripts/comments-api.sh` — the read/write twin of `serve.sh` — which drives the doc's `?comments` HTTP API (`list` / `resolve` / `reopen` / `delete`), the same call shape locally or hosted; the sidecar files are storage, not the interface. Requires `node` on PATH. Full recipe in `references/comments.md`.

The review system — the `?comments` API and the injected widget, shared between the local server and the org-wide, GitHub-gated htmldoc-review Cloudflare Worker — is documented in `docs/reviewing.html`. The API and UI are the same either way; only the implementations differ (the doc calls out the local-vs-Worker split, and links the plan doc as the design record).

## References

- `references/conventions.md` — default `data-*` vocabularies, ID naming, document-type schemas, escaping rules.
- `references/examples.md` — bad/good pairs for each principle.
- `references/comments.md` — review-mode recipe: enable on a doc, run `serve.sh`, and drive comments via `scripts/comments-api.sh`, the agent's transport helper for the `?comments` API (list / resolve / reopen / delete).
- `references/mermaid.md` — use inline Mermaid to generate diagrams; read it for complex diagrams or if rendering issues come up.
