# htmldoc-review (Deliverable 1: proxy + auth)

A self-hosted, **per-org** Cloudflare Worker that gates access to private HTML docs
in any repo of a GitHub org behind a GitHub **App** user-to-server OAuth login, then
proxies the requested doc from the GitHub Contents API **as that logged-in user**.

Each org creates its **own** GitHub App (via the App Manifest flow) and runs its **own**
Worker. We ship a manifest template + a wrangler-based setup script. **We never hold
anyone's client secret** — it is minted into your Cloudflare account during setup and
stored only as a Worker secret.

## What it does

This Worker implements GitHub App user-to-server OAuth login, then serves docs by
fetching them **as the logged-in user** from `GET /{repo}/{path}?ref=<branch|tag|sha>`.
The org owner is fixed per Worker (`DOC_OWNER`) and is never in the URL; the first URL
segment is the `{repo}` and the rest is the doc `{path}`. Omit `?ref=` and GitHub serves
the repo's default branch. A request with no valid session is bounced through login;
files the viewer can't see (or that don't exist) return a neutral `404` so the two cases
are indistinguishable.

### Config (env + bindings)

Every install uses **exactly** these names — do not rename them.

| Kind | Name | Notes |
| --- | --- | --- |
| Var | `DOC_OWNER` | GitHub org/owner this Worker is scoped to (NOT in the URL) |
| Var | `GITHUB_CLIENT_ID` | GitHub App client id (non-secret `[vars]`, committed plaintext) |
| Var | `CALLBACK_URL` | `https://<your-host>/auth/callback` |
| Secret | `GITHUB_CLIENT_SECRET` | GitHub App client secret (via `wrangler secret put`) |
| Secret | `STATE_SIGNING_KEY` | HMAC key for the signed OAuth `state` nonce (via `wrangler secret put`) |
| KV binding | `SESSIONS` | server-side session store, native per-key TTL |

## Self-hosted setup walkthrough

> Prerequisites: Node 18+, a Cloudflare account with `wrangler` access, and admin rights
> to create a GitHub App in your org. `openssl` is used to generate the HMAC signing key.
> **No custom domain or DNS is required for the quick start** — you deploy to the free
> `*.workers.dev` subdomain first and can promote to a custom domain later.

The quick start deploys to your free `*.workers.dev` subdomain. Your Worker URL will be
`https://htmldoc-review.<your-subdomain>.workers.dev`, and both `CALLBACK_URL` and the
GitHub App's callback URL use that same `workers.dev` origin.

### 0. Install deps

```sh
cd apps/htmldoc-review
npm install
```

> Do **not** run a bare `npm i @cloudflare/vitest-pool-workers` — npm latest (0.16.x)
> is a Vitest-4 breaking rewrite. The pinned ranges in `package.json`
> (`@cloudflare/vitest-pool-workers@^0.8.71`, `vitest@~3.2`) are hard requirements.

### 1. Fill in your config in `wrangler.toml`

Set `DOC_OWNER` to your org slug. Leave `GITHUB_CLIENT_ID` and the KV namespace `id` as
their placeholders — the setup script fills both. Set `CALLBACK_URL` to your
`workers.dev` origin once you know your subdomain (it is
`https://htmldoc-review.<your-subdomain>.workers.dev/auth/callback`); you can deploy
once to discover the subdomain, then set this and redeploy.

### 2. Run the setup script

```sh
./scripts/setup/setup.sh
```

This drives the whole install end to end: the App Manifest flow (which mints the
`client_id`/`client_secret` and registers the callback URL), the `SESSIONS` KV
namespace, a `--dry-run` preflight, the first deploy, and pushing the two secrets. See
the script itself for the exact ordering and the reasons behind it.

### 3. Install the App on your org

After the App is created, **install it** on your org (all repos, or a selected subset)
from its GitHub App page. Because the App requests OAuth on install, install and OAuth
authorization happen together.

> **Confirm "User-to-server token expiration" is ON** under the App's *Optional
> features*. There is no manifest key for this; it is on by default for new apps, but
> the silent-refresh logic depends on it. If it is off, refresh tokens are never issued
> and viewers will be forced to re-login every 8 hours.

### 4. Use it

Browse to `https://htmldoc-review.<your-subdomain>.workers.dev/{repo}/{path}` (e.g.
`.../handbook/guide.html`), optionally adding `?ref=<branch|tag|sha>` to pin a
non-default branch. The Worker fetches `{path}` from `{repo}` in `DOC_OWNER` **as you**:
if GitHub returns the file you see the raw HTML; otherwise you get a neutral "Not found
or no access" page.

### Promote to a custom domain

The `workers.dev` URL is a fine production path on its own. To move to a custom domain:

1. Onboard the domain to Cloudflare (add the zone; point its nameservers at Cloudflare).
2. Add the domain to the Worker as a custom domain / route (Cloudflare provisions DNS +
   TLS). In `wrangler.toml` this is a bare-host `[[routes]]` entry with
   `custom_domain = true`.
3. Update `CALLBACK_URL` to `https://<your-host>/auth/callback` **and** update the
   GitHub App's callback URL to match, then redeploy.

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

For manual / pre-ship checks that the unattended suite can't cover, see
[d1-spikes.md](../../docs/plans/worker/d1-spikes.md).
</content>
</invoke>
