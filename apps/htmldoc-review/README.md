# htmldoc-review (Deliverable 1: proxy + auth)

A self-hosted, **per-org** Cloudflare Worker that gates access to private HTML docs
in a GitHub repo behind a GitHub **App** user-to-server OAuth login, then proxies the
requested doc from the GitHub Contents API **as that logged-in user**.

Each org creates its **own** GitHub App (via the App Manifest flow) and runs its **own**
Worker. We ship a manifest template + a wrangler-based setup script. **We never hold
anyone's client secret** — it is minted into your Cloudflare account during setup and
stored only as a Worker secret.

## What this deliverable is (and is NOT)

**In scope (D1):**

1. **Login** — viewer signs in through a GitHub App user-to-server OAuth flow. The
   access/refresh tokens are stored **server-side** in Workers KV, keyed by an opaque
   session id. The browser cookie holds **only** the session id (`HttpOnly; Secure;
   SameSite=Lax`); the GitHub token never reaches the browser.
2. **Proxy** — fetch the requested doc from the GitHub Contents API as that user
   (`GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`, owner from `DOC_OWNER`).
   `200` -> serve the raw HTML. `404`/`403` -> a single **neutral** "not found or no
   access" `404` (we deliberately do **not** distinguish "missing" from "forbidden").

**Explicitly OUT of scope (these are Deliverable 2):**

- review-UI injection
- HTMLRewriter
- comment store
- Durable Objects
- D1 / SQL

Session storage is **Workers KV with native per-key TTL** — that is the entire cleanup
story. No Durable Object, no alarm, no cron, no D1.

## The locked contract

Every install uses **exactly** these names. Do not rename them.

| Kind | Name | Notes |
| --- | --- | --- |
| KV binding | `SESSIONS` | `sess:<id>` -> `{ access_token, refresh_token, expires_at }` |
| Secret | `GITHUB_CLIENT_SECRET` | GitHub App client secret |
| Secret | `STATE_SIGNING_KEY` | HMAC key for the signed OAuth `state` nonce |
| Var | `DOC_OWNER` | repo owner (NOT in the URL) |
| Var | `DOC_REPO` | repo name |
| Var | `DOC_BRANCH` | branch / `ref` |
| Var | `GITHUB_CLIENT_ID` | GitHub App client id (non-secret) |
| Var | `CALLBACK_URL` | `https://<your-host>/auth/callback` |

`GITHUB_CLIENT_ID` is a non-secret `[vars]` value (committed plaintext). The two
secrets go in via `wrangler secret put` and are never committed.

### Routes

| Route | Behavior |
| --- | --- |
| `GET /auth/login` | Mint signed `state`, set short-lived `oauth_state` cookie, redirect to GitHub authorize URL. |
| `GET /auth/callback?code=&state=` | Verify-and-burn the `state` cookie via HMAC, exchange the code, create the KV session, set the `HttpOnly/Secure/SameSite=Lax` session cookie, redirect back to the original path (or `/`). |
| `GET /auth/logout` | Delete the KV session and clear the cookie. |
| `GET /:path*` (catch-all doc route) | Require a session (else `302` to `/auth/login` with a return-to). Get a valid access token (silent-refresh if the access token expired). Fetch the Contents API as the user. `200` -> raw HTML; `404`/`403` -> neutral `404`. |

The **owner is never in the URL** (it comes from `DOC_OWNER`). Repo and branch also
come from config (`DOC_REPO` / `DOC_BRANCH`); the URL path is the doc `{path}`.

### Two-tier token expiry

- **Tier 1 — access token expired (8h):** silently refresh using the ~6-month refresh
  token, write the new tokens back to KV (GitHub **rotates** the refresh token, so the
  new one is persisted), and continue the request. The browser never notices.
- **Tier 2 — refresh token expired/revoked:** only then bounce the viewer through a
  full GitHub re-login (`302` to `/auth/login`).

The refresh decision is driven by the `expires_at` stored **inside** the KV value, not
by the KV TTL. The KV `expirationTtl` is set to the **refresh-token horizon** (~6
months), so the row never vanishes before silent refresh can run.

## Self-hosted setup walkthrough

> Prerequisites: Node 18+, a Cloudflare account with `wrangler` access, a custom domain
> on Cloudflare for this Worker, and admin rights to create a GitHub App in your org.
> `openssl` is used to generate the HMAC signing key.

### 0. Install deps

```sh
cd apps/htmldoc-review
npm install
```

> Do **not** run a bare `npm i @cloudflare/vitest-pool-workers` — npm latest (0.16.x)
> is a Vitest-4 breaking rewrite. The pinned ranges in `package.json`
> (`@cloudflare/vitest-pool-workers@^0.8.71`, `vitest@~3.2`) are hard requirements.

### 1. Fill in your config in `wrangler.toml`

Edit `[vars]` and the custom-domain `[[routes]]` for your org:

