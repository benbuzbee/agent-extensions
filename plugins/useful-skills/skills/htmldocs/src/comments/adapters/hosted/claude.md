Hosted (Cloudflare Worker) adapter. Nothing hosted-specific runs in the browser: the widget's store is the SHARED `HttpCommentsStore` (`../http-store.ts`, a pure `?comments` fetch transport built by every runtime), and its identity arrives on the injected seed like every runtime's does — the Worker stamps the session's real GitHub identity where the local server stamps the fixed local author.

- `d1-store.ts`, `inject.ts` — DOC STUBS. The real server-side `D1Store` + `HTMLRewriter` injector live in the Worker app (`apps/htmldoc-review/src/worker/`); these just name the seams the Worker fulfils.

Change how a comment looks or the composer behaves in `review-ux/`, never here — the hosted runtime gets UX only through the shared package.
