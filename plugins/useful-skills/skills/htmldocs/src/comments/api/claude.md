Runtime-agnostic comment API — pure business logic, imported by both the local
server (serve.ts) and the worker (apps/htmldoc-review, via its `@shared/*` path
alias); it is NOT part of main.ts's widget-bundle graph, so `zod` never enters
dist/comments.mjs.

Sharing contract:
- May reference ONLY `review-ux/` types + `review-ux/store` (ICommentsStore) and,
  in schemas.ts alone, `zod` (imported from `zod/mini`).
- MUST NOT reference fs, http, DOM, GitHub, Cloudflare, or D1. No transport, no
  identity minting.
- Author arrives as a parameter, NEVER read from the request body.
- schemas.ts is the ONLY zod importer and the ONLY place branded ids are minted
  from raw strings (asThreadId/asCommentId), applied exactly once at the parse
  boundary.
- thread-ops.ts holds the pure, immutable op semantics (create/resolve/reopen/
  delete, idempotency) shared by BOTH stores — the single source of truth that
  kills store drift.
