Hosted (Cloudflare Worker) adapter. Identity + injection placement only — never rendering, and (since PR8) no store of its own: the browser HTTP client is the SHARED `HttpCommentsStore` at `../http-store.ts`, built by BOTH runtimes.

- `deps.ts` — `buildHostedDeps(author)` pairs the shared `HttpCommentsStore` with the real GitHub author `main.ts` read off the injected `__htmldocs_comments` seed (stamped server-side at login).
- `d1-store.ts`, `inject.ts` — DOC STUBS. The real server-side `D1Store` + `HTMLRewriter` injector live in the Worker app (`apps/htmldoc-review/src/worker/`); these just name the seams the Worker fulfils.

The store lives one level up (`../http-store.ts`) because it is not hosted-specific — it is a pure `?comments` fetch transport shared with the local runtime. Change how a comment looks or the composer behaves in `review-ux/`, never here — the hosted runtime gets UX only through the shared package.
