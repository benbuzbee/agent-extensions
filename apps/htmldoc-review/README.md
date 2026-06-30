# htmldoc-review (Deliverable 1: proxy + auth)

A self-hosted, **per-org** Cloudflare Worker that gates access to private HTML docs
in any repo of a GitHub org behind a GitHub **App** user-to-server OAuth login, then
proxies the requested doc from the GitHub Contents API **as that logged-in user**.

Each org creates its **own** GitHub App (via the App Manifest flow) and runs its **own**
Worker. We ship a manifest template + a wrangler-based setup script. **We never hold
anyone's client secret** — it is minted into your Cloudflare account during setup and
stored only as a Worker secret.

## The locked contract

Every install uses **exactly** these names. Do not rename them.

| Kind | Name | Notes |
| --- | --- | --- |
| KV binding | `SESSIONS` | `sess:<id>` -> `{ access_token, refresh_token, expires_at }` |
| Secret | `GITHUB_CLIENT_SECRET` | GitHub App client secret |
| Secret | `STATE_SIGNING_KEY` | HMAC key for the signed OAuth `state` nonce |
| Var | `DOC_OWNER` | GitHub org/owner this Worker is scoped to (NOT in the URL) |
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
| `GET /{repo}/{path}?ref=<branch\|tag\|sha>` (catch-all doc route) | Require a session (else `302` to `/auth/login` with a return-to). Get a valid access token (silent-refresh if the access token expired). Fetch the Contents API as the user. `200` -> raw HTML; `404`/`403` -> neutral `404`. |

The **owner is never in the URL** — it is fixed per Worker by `DOC_OWNER`. The first
URL segment is the `{repo}` (any repo in that org is addressable; the viewer's own
GitHub access is the gate), and the remainder is the doc `{path}`. The optional
`?ref=` selects a branch/tag/SHA; omit it and GitHub serves the repo's default branch.

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
DOC_OWNER   = "my-org"                            # the org/owner this Worker is scoped to
GITHUB_CLIENT_ID = "Iv1.REPLACE"                  # filled by setup after the manifest flow
CALLBACK_URL = "https://docs.my-org.dev/auth/callback"

[[routes]]
pattern = "docs.my-org.dev"
custom_domain = true
```

The `id` under `[[kv_namespaces]]` is left as `REPLACE_WITH_KV_NAMESPACE_ID`;
`scripts/setup/setup.sh` fills it.

### 2. Create the GitHub App via the App Manifest flow

You do **not** click through GitHub's App UI by hand — `scripts/setup/setup.sh`
(via `scripts/setup/create-worker-app.mjs`) drives the GitHub App Manifest flow for
you and captures just the `client_id` / `client_secret` it returns. The resulting App
has `contents: read` permission only, `public: false`, `request_oauth_on_install: true`,
and `callback_urls: [<origin>/auth/callback]`.

### 3. Install the App on your org

After the App is created, **install it** on your org (all repos, or a selected subset)
from its GitHub App page. Because `request_oauth_on_install` is on, install and OAuth
authorization happen together.

> **Confirm "User-to-server token expiration" is ON** under the App's *Optional
> features*. There is no manifest key for this; it is on by default for new apps, but
> the silent-refresh logic depends on it. If it is off, refresh tokens are never issued
> and viewers will be forced to re-login every 8 hours.

### 4. Run the setup script

```sh
./scripts/setup/setup.sh
```

This drives the whole install end to end: it runs the App Manifest flow, creates the
`SESSIONS` KV namespace and writes its id into `wrangler.toml`, does a `--dry-run`
preflight, deploys the Worker, and finally pushes the two secrets
(`GITHUB_CLIENT_SECRET` and a freshly generated `STATE_SIGNING_KEY`). See the script
itself for the exact ordering and the reasons behind it.

### 5. Use it

Browse to `https://<your-host>/{repo}/{path}` (e.g.
`https://docs.my-org.dev/handbook/guide.html`), optionally adding `?ref=<branch|tag|sha>`
to pin a non-default branch.

- The Worker fetches `{path}` from `{repo}` in `DOC_OWNER` (at `?ref=`, else the repo's
  default branch) **as you**. If GitHub returns the file, you see the raw HTML. If you
  lack access (or it does not exist), you get a neutral "Not found or no access" page —
  the two cases are indistinguishable.

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
rather than `403` for no-access). See
[d1-spikes.md](../../docs/plans/d1-spikes.md) for the manual checklist to run before
relying on this in production.
