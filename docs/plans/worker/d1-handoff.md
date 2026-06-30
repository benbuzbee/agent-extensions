# Handoff — htmldoc-review (Deliverable 1)

_Last updated 2026-06-30. Working branch: `feat/d1-worker-proxy-auth`._

## What we're building

An org-wide way for a team to **review agent-generated HTML docs in the browser, gated by GitHub access**. A single
Cloudflare **Worker** fronts a GitHub org: it logs the viewer in via a GitHub App OAuth flow and fetches each doc from
the GitHub Contents API **as that user** — so GitHub itself is the authorization engine (a repo/file the user can't see
returns a neutral 404, no existence leak). Authentication and authorization collapse into one fetch.

- **Deliverable 1 (this work): proxy + auth.** Log in, fetch any repo/branch in the org as the user, serve the raw HTML.
- **Deliverable 2 (future): review mode.** Inject a comment UI (HTMLRewriter) + a comment store. NOT started.

Self-hosted, per-org: each org creates its **own** GitHub App (manifest flow) and runs its **own** Worker. We never hold
anyone's secret.

## Where the files are

| What | Path |
|---|---|
| **Architecture plan (HTML doc)** | `docs/plans/worker/htmldoc_worker_review.html` — the canonical design: abstractions (`OAuthProvider`/`DocSource`/`ReviewStore`), the Worker-not-Pages decision, D1/D2 split. Open in a browser. |
| **The Worker app** | `apps/htmldoc-review/` |
| ↳ portable core (no CF deps) | `apps/htmldoc-review/src/core/` — `oauth.ts`, `session.ts`, `docsource.ts`, `cookies.ts`, `responses.ts`, `config.ts`, `store.ts` |
| ↳ Cloudflare-specific | `apps/htmldoc-review/src/worker/` — `index.ts` (entry/composition root), `kv-store.ts`, `logging.ts` |
| ↳ tests | `test/core/` (vanilla vitest, node) + `test/worker/` (vitest-pool-workers + `fetch-mock.ts`) |
| ↳ setup | `apps/htmldoc-review/scripts/setup/` — `vendor.sh` (copy into an org's infra repo), `deploy.sh` (idempotent per-org deploy), `create-worker-app.mjs`; `app-manifest.json`; `wrangler.toml` |
| **Manual live checks** | `docs/plans/worker/d1-spikes.md` — the spikes that need a real GitHub App (NOT yet run) |
| **Workflow scripts (history)** | all under `docs/plans/worker/`: `d1-build-workflow.js` (built D1), `d1-review-fixes-v2.js` (review fixes round 1). `d1-review-fixes-workflow.js` is the superseded v1. |

## Locked design decisions (don't relitigate)

- **Scope:** one Worker per org; env carries only `DOC_OWNER`. Repo = first URL path segment, doc path = remainder,
  branch/tag/SHA = `?ref=` (percent-encoded; omit → GitHub serves repo default, so **no** default-branch lookup in D1).
- **Sessions:** Workers **KV** with native TTL (no Durable Object, no D1/SQL). Token + refresh token server-side; cookie
  holds only an opaque session id (single `crypto.randomUUID()`, OWASP-cited).
- **OAuth:** `arctic` for token exchange/refresh; hand-rolled signed-`state` CSRF; plain `fetch` for Contents.
- **Refresh:** silent refresh on 8h expiry; **retry-on-reread** for the race (no DO) — residual race documented & accepted.
- **Errors:** core helpers throw documented typed errors (`InvalidPathError`, `CookieParseError`); entrypoint catches +
  logs (LogTape, never secrets) + maps to response. Neutral-404 mapping preserved (no leak).
- **Logging:** LogTape, configured once in `worker/logging.ts`; a future local CLI runs its own `configure()`.
- **Helpers:** `cookie` npm package for cookie read/clear; native `Response`.

## Status — where we are

- **PR #9** (`feat/d1-worker-proxy-auth`) — D1 implementation. Stacked on **PR #8** (`docs/...plan`, the architecture doc).
- **Gate is green:** `tsc` clean, **49 tests** (core + worker projects), `wrangler deploy --dry-run` validates.
- **All 33 review comments addressed and replied to** (threaded, **not resolved** — Ben resolves as he verifies).
  Commits: `8dd37e3` (phases 0–2: tooling/moves/scope), `1694650` (phases 3–5: core quality/tests/docs).
- Tooling upgraded this pass: wrangler 4, vitest 4, vitest-pool-workers 0.16 (its built-in `fetchMock` was removed →
  local `test/worker/fetch-mock.ts` shim), generated types via `wrangler types`.

## How it went / gotchas

- The **multi-agent Workflow** harness crashed twice on `StructuredOutput retry cap exceeded` — caused by **too-strict
  output schemas** (typed `number` for comment ids + `additionalProperties:false`). Fix: loosen the schema (string ids,
  no extra-prop bans). One sub-agent still tripped it on its *return* even though its file work completed — so **verify
  files on disk, don't trust the workflow's failure status**.
- Resuming a crashed workflow: file edits are side effects not replayed from cache, so prefer **committing a green
  checkpoint** then running a fresh phases-N+ workflow over `resumeFromRunId`.
- gemini research sub-agents return Google grounding-redirect URLs, not clean doc links — fine for facts, verify before
  quoting.

## Next steps (in order)

1. **Ben finishes reviewing PR #9 replies** and resolves threads / leaves follow-ups.
2. **Run the live spikes** (`docs/plans/worker/d1-spikes.md`) — needs a real GitHub App + two test users. The load-bearing one:
   confirm GitHub returns **404 (not 403)** for a no-access private file (design collapses both to neutral 404 anyway).
   This requires: `vendor.sh` into an infra repo → create App via manifest → install on a test org →
   `scripts/setup/deploy.sh` → run spikes. First live test: vendor to `~/infrastructure/htmldocs-app/` for Boop on
   workers.dev.
   Needs a human (GitHub UI clicks + `wrangler login`).
3. **Merge order:** PR #8 first, then #9 (or GitHub auto-retargets #9 to `main` once #8 merges).
4. **Then Deliverable 2** (review mode: HTMLRewriter injection + comment store, incl. a branch *picker* UI — branch
   *selection* via `?ref=` already works in D1).
