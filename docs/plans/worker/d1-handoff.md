# Handoff — htmldoc-review (Deliverable 1)

_Last updated 2026-06-30. Working branch: `feat/d1-worker-proxy-auth`._

> **⚡ ACTIVE: live on Cloudflare, debugging a 404.** The Worker is deployed at
> **`https://htmldoc-review.myboop.workers.dev`** for the `myboop-ai` org. Login/OAuth works.
> But fetching a real doc returns the neutral 404 — see **"Open problem"** below. That's the
> next thing to debug after compaction.

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
| ↳ setup | `apps/htmldoc-review/scripts/setup/` — `vendor.sh` (copy into an org's infra repo), `deploy.sh` (idempotent, deploy-first), `create-worker-app.mjs` (builds the GitHub App manifest inline); `wrangler.toml` |
| **Manual live checks** | `docs/plans/worker/d1-spikes.md` — the spikes that need a real GitHub App (NOT yet run) |
| **Workflow scripts (history)** | all under `docs/plans/worker/`: `d1-build-workflow.js` (built D1), `d1-review-fixes-v2.js` (review fixes round 1). `d1-review-fixes-workflow.js` is the superseded v1. |

## Locked design decisions (don't relitigate)

- **Scope:** one Worker per org; env carries only `REPO_ORG` (renamed from `DOC_OWNER` to match the `Config.repoOrg`
  field). Repo = first URL path segment, doc path = remainder, branch/tag/SHA = `?ref=` (percent-encoded; omit → GitHub
  serves repo default, so **no** default-branch lookup in D1).
- **Setup model = vendor-then-deploy, deploy-first.** Operators don't run from the upstream repo: `vendor.sh <dest>`
  copies the app into their own infra repo (stamps `PROVENANCE.md`, preserves their `wrangler.toml` on re-vendor via a
  `wrangler.toml.upstream` sidecar). `deploy.sh` is idempotent and **deploy-first**: it deploys to learn the workers.dev
  URL, derives `CALLBACK_URL`, then creates the GitHub App with that URL baked into `callback_urls` (no manual settings
  edit). Manifest is built **inline** in `create-worker-app.mjs` (static `app-manifest.json` deleted); its `redirect_url`
  is the script's own localhost (setup-only), `callback_urls` = the Worker URL (runtime).
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
- **All review comments addressed and replied to** across two rounds (threaded, **not resolved** — Ben resolves as he
  verifies). Latest commits on the branch: `caec862` (greedy-sed fix), `a0e620e` (deploy-first + inline manifest +
  REPO_ORG rename), plus earlier vendor/typegen/auth fixes.
- **LIVE on Cloudflare** for `myboop-ai` at `https://htmldoc-review.myboop.workers.dev` (account: ben@myboop.ai). KV
  namespace `9348cc07d10b4492bd82ced883775ecb`; workers.dev subdomain `myboop` (registered via CF API); GitHub App
  `htmldoc-review-myboop-ai` client_id `Iv23liEYVbiPqEA9biIQ`; both secrets pushed. OAuth verified end-to-end
  (`/auth/login` → GitHub authorize with correct client_id + redirect_uri; state cookie HttpOnly/Secure/SameSite=Lax).

## ⛔ Open problem — doc fetch returns neutral 404 ("Not found or no access")

After a **successful login**, requesting a real doc returns the neutral 404 page ("Not found or no access"):
`https://htmldoc-review.myboop.workers.dev/internal-automation/docs/plans/bugbash_add_web_backend.html`
(the file exists on `myboop-ai/internal-automation@main`, confirmed via `git ls-tree origin/main`).

"Not found or no access" is OUR `neutral()` response (`src/core/responses.ts`) — so the request DID reach `fetchDoc`
and the GitHub Contents API returned non-200 (not a routing/parse error). Most likely causes, in order to check:
1. **App not installed on the org** (most likely): creating the App ≠ installing it. A user token only grants
   App-perms ∩ user-perms ∩ **installed repos**; if `htmldoc-review-myboop-ai` isn't installed on `myboop-ai` (or
   `internal-automation` isn't in its repo selection), Contents returns 404. → Install the App on the org, all/selected
   repos. (Was about to check `gh api orgs/myboop-ai/installations` when we compacted.)
2. **Token scope / Accept header**: `fetchDoc` sends `Accept: application/vnd.github.raw+json` + `Authorization: Bearer`.
   Confirm the user-to-server token actually carries `contents:read` and that raw media type is honored.
3. **Path/ref**: repo=`internal-automation`, docPath=`docs/plans/bugbash_add_web_backend.html`, no `?ref=` → default
   branch `main`. Looks right; rule out by curling the GitHub Contents API directly with the same token.

**How to debug:** `wrangler tail` while hitting the URL logged-in — the worker logs `doc denied {status}` (see
`serveDoc` in `worker/index.ts`), which reveals the exact GitHub status (404 vs 403 vs 401). That single number
disambiguates install-not-done (404) vs token/scope (403/401).

- Tooling upgraded earlier this work: wrangler 4, vitest 4, vitest-pool-workers 0.16 (built-in `fetchMock` removed →
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
- **Live deploy caught 6 setup bugs the gate couldn't** (all fixed + committed): `.wrangler/` leaking into vendored
  copies; re-vendor clobbering the operator's `wrangler.toml`; `wrangler types` needs `.dev.vars` to exist BEFORE it
  runs (else Env missing secret keys); `.dev.vars.example` was caught by the `.dev.vars*` gitignore glob (untracked);
  `wrangler whoami` exits 0 even when logged out (match output, not exit code); greedy `sed` (`"= ".*""`) swallowed
  through a comment's quotes and corrupted the toml → use `"[^"]*"`.
- **Two Cloudflare ACCOUNT-level gates** (not our code) blocked the first deploys: unverified account email; and no
  workers.dev subdomain provisioned. Registered the subdomain programmatically: `PUT /accounts/{id}/workers/subdomain`
  with the wrangler OAuth token (`{"subdomain":"myboop"}`).
- **GitHub App Manifest flow facts** (researched + grounded): `redirect_url` is setup-only (one-time `?code=` capture,
  localhost is idiomatic — Probot does it); `callback_urls` is the persistent runtime OAuth callback, editable in the
  App settings UI (add AND remove, up to 10) but **no REST/GraphQL API** to update post-creation; on domain change the
  new callback must be FIRST (install flow ignores `redirect_uri` and uses the first listed). API version pin moved to
  `2026-03-10` (verified disjoint from the manifest-conversions endpoint).

## Next steps (in order)

1. **DEBUG THE 404 (top priority).** See "Open problem" above. Start with `wrangler tail` on the live worker while
   hitting the doc URL logged-in to read the exact GitHub status, then almost certainly **install the GitHub App on
   `myboop-ai`** (all repos, or at least `internal-automation`). The vendored, deployed copy lives at
   `~/infrastructure/htmldocs-app/` (provenance commit recorded in its `PROVENANCE.md`).
2. **Ben finishes reviewing PR #9 replies** and resolves threads / leaves follow-ups.
3. **`deploy.sh` hardening (deferred, agreed):** pre-check the workers.dev subdomain (register via the API call above or
   print the instruction) and guard the discovery deploy so a failed/empty-URL deploy stops with a readable message
   instead of leaving `CALLBACK_URL` a placeholder.
4. **Merge order:** PR #8 first, then #9 (or GitHub auto-retargets #9 to `main` once #8 merges).
5. **Then Deliverable 2** (review mode: HTMLRewriter injection + comment store, incl. a branch *picker* UI — branch
   *selection* via `?ref=` already works in D1).
