# Review mode

Optional capability: mount a comments widget into htmldocs pages so User can select text and leave inline notes. Notes persist as one JSON sidecar per doc, under a server-chosen directory; you read those files directly to see what User wrote. No wiring in the doc HTML; pages on disk stay vanilla. Multi-doc sessions just work — User can navigate between docs and each carries its own sidecar.

See `SKILL.md` § Review mode for the one-liner entry point; this file is the recipe.

`<htmldocs-skill>` below denotes the on-disk path of this skill's root directory (the folder containing `SKILL.md` and `dist/serve.mjs`). Resolve it from the absolute path of this `comments.md` — strip the trailing `references/comments.md`.

## Open the doc(s) in review mode

```
node <htmldocs-skill>/dist/serve.mjs path/to/doc.html        # one doc
# or: node <htmldocs-skill>/dist/serve.mjs path/to/docs/     # serve a folder; every .html under it is reviewable
```

- node is the entry point — no shell wrapper, so the same command runs on macOS, Linux, WSL, and native Windows wherever `node` is on PATH. (`bash <htmldocs-skill>/serve.sh …` still works as a passthrough, but prefer the node form.)
- Run via `Bash` with `run_in_background=true` so the server keeps serving for the session.
- Two stdout lines on bind. Capture both:
  - `URL: http://127.0.0.1:<port>/<basename>` — hand to User verbatim.
  - `SIDECAR_DIR: <path>` — remember this; you'll need it to read comments back.
- The URL uses `127.0.0.1`, not `localhost`. On macOS `localhost` resolves to `::1` first, which can route the browser to an unrelated IPv6 listener (e.g. Docker) on the same port. Always hand User the 127.0.0.1 form.
- File arg points the URL at that file; directory arg points it at `/`. Either way, every `.html` under the served folder is reviewable.
- Sidecar dir defaults to a fresh auto-tmp directory the server creates on startup (disposable; lives until the OS cleans it). To resume comments across sessions, pass `--sidecar-dir <path>` — re-running with the same dir re-serves the prior comments.
- Requires `node` on PATH (it's the runtime). If `node` is missing the command fails to launch — surface that to User.

## What User sees

User opens the URL and starts commenting — selecting text surfaces a "Comment" button, clicking opens a composer, submitting writes to the sidecar. A margin gutter shows existing comments anchored inline. Comments persist across reloads: the server reads the sidecar from disk on each HTML response, so a fresh page always reflects the latest on-disk state. Opening the doc directly off disk (`file://…`) just renders a vanilla page — no widget, no error UI. Always route User to the `serve.sh` URL.

Two tabs against the same doc collapse to last-writer-wins — concurrent saves don't merge, but the losing tab picks up the latest on reload. Rare in practice; surface to User if it happens.

## Sidecar location and shape

One sidecar per doc, under `$SIDECAR_DIR`, mirroring each doc's path relative to the served root: `/foo.html` → `$SIDECAR_DIR/foo.comments.json`; `/sub/bar.html` → `$SIDECAR_DIR/sub/bar.comments.json`. Multi-doc sessions produce multiple sidecars — they never aggregate into one file. Shape:

```json
{
  "doc": "overview.html",
  "schema": 1,
  "comments": [
    {
      "id": "...",
      "anchor": {
        "sections": ["..."],
        "prefix": "...",
        "exact": "...",
        "suffix": "..."
      },
      "body": "the User's note",
      "author": "user",
      "created_at": "2026-05-25T00:00:00Z"
    }
  ]
}
```

## Reading comments back

Read each sidecar at `$SIDECAR_DIR/<doc-relative-path>.comments.json` directly — `Read` on the JSON path, or `cat` via `Bash`. For a multi-doc session, `find "$SIDECAR_DIR" -name '*.comments.json'` lists every sidecar that has at least one comment (the server only creates a sidecar on first save). Per comment:

- `body` — User's note.
- `anchor.exact` — the text the comment pins to.
- `anchor.sections` — array of `<article id>` values the selection intersects. One entry for a normal in-article comment; two or more when User dragged across articles; empty if no article was touched. Metadata only — the widget does not consult it when resolving the highlight back to a Range. Useful for grouping or filtering comments by article.
- `anchor.prefix` / `anchor.suffix` — surrounding text the widget uses to re-locate the anchor if the doc shifts.

Orphaned anchors (text edited out from under the anchor) remain in the sidecar JSON but v1 does not surface them in the UI. To detect them yourself, read the sidecar and try to resolve each comment's `anchor.exact` (with `prefix`/`suffix` as context) against the current doc text — anchors that no longer match are orphans. Treat orphans as advisory; confirm with User before discarding.
