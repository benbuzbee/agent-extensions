export const meta = {
  name: 'd1-review-fixes-round2',
  description: 'PR #9 review round 2: core comments+renames (serial), then create-app + README (parallel). Research already done; findings baked in.',
  phases: [
    { title: 'Core', detail: 'one serial pass over src/core + src/worker/index.ts: file/inline comments, de-historicize, repoOrg rename, branded SessionId, IIFE cleanups' },
    { title: 'SetupAndDocs', detail: 'parallel disjoint: create-worker-app.mjs (comments, open dep, version pin) + README rewrite (trim + workers.dev-first setup)' },
  ],
}

// ---------------------------------------------------------------------------
// Round 1 (phases 0-5) is committed. [23] doc-move done by parent. [1][2] already
// replied. This round = the still-open review comments that need code/doc work.
// Tree is GREEN at start. Research for [6][8][9] is DONE; conclusions are LOCKED below.
const APP = 'apps/htmldoc-review'

const RESEARCH = `RESEARCH ALREADY DONE — these are CONCLUSIONS, do NOT re-research, just apply:
- [6] GitHub REST API version pin: MOVE the pin from "2022-11-28" to "2026-03-10". Verified: 2026-03-10's breaking
  changes (rate_limit 'rate' removal, SARIF content-type, squash-PR-title prop, beta media-type payloads) are ALL
  disjoint from POST /app-manifests/{code}/conversions — client_id/client_secret are untouched, so it's safe. Add a
  brief comment: dated versions are stable identifiers (not "keep bumping"); we pin so future breaking versions can't
  silently change behavior; cite GitHub's REST API versioning docs
  (https://docs.github.com/en/rest/about-the-rest-api/api-versions).
- [8] Local-auth server: KEEP the hand-rolled node:http server — do NOT adopt a library. Verified: the GitHub App
  MANIFEST flow is non-standard (final step POSTs to /app-manifests/{code}/conversions and returns an app config, not an
  OAuth token), so OAuth-callback libs (@openid/client, oauth4webapi, oauth-callback) don't fit and would still leave the
  conversion POST + the manifest-form route hand-written. Add a short comment at the server setup explaining WHY we
  hand-roll (manifest flow is not standard OAuth; ~60 lines of node:http with no extra deps is the right call).
- [9] Cross-platform "open URL in browser": ADOPT the 'open' npm package (sindresorhus) and REPLACE the
  process.platform switch (darwin->open / win32->cmd start / else xdg-open). Reason: the hand-roll mishandles WSL
  (process.platform is 'linux' there, so it runs xdg-open inside Linux instead of the Windows browser), Windows '&'
  arg-escaping, and Flatpak/Snap xdg-open. 'open' handles all three. Add it as a DEV dependency (the setup script is run
  via node at setup time, NOT bundled into the Worker) and run npm install so the lockfile updates. Keep the NO_OPEN
  env-var escape hatch (print the URL instead of opening).`

const DECISIONS = `LOCKED DECISIONS (honor; do not relitigate):
- COMMENTS POLICY [17][18]: every comment must describe CURRENT state or genuine future work — NEVER narrate past
  iterations or removed code. Delete any "it is NOT scoped to X", "we used to...", "adding them back would...",
  "previously..." style narration. Sweep ALL comments in the files you own for this, not just the two flagged lines.
- ORIGIN DOMAIN [21]: setup starts on the free *.workers.dev subdomain (zero DNS), and the README documents migrating to
  a Cloudflare custom domain later (point a custom domain at the Worker + update CALLBACK_URL and the GitHub App's
  callback URL). workers.dev is the quick-start; custom domain is the production path.
- repoOrg RENAME [10]: rename Config.docOwner to a clearer name — 'repoOrg' (the user's suggestion) is fine; add a
  comment that it can also be an individual GitHub account, not only an org. The ENV VAR stays DOC_OWNER (don't rename
  bindings); only the Config field + its uses change. This ripples to configOf() in worker/index.ts and to docsource.ts
  — update every reference so tsc stays clean.
- BRANDED SessionId [16]: introduce a branded string type (e.g. \`type SessionId = string & { readonly __brand: 'SessionId' }\`)
  for session ids; thread it through createSession's return, getValidAccessToken/deleteSession/doRefresh params, the
  SessionStore interface (store.ts) get/put/delete, and the sid in worker/index.ts. Provide one tiny helper to brand a
  raw string (e.g. asSessionId) used where the id originates (createSession's randomUUID, and reading the cookie). Keep
  it minimal — a branded alias, not a class.
- LOGGING/SECURITY: never log tokens, codes, secrets, or auth headers. The neutral-404 contract is unchanged.`

