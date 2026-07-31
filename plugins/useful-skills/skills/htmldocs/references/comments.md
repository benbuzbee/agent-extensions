# Review mode — the comment API

Optional capability: mount a comments widget into htmldocs pages so User can select text and leave inline notes anchored to it. You read and act on those comments over **one HTTP API** — the same call shape whether the doc is served locally or hosted on the Worker.

See `SKILL.md` § Review mode for the entry point; this file is the recipe.

## The one shape

The doc's own URL names the comment collection. Add `?comments` to it:

```
GET   <doc-url>?comments     # list every thread on this doc
POST  <doc-url>?comments     # apply one op (JSON body), or a batch (JSON array of ops)
```

`<doc-url>` is whatever URL serves the doc — a local `http://127.0.0.1:<port>/<path>` or a hosted `https://<host>/<repo>/<path>`. If the doc URL already has a `?ref=<ref>`, keep it and append `&comments`.

**Authentication.** A hosted doc requires a GitHub token with read access to the doc's repo — e.g. `-H "Authorization: Bearer $(gh auth token)"` — on every request. A locally served doc needs no auth. A caller who can't read the doc gets a plain `404`, indistinguishable from a doc that doesn't exist; the comment API never confirms a doc's existence to someone who can't see it.

## Your surface: list, resolve/reopen, delete

Read the doc's threads, then close or remove them by id. Three verbs:

```jsonc
// resolve — soft-close a thread. The row is KEPT (auditable); the widget shows it
// green and still-visible. Reversible with reopen.
{ "op": "resolve", "threadId": "<id>" }

// reopen — clear a resolve.
{ "op": "reopen", "threadId": "<id>" }

// delete — hard purge. The thread is gone for good.
{ "op": "delete", "threadId": "<id>" }
```

Prefer `resolve` over `delete` — resolve keeps the record and is reversible; reach for `delete` only when a thread should be removed outright.

```bash
# List, then resolve one thread. -H Authorization only for a hosted doc.
curl -s "$DOC_URL?comments"
curl -s -X POST "$DOC_URL?comments" \
  -H 'Content-Type: application/json' \
  --data '{"op":"resolve","threadId":"<id>"}'
```

## Reading each thread

- `root.body` — User's note.
- `anchor.exact` — the text the comment pins to.
- `anchor.sections` — grouping metadata: the `<article id>` values the selection intersected, empty when it touched none. Selections are not limited to articles — any doc text can carry a comment.
- `resolvedAt` — `null` while open; a numeric epoch-ms timestamp once resolved.
