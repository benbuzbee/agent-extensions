# Review mode — the comment API

Optional capability: mount a comments widget into htmldocs pages so User can select text and leave inline notes anchored to it. You read and act on those comments over **one HTTP API** — the same call shape whether the doc is served locally (`serve.sh`) or hosted on the Worker. You drive it through **`scripts/comments-api.sh`**, the transport helper shipped beside `serve.sh` in this skill: `serve.sh` boots the local server, `comments-api.sh` talks to a collection. Reach for the raw HTTP form (the [appendix](#appendix-raw-http-environments-without-bash)) only where bash isn't available.

See `SKILL.md` § Review mode for the entry point; this file is the recipe.

## The helper

```
comments-api.sh list    <doc-url>
comments-api.sh resolve <doc-url> <threadId>
comments-api.sh reopen  <doc-url> <threadId>
comments-api.sh delete  <doc-url> <threadId>
comments-api.sh post    <doc-url> <op-json|->
```

`<doc-url>` is whatever URL serves the doc — a local `http://127.0.0.1:<port>/<path>` or a hosted `https://<host>/<repo>/<path>`. The helper appends the `?comments` marker for you and preserves an existing `?ref=<ref>`. It sources a GitHub token for hosted URLs only (`$GITHUB_TOKEN`, else `gh auth token`) and never touches one for a local URL. The helper is pure transport — it composes the fixed op envelopes and does no validation; the **server's** Zod layer is the validator.

**Output contract.** The raw JSON response goes to stdout untouched. `HTTP <code>` and any diagnostic go to stderr. Exit `0` on success (including a `207` batch — inspect its per-op `results` yourself); a distinct non-zero exit per failure class, each with an actionable stderr message (no token for a hosted URL, connection refused, `401`, `404`, HTML-where-JSON, bad usage). Read the header comment in `scripts/comments-api.sh` for the exit-code table.

## Your surface: list, resolve/reopen, delete

Read the doc's threads, then close or remove them by id:

```bash
comments-api.sh list    "$DOC_URL"              # 200 {"threads": [...]}
comments-api.sh resolve "$DOC_URL" "<threadId>" # soft-close: row KEPT, widget shows green, still visible
comments-api.sh reopen  "$DOC_URL" "<threadId>" # clear a resolve
comments-api.sh delete  "$DOC_URL" "<threadId>" # hard purge, gone for good
```

**Prefer `resolve` over `delete`** — resolve keeps the record (auditable) and is reversible with `reopen`; reach for `delete` only when a thread should be removed outright.

To close many threads in one call, `post` a JSON **array** of op objects — best-effort, `207` with one `results` entry per op **in request order** (the i-th result is the i-th op; a bad op reports its own error without rolling back the others). `post` is also the escape hatch for the rare deliberate exception — a single raw envelope or a batch, passed through verbatim; pass `-` to read the body from stdin.

## Reading each thread

`list` returns `{"threads": [...]}`. Per thread:

- `id` — the `threadId` you pass to resolve/reopen/delete.
- `root.body` — User's note.
- `anchor.exact` — the quoted text the comment pins to.
- `anchor.sections` — grouping metadata: the `<article id>` values the selection intersected, empty when it touched none. Selections are not limited to articles — any doc text can carry a comment.
- `resolvedAt` — `null` while open; a numeric epoch-ms timestamp once resolved.

## Appendix: raw HTTP (environments without bash)

`comments-api.sh` is a thin shell over one HTTP shape. Where you can't run it, compose the request yourself.

**URL anatomy.** The doc's own URL names the comment collection; add the bare `comments` marker:

```
GET   <doc-url>?comments          # list every thread
POST  <doc-url>?comments          # apply one op (JSON body) or a batch (JSON array)
```

If the doc URL already carries `?ref=<ref>`, keep it and append `&comments`. The op envelopes are exactly what the helper composes: `{"op":"resolve|reopen|delete","threadId":"<id>"}`.

**Authentication.** A hosted doc requires a GitHub token with read access to the repo — e.g. `-H "Authorization: Bearer $(gh auth token)"` — on every request. A locally served doc needs no auth; use a bearer only when the URL is remote.

```bash
# List, then resolve one thread. -H Authorization only for a hosted doc.
curl -s "$DOC_URL?comments"
curl -s -X POST "$DOC_URL?comments" \
  -H 'Content-Type: application/json' \
  --data '{"op":"resolve","threadId":"<id>"}'
```

**The two `404`s.** A `404` carrying `{"ok":false,"error":{"code":"not_found"}}` means that `threadId` doesn't exist (deleted, or a stale id — re-list). A bare/neutral `404` (no such JSON body) means the doc itself is unreadable with this credential: the API never confirms a doc's existence to someone who can't see it. (The helper explains this same ambiguity on its exit-`6` stderr message.)
