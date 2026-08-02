Hosted (Cloudflare Worker) adapter. Transport, identity, injection placement only — never rendering.

- `store.ts` — browser `HostedStore` (ICommentsStore) driving `<doc>?ref=<ref>&comments` over `fetch` with the session cookie (`credentials: 'same-origin'`): POST op envelopes (batch = a JSON array), GET to list, unwrap OpResults so the widget sees the same observable behavior as LocalFileStore. Pure transport — fetch/location/URL only, no DOM.
- `deps.ts` — `buildHostedDeps(author)` pairs HostedStore with the seed author `main.ts` read off the injected `__htmldocs_comments` seed (stamped server-side at login).
- `d1-store.ts`, `inject.ts` — DOC STUBS. The real server-side `D1Store` + `HTMLRewriter` injector live in the Worker app (`apps/htmldoc-review/src/worker/`); these just name the seams the Worker fulfils.

Change how a comment looks or the composer behaves in `review-ux/`, never here — the hosted runtime gets UX only through the shared package.