```toml
[vars]
DOC_OWNER   = "my-org"
DOC_REPO    = "private-docs"
DOC_BRANCH  = "main"
GITHUB_CLIENT_ID = "Iv1.REPLACE"                  # filled by setup after the manifest flow
CALLBACK_URL = "https://docs.my-org.dev/auth/callback"

[[routes]]
pattern = "docs.my-org.dev"
custom_domain = true
```

The `id` under `[[kv_namespaces]]` is left as `REPLACE_WITH_KV_NAMESPACE_ID`; `setup.sh`
fills it.

### 2. Create the GitHub App via the App Manifest flow

You do **not** click through GitHub's App UI by hand — `setup.sh` runs the manifest
flow for you (`create-app.mjs`):

1. It generates a CSRF `state` nonce and renders `app-manifest.json` with your org
   substituted, then opens an auto-submitting form that POSTs the manifest to
   `https://github.com/organizations/<ORG>/settings/apps/new?state=<nonce>`
   (or `https://github.com/settings/apps/new` for a personal account).
2. GitHub redirects back to `/manifest/callback?code=&state=`. The helper verifies the
   state and **immediately** (within GitHub's 1-hour, single-use window) POSTs
   `https://api.github.com/app-manifests/<code>/conversions`.
3. On `201` it extracts **only** `client_id` and `client_secret` (the App's `id`, pem,
   and webhook secret are discarded — unused in D1, and returned only once).

The App is created with `contents: read` permission only, `public: false`,
`request_oauth_on_install: true`, and `callback_urls: [<origin>/auth/callback]`.

### 3. Install the App on your org

After the App is created, **install it** on your org (or the specific repo named by
`DOC_REPO`) from its GitHub App page. Because `request_oauth_on_install` is on, install
and OAuth authorization happen together.

> **Confirm "User-to-server token expiration" is ON** under the App's *Optional
> features*. There is no manifest key for this; it is on by default for new apps, but
> the silent-refresh logic depends on it. If it is off, refresh tokens are never issued
> and viewers will be forced to re-login every 8 hours.

### 4. Run `setup.sh`

```sh
./setup.sh
```

It performs, in order:

1. **Create-app** — the manifest flow above, capturing `GITHUB_CLIENT_ID` /
   `GITHUB_CLIENT_SECRET`.
2. **Create the KV namespace** — `npx wrangler kv namespace create SESSIONS`, parse the
   32-hex id from stdout, and `sed` it into the `[[kv_namespaces]]` id placeholder in
   `wrangler.toml` (stable wrangler does not auto-edit config).
3. **Preflight** — `npx wrangler deploy --dry-run --outdir dist` (bundle + config
   validation; does not validate secrets or the live KV id).
4. **First deploy** — `npx wrangler deploy` (creates the live Worker + KV binding; this
   must exist before secrets can be put).
5. **Secrets** — pipe each value via stdin (`printf %s` to avoid a trailing newline):

   ```sh
   printf %s "$GITHUB_CLIENT_SECRET" | npx wrangler secret put GITHUB_CLIENT_SECRET
   printf %s "$(openssl rand -base64 32)" | npx wrangler secret put STATE_SIGNING_KEY
   ```

   Each `secret put` redeploys a new version, which is why they run **after** the first
   deploy.

### 5. Use it

Browse to `https://<your-host>/<path-to-doc>.html` (e.g.
`https://docs.my-org.dev/guide.html`).

- No session -> you are redirected to `/auth/login`, through GitHub, and back to the
  doc you asked for.
- The Worker fetches that doc from `DOC_REPO@DOC_BRANCH` **as you**. If GitHub returns
  the file, you see the raw HTML. If you lack access (or it does not exist), you get a
  neutral "Not found or no access" page — the two cases are indistinguishable.

## Running tests locally

Tests use `@cloudflare/vitest-pool-workers` (the real `workerd` runtime with local KV
and mockable outbound fetch). **Tests never hit real GitHub and need no real
credentials** — the GitHub fetches (Contents API + token endpoint) are mocked to return
canned `200`/`404`/`403`/token responses.

```sh
# one-time: provide FAKE local secrets so wrangler dev / vitest never need real ones
cp .dev.vars.example .dev.vars      # gitignored; holds fake GITHUB_CLIENT_SECRET + STATE_SIGNING_KEY

npm test          # vitest run — the full proxy + auth suite
npm run typecheck # tsc --noEmit
```

`vitest.config.ts` inherits this Worker's real bindings (KV `SESSIONS` and all `[vars]`)
from `wrangler.toml`, and `isolatedStorage` (default) resets KV between tests. The suite
calls `fetchMock.activate()` + `disableNetConnect()` in `beforeAll` and
`fetchMock.assertNoPendingInterceptors()` in `afterEach`, so it can never reach real
GitHub and any unused mock fails loudly.

> `arctic` runs on `workerd` with Fetch + Web Crypto only — **do not** add
> `nodejs_compat` to `wrangler.toml`.

## Manual / pre-ship checks

Some things cannot be verified by the unattended test suite (e.g. a live GitHub
intersection returning a real `200`/`404`, and confirming GitHub actually returns `404`
rather than `403` for no-access). See [SPIKES.md](./SPIKES.md) for the manual checklist
to run before relying on this in production.
