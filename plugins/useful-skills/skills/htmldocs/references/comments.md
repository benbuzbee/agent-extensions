# Review mode — the comment API

Optional capability: mount a comments widget into htmldocs pages so User can select text and leave inline notes anchored to it. `serve.sh` boots the local review server; then use **`scripts/comments-api.sh`** to interact with the comments programmatically — the same helper whether the doc is served locally or hosted on the Worker.

See `SKILL.md` § Review mode for the entry point; this file is the recipe.

## The helper

| Command | What it does |
| --- | --- |
| `comments-api.sh list <doc-url>` | List every thread: `200 {"threads": [...]}` |
| `comments-api.sh resolve <doc-url> <threadId>` | Soft-close — thread kept, reversible. **Prefer over `delete`.** |
| `comments-api.sh reopen <doc-url> <threadId>` | Clear a resolve |
| `comments-api.sh delete <doc-url> <threadId>` | Hard purge, gone for good |
| `comments-api.sh post <doc-url> <op-json\|->` | Escape hatch: a raw op object or a batch (JSON array); `-` reads the body from stdin |

`<doc-url>` is whatever URL serves the doc — a local `http://127.0.0.1:<port>/<path>` or a hosted `https://<host>/<repo>/<path>`. The helper appends the `?comments` marker for you and preserves an existing `?ref=<ref>`. It sources a GitHub token for hosted URLs only (`$GITHUB_TOKEN`, else `gh auth token`) and never touches one for a local URL. The helper is pure transport.

**Output contract.** The raw JSON response goes to stdout untouched. `HTTP <code>` and any diagnostic go to stderr. Exit `0` on success.

To close many threads in one call, `post` a JSON **array** of op objects.

## Appendix: raw HTTP (environments without bash)

`comments-api.sh` is a thin shell over one HTTP shape. Where you can't run it, compose the request yourself.

A `404` with no clarifying body usually means the document is inaccessible or does not exist.