const GATE = `GREEN GATE (run in ${APP}; do NOT finish until all pass; self-fix until green; if truly blocked, put the failing output in \`blocked\`):
  npm install            (REQUIRED if you changed package.json — e.g. adding 'open')
  npx tsc --noEmit
  npx vitest run         (ALL tests pass across BOTH projects; never weaken a security test to pass)
  npx wrangler deploy --dry-run`

const NO_GITHUB = `Do NOT touch GitHub, gh, or post/resolve anything. RETURN proposed replies as data; the PARENT posts them. For each PR
comment you addressed add an entry to replies: { comment: "<number as STRING e.g. '10'>", text: "<short reply: what
changed or the decision + why>" }. Only propose replies for comments your phase owns.`

const PHASE_SCHEMA = {
  type: 'object',
  required: ['summary', 'gate', 'replies'],
  properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    gate: {
      type: 'object',
      properties: {
        tsc: { type: 'boolean' },
        vitest: { type: 'boolean' },
        dryRun: { type: 'boolean' },
      },
    },
    replies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['comment', 'text'],
        properties: {
          comment: { type: 'string', description: "PR comment number as a string, e.g. '10'" },
          text: { type: 'string' },
        },
      },
    },
    blocked: { type: 'string', description: 'Empty/omitted if green; else the failing output.' },
  },
}

function prompt(body) {
  return `${body}\n\n${RESEARCH}\n\n${DECISIONS}\n\n${GATE}\n\n${NO_GITHUB}`
}

const results = []

// ---------------------------------------------------------------------------
// Phase 1 — Core comments + renames (SERIAL; one owner of all core + worker/index.ts).
// Serial because repoOrg [10] and SessionId [16] ripple across multiple core files
// and worker/index.ts; parallel editors would collide.
phase('Core')
results.push(await agent(
  prompt(`PHASE 1 — Core comments, de-historicize, and two renames. Work in ${APP}. You OWN a single coherent edit of:
src/core/oauth.ts, src/core/session.ts, src/core/docsource.ts, src/core/cookies.ts, src/core/config.ts,
src/core/store.ts, and src/worker/index.ts.
- COMMENTS [12][13][14][15]:
  - oauth.ts [13]: add a top-of-file comment — what this module is (the GitHub App user-to-server OAuth flow:
    begin/complete login + token refresh), and how portable it is (no Cloudflare types; pure Config + SessionStore).
  - session.ts [14]: add a top-of-file comment — server-side session lifecycle over the SessionStore seam (create,
    fetch-with-silent-refresh, delete); the access/refresh token split lives here.
  - session.ts:12 region [15]: comment the DEFAULT_TTL / SKEW_MS constants (what they are, why a 30s skew).
  - docsource.ts ~line 34 [12]: comment the \`pathname.replace(/^\\/+/, "")\` — it strips leading slash(es) so the first
    real path segment is the repo (a request path always starts with "/").
- DE-HISTORICIZE [17][18]: in worker/index.ts (and any other file you own) delete past-tense / removed-code narration:
  the "It is NOT scoped to a single repo... adding them back would re-scope" Env comment must be rewritten to state ONLY
  the current contract (repo = first path segment, doc path = remainder, branch via ?ref=; one Worker = one org). Sweep
  ALL comments you own for similar artifacts.
- repoOrg RENAME [10]: rename Config.docOwner per the LOCKED DECISION (-> repoOrg, comment that it can be an individual);
  update configOf() in worker/index.ts and every use in docsource.ts. Env var stays DOC_OWNER.
- BRANDED SessionId [16]: introduce the branded type per the LOCKED DECISION and thread it through session.ts, store.ts,
  and worker/index.ts with a tiny asSessionId brand helper. Minimal.
- IIFE CLEANUP [11]: in cookies.ts, turn the \`let jar; try { jar = parseCookie(...) } catch {...}\` into a const via a
  small IIFE (or equally clean form) so \`jar\` is const — keep the CookieParseError throw behavior identical.
Owns: [10][11][12][13][14][15][16][17][18]. Reach the green gate.`),
  { label: 'p1:core', phase: 'Core', schema: PHASE_SCHEMA, effort: 'high' }
))
log(`Phase 1 gate: tsc=${results[0]?.gate?.tsc} vitest=${results[0]?.gate?.vitest} dryRun=${results[0]?.gate?.dryRun}${results[0]?.blocked ? ' BLOCKED' : ''}`)

