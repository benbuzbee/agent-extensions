# htmldoc-review

A self-hosted, per-org Cloudflare Worker that gates private HTML docs in a GitHub org behind a GitHub App OAuth login. It serves each doc by fetching it from the GitHub Contents API **as the logged-in user**, so GitHub itself is the authorization engine — a file you can't see returns a neutral `404`, indistinguishable from one that doesn't exist.

The owner is fixed per Worker via `REPO_ORG` and is never in the URL. After login, request a doc at `GET /{repo}/{path}?ref=<branch|tag|sha>`: the first path segment is the repo, the rest is the doc path. Omit `?ref=` for the repo's default branch.

## Setup: vendor, then deploy

This is self-hosted per-org, so you don't run it from inside the upstream `agent-extensions` repo. You copy ("vendor") the app into your own infra repo and configure + deploy from there.

> Prerequisites: Node 18+, a Cloudflare account with `wrangler` access, admin rights to create a GitHub App, and `openssl` (for the HMAC signing key).

### 1. Vendor it

From an upstream checkout:

```sh
./scripts/setup/vendor.sh ~/infrastructure/htmldocs-app
```

This copies the app (excluding `node_modules`/`dist`/secrets) into your repo and writes `PROVENANCE.md` recording the exact upstream commit. To update, re-run `vendor.sh` from a newer upstream checkout. Vendoring is required because your real config and ownership belong in your repo, and `deploy.sh` edits `wrangler.toml` in place — so it must run against your copy, not the template.

### 2. Configure

```sh
cd ~/infrastructure/htmldocs-app
# set REPO_ORG (your org or individual GitHub account slug) in wrangler.toml
```

`REPO_ORG` is the only value you set by hand. The quick start uses the free `*.workers.dev` subdomain — no custom domain or DNS needed — and `deploy.sh` fills in `GITHUB_CLIENT_ID` and `CALLBACK_URL` for you (it deploys first to discover your workers.dev URL, then bakes that into the GitHub App).

### 3. Deploy

```sh
./scripts/setup/deploy.sh
```

Idempotent and safe to re-run. It installs deps, logs you into Cloudflare if needed, creates the `SESSIONS` KV namespace, deploys to discover your workers.dev URL, runs the GitHub App Manifest flow (a browser opens — click **Create GitHub App**) with that URL as the App's callback, pushes secrets, and redeploys. See the script for exact ordering.

### 4. Install the App on your org

**Required** — creating the App does *not* grant repo access. Install it at
`https://github.com/apps/htmldoc-review-<your-org>/installations/new` (all repos or a subset);
`deploy.sh` prints this exact URL at the end. OAuth-on-install means install and authorization
happen together. Until you install it, every doc returns a neutral `404`.

> Confirm **"User-to-server token expiration" is ON** under the App's *Optional features* — silent refresh depends on it.

### 5. Use it

Browse to `https://htmldoc-review.<your-subdomain>.workers.dev/{repo}/{path}` (optionally `?ref=`). You see the raw HTML if GitHub serves it to you, else a neutral not-found page.

### Promote to a custom domain

The `workers.dev` URL is a fine production path on its own. To move to a custom domain,
follow this order so login never breaks mid-switch (the GitHub App allows up to 10
callback URLs, so old and new can coexist during the cutover):

1. **Add the new callback to the GitHub App first.** In the App's settings, add
   `https://<your-host>/auth/callback` to **Callback URL** and make it the *first* one
   listed — with `request_oauth_on_install` the install flow always uses the first URL.
   (There is no API for this; it's a settings-UI edit.) Leave the old workers.dev one
   for now.
2. **Point Cloudflare at the host.** In `wrangler.toml` set `workers_dev = false`,
   uncomment the `[[routes]]` custom-domain block and set your bare host, and update
   `CALLBACK_URL` to `https://<your-host>/auth/callback`. Redeploy (`./scripts/setup/deploy.sh`).
3. **Verify** you can log in and load a doc on the custom domain.
4. **Remove** the old workers.dev callback URL from the GitHub App.

## Config reference

Do not rename these:

| Kind | Name | Notes |
| --- | --- | --- |
| Var | `REPO_ORG` | GitHub org/owner this Worker is scoped to |
| Var | `GITHUB_CLIENT_ID` | GitHub App client id (non-secret; `deploy.sh` fills it) |
| Var | `CALLBACK_URL` | `https://<your-host>/auth/callback` |
| Secret | `GITHUB_CLIENT_SECRET` | GitHub App client secret (`wrangler secret put`) |
| Secret | `STATE_SIGNING_KEY` | HMAC key for the signed OAuth `state` nonce (`wrangler secret put`) |
| KV binding | `SESSIONS` | server-side session store |

## Running tests

```sh
cp .dev.vars.example .dev.vars   # one-time: fake local secrets (must exist before typegen)
npm run cf-typegen                # generate worker-configuration.d.ts (reads .dev.vars for Env)
npm test                          # full proxy + auth suite
npm run typecheck                 # tsc --noEmit
```

- Tests never hit real GitHub and need no real credentials — all GitHub fetches are mocked.
- Do **not** add `nodejs_compat` to `wrangler.toml` — `arctic` runs on Workers-native Fetch + Web Crypto.

For manual / pre-ship checks the unattended suite can't cover, see [d1-spikes.md](../../docs/plans/worker/d1-spikes.md).
