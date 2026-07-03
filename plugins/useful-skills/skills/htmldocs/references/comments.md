# Review mode — the comment API

Optional capability: mount a comments widget into htmldocs pages so User can select text and leave inline notes anchored to it. You read and act on those comments over **one HTTP API** — the same call shape whether the doc is served locally or hosted on the Worker. The only thing that changes between the two is the doc's base URL (and, for a hosted doc, a GitHub bearer token). No wiring in the doc HTML; pages stay vanilla.

See `SKILL.md` § Review mode for the entry point; this file is the recipe.

## The one shape

The doc's own URL names the comment collection. Add `?comments` to it:

```
GET   <doc-url>?comments     # list every thread on this doc
POST  <doc-url>?comments     # apply one op (JSON body), or a batch (JSON array of ops)
```

`<doc-url>` is whatever URL serves the doc — a local `http://127.0.0.1:<port>/<path>` or a hosted `https://<host>/<repo>/<path>`. If the doc URL already has a `?ref=<ref>`, keep it and append `&comments`.

**Authentication.** A hosted doc requires a GitHub token with read access to the doc's repo: `Authorization: Bearer <token>` on every request. A locally served doc needs no auth. Use a bearer only when the doc URL is remote — nothing else about the recipe changes. A caller who can't read the doc gets a plain `404`, indistinguishable from a doc that doesn't exist; the comment API never confirms a doc's existence to someone who can't see it.

## Your surface: list, resolve/reopen, delete

You act on comments User already left — you do not author them. Three verbs:

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

## Recipe

1. **List.** `GET <doc-url>?comments` → `200 {"threads": [...]}`. Each thread carries `id`, `anchor.exact` (the quoted text it pins to), `root.body` (User's note), and `resolvedAt` (`null` = open, a number = already resolved).
2. **Act.** `POST <doc-url>?comments` with one op object → `200` with the op's result. Address the thread by its `id`. A `404` carrying `{"ok":false,"error":{"code":"not_found"}}` means that `threadId` doesn't exist (it was deleted or you have a stale id — re-list); a bare/neutral `404` (no such JSON body) means the doc itself is unreadable with this credential.
3. **Batch (optional).** POST a JSON *array* of op objects to close many threads in one call → `207` with `{"results": [...]}`, one result per op in request order. Best-effort: a bad op reports its own error and does not roll back the others.

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
- `anchor.sections` — the `<article id>` values the selection intersected (metadata; empty when no article was touched). Useful for grouping comments by section.
- `resolvedAt` — `null` while open; a numeric epoch-ms timestamp once resolved.

An anchor whose quoted text was later edited away is *orphaned*: it stays in the data but no longer resolves against the live doc. v1 doesn't surface orphans in the UI. If you need to find them, list the threads and check each `anchor.exact` against the current doc text. Treat orphans as advisory — confirm with User before discarding.

## Sidecar files (inspection only)

Behind a locally served doc, the server persists comments to one JSON file per doc under a server-chosen directory (printed as `SIDECAR_DIR:` on startup; see `SKILL.md`). Those files are a durable backup you can inspect or hand-edit between sessions — **not** the interface. Read and act on comments through the `?comments` API above; treat the on-disk files as storage, not the contract.