// ---------------------------------------------------------------------------
// Phase 2 — Setup script + README (PARALLEL: fully disjoint files).
phase('SetupAndDocs')
const p2 = (await parallel([
  () => agent(
    prompt(`PHASE 2a — Setup script polish + research fixes. Work in ${APP}/scripts/setup/create-worker-app.mjs (and
${APP}/package.json + lockfile if you add the 'open' dep). Touch ONLY those.
- [3] The \`let manifest; try { manifest = JSON.parse(...) } catch {...}\` block: convert to a const via a small IIFE
  (const manifest = (() => { ... })()), preserving the exact error message + process.exit on bad JSON.
- [4] Rename the \`finish(server, code)\` function to make its job obvious (it closes the server then exits the process) —
  e.g. closeAndExit / shutdownAndExit. Update all call sites.
- [5] Add a comment at the ephemeral-server creation explaining WHY a local http server exists at all: the GitHub App
  Manifest flow needs a redirect target to catch GitHub's ?code= callback, so setup spins up a throwaway localhost
  server to receive it (this script may be driven by an agent/admin, not only a human at a browser).
- [6] Move the X-GitHub-Api-Version pin to "2026-03-10" with the comment per the RESEARCH note (cite the versioning docs).
- [7] Add a comment on the process.stdout.write of GITHUB_CLIENT_ID/SECRET: VERIFY and explain — stdout carries the
  machine-readable credentials for setup.sh to capture, while all human/status messages go to stderr (console.error) so
  the two streams don't mix. (Confirm the code actually does this; fix if any status text leaks to stdout.)
- [8] Add the "why we hand-roll, not a library" comment per the RESEARCH note (manifest flow is not standard OAuth).
- [9] Replace the process.platform open-switch with the 'open' package per the RESEARCH note; add 'open' as a
  devDependency, run npm install, keep the NO_OPEN escape hatch (print URL instead). Import it ESM-style.
Owns: [3][4][5][6][7][8][9]. Reach the green gate (npm install REQUIRED after adding 'open').`),
    { label: 'p2a:setup', phase: 'SetupAndDocs', schema: PHASE_SCHEMA, effort: 'high' }
  ),
  () => agent(
    prompt(`PHASE 2b — README trim + workers.dev-first setup. Work ONLY in ${APP}/README.md.
- [20] The detail under "The locked contract" / Routes (around the contract+routes tables) is too much for a README.
  Collapse it to a short statement: this Worker implements GitHub App OAuth login, then fetches files as the user from
  \`GET /{repo}/{path}?ref=...\`. Keep the minimal env/binding table (DOC_OWNER, GITHUB_CLIENT_ID, the two secrets,
  CALLBACK_URL) since setup needs it, but drop the verbose prose.
- [19] Remove the over-detailed "Two-tier token expiry" section (implementation detail — it lives in code comments, not
  the README).
- [22] Delete the "Manual / pre-ship checks" section (the spikes doc is the home for that; if you want, keep a single
  one-line pointer to docs/plans/worker/d1-spikes.md, no more).
- [21] ORIGIN DOMAIN — rewrite the setup walkthrough to be workers.dev-FIRST per the LOCKED DECISION: quick-start deploys
  to the free *.workers.dev subdomain (no custom domain / DNS needed); CALLBACK_URL and the GitHub App callback are the
  workers.dev URL. Then add a short "Promote to a custom domain" subsection: onboard a domain to Cloudflare, add it as a
  Worker custom domain/route, and update CALLBACK_URL + the GitHub App's callback URL to match. Remove the hard
  "custom domain on Cloudflare" prerequisite.
- Fix any now-stale paths: the plan docs moved to docs/plans/worker/ (e.g. d1-spikes.md is at ../../docs/plans/worker/d1-spikes.md).
- While here, ensure no section restates step-by-step what the setup scripts do; describe broadly and point to the script.
Owns: [19][20][21][22]. Reach the green gate (docs-only; confirm nothing references removed vars/paths).`),
    { label: 'p2b:readme', phase: 'SetupAndDocs', schema: PHASE_SCHEMA, effort: 'high' }
  ),
])).filter(Boolean)
results.push(...p2)
log(`Phase 2 done: ${p2.length}/2 sub-phases; blocked=${p2.filter(r => r?.blocked).length}`)

// ---------------------------------------------------------------------------
const replies = results.flatMap(r => (r?.replies || []))
const blocked = results.filter(r => r?.blocked).map(r => ({ phase: (r.summary || '').slice(0, 60), blocked: r.blocked }))
return {
  phases: results.length,
  filesChanged: [...new Set(results.flatMap(r => r?.filesChanged || []))],
  replies,
  blocked,
  gateFinal: results.map(r => ({ tsc: r?.gate?.tsc, vitest: r?.gate?.vitest, dryRun: r?.gate?.dryRun })),
  note: 'Parent: review the diff + re-run the gate independently, then POST these replies (in_reply_to) WITHOUT resolving threads.',
}
