export const meta = {
  name: 'd1-review-fixes',
  description: 'Address PR #9 review comments in dependency order; each phase self-verifies to green and proposes comment replies (parent posts them)',
  phases: [
    { title: 'Versions', detail: 'upgrade stale deps, verify pool-workers config via ctx7, modern tsconfig, core/worker test split' },
    { title: 'Moves', detail: 'rename/move files (scripts/setup, docs/plans, shared responses) so later edits land in final paths' },
    { title: 'Scope', detail: 'repo from URL path, ?ref passthrough (omit -> GitHub default), drop DOC_REPO/DOC_BRANCH from env' },
    { title: 'CoreQuality', detail: 'one coherent pass on the auth files: throws+logging, refresh race, naming, dedup, helpers, comments' },
    { title: 'TestsDocs', detail: 'parallel disjoint: core unit tests, create-app polish, fail-loud placeholders' },
    { title: 'Readme', detail: 'README cleanup last, once scope/paths/tests are final' },
  ],
}

// ---------------------------------------------------------------------------
const APP = 'apps/htmldoc-review'

// Decisions already made WITH THE USER — honor, do not relitigate.
const DECISIONS = `LOCKED DECISIONS:
- SCOPE: one Worker per org. ENV encodes ONLY the org (DOC_OWNER stays). DELETE DOC_REPO and DOC_BRANCH from Env,
  Config, and wrangler.toml [vars]. The repo is the FIRST URL path segment; the doc path is the remainder.
  Example: html-docs.myboop.ai/app-ios/docs/foo.html -> repo "app-ios", path "docs/foo.html".
- BRANCH/REF: a "?ref=" query param (GitHub's own param name), accepts branch/tag/SHA. Percent-encode the value so
  slashed branches work (feature/a/b -> feature%2Fa%2Fb). If ?ref is OMITTED, pass NO ref to the GitHub Contents API
  -- GitHub then serves the repo's default branch automatically. So D1 does NOT call GET /repos for default_branch and
  does NOT cache it. (default_branch resolution is a D2 concern, only needed to DISPLAY the branch.)
- ANY repo in the org is reachable; the viewer's own GitHub access is the gate (404 == no-access-or-missing, neutral,
  no leak). No allow-list.
- ERRORS: core helpers throw DOCUMENTED, typed errors (e.g. InvalidPathError) instead of returning silent null; the
  Worker entrypoint catches, logs via LogTape, and maps to a response. "Preserve the error, don't hide it."
  The neutral-404 response mapping stays (it's a response decision, not error-hiding).
- REFRESH RACE: handle minimally WITHOUT a Durable Object (we deliberately have no DO in D1). Approach = retry-on-reread:
  if refreshAccessToken fails as a dead grant, RE-READ the KV session once before forcing re-login -- a concurrent
  request may have already rotated the token, in which case use the fresh one. Only force re-login if the re-read also
  lacks a valid token. Document the residual race as a known D1 limitation.
- SESSION ID: a single crypto.randomUUID() is sufficient (122 bits > OWASP 64-bit floor); drop the double-UUID. Add a
  short comment citing the OWASP Session Management guidance (CSPRNG + >=64 bits entropy).
- HELPERS: prefer small standard helpers over hand-roll where they genuinely reduce code: Response.redirect / native
  Response for responses (mind the immutable-headers gotcha -> when also setting cookies, hand-build new Response(null,
  {status:302, headers})), and the tiny "cookie" npm package (parse/serialize) for cookie read + clear, OR keep the
  ~10-line hand-roll if cleaner. Implementer's judgment; keep it minimal and consistent.
- TSCONFIG: modernize to current Cloudflare practice -- generated types via "wrangler types" -> worker-configuration.d.ts
  referenced in "types" (instead of @cloudflare/workers-types), moduleResolution "bundler", strict, verbatimModuleSyntax,
  isolatedModules, noEmit. Add a comment linking the Cloudflare docs source. VERIFY exact current form via the ctx7 CLI
  before committing (npx ctx7@latest), do not trust memory.
- TEST SPLIT: plain vanilla vitest (node env) for pure src/core/ unit tests; @cloudflare/vitest-pool-workers for
  src/worker/ integration tests (KV + fetch handler). Both coexist (two configs / vitest projects). The existing 20
  pool-workers tests must keep passing.
- VERSIONS: upgrade stale pins to verified-latest (checked via npm/ctx7, NOT guessed). Current latest observed:
  arctic 3.7.0, @logtape/logtape 2.2.1, wrangler 4.x, vitest 4.x, @cloudflare/vitest-pool-workers 0.16.x,
  @cloudflare/workers-types 4.x (or drop in favor of generated types), typescript 6.x. The pool-workers 0.16 config API
  differs from 0.8 -- VERIFY the correct current config form via ctx7/installed package types before changing it
  (an earlier research pass flagged a possibly-hallucinated "cloudflareTest()" API -- do NOT adopt it unverified).`

// The green gate every implementation phase must reach before finishing.
const GATE = `GREEN GATE (run in ${APP}; do NOT finish until all pass, self-fix until green; if truly blocked, report blocked=true with the failing output):
  npm install            (only if you changed dependencies)
  npx tsc --noEmit
  npx vitest run         (all tests pass; never weaken a security test to make it pass)
  npx wrangler deploy --dry-run`

const NO_GITHUB = `Do NOT touch GitHub, do NOT run gh, do NOT post or resolve anything. Instead RETURN your proposed replies as data;
the parent posts them. For each PR comment you addressed, return { comment: <number>, text: "<concise reply: what you
changed or the decision + why>" }. Keep replies short and specific. Only propose replies for comments your phase owns.`

// PR #9 review comments, remapped to CURRENT (post-reorg) paths. Reference by number in your replies.
const COMMENTS = `PR #9 REVIEW COMMENTS (number, current-path, gist):
[1]  core/cookies.ts    readCookie: any std/Cloudflare helper instead of re-deriving? handle errors via documented throw, not silent null.
[2]  core/docsource.ts  neutral(): document it and move to a shared module (e.g. worker/common/responses).
[3]  core/docsource.ts  safeRepoPath: better error handling (documented throw).
[4]  core/docsource.ts  repo+branch must NOT be env-scoped; take them from the URL; match how GitHub encodes branch/path; want html-docs.myboop.ai/app-ios/foo.html?ref=a/b/c style.
[5]  worker/index.ts    Env: add docs; make org-scoped (drop repo/branch) per [4].
[6]  worker/index.ts    clearing cookies: any helper instead of hand-rolled Set-Cookie?
[7]  worker/index.ts    switch vs if for route dispatch? (no full router needed). Implementer's call.
[8]  worker/index.ts    route paths repeated in multiple places -> declare as shared constants.
[9]  worker/index.ts    401 re-auth block is duplicated -> factor into one try path / one copy.
[10] core/oauth.ts      all functions here need block comments AND probably unit tests.
[11] core/oauth.ts      burnState is a bad name -> clearStateCookieString; use it everywhere appropriate.
[12] core/oauth.ts      rejectAndBurn maybe unnecessary -> inline if used <=2x; keep only if it earns its place.
[13] core/oauth.ts      beginLogin needs an explanatory block comment.
[14] core/session.ts    why session id = randomUUID()+randomUUID()? best practice? reference or simplify.
[15] core/session.ts    doRefresh needs a block comment; check impl against reference libraries (arctic/Cloudflare).
[16] core/session.ts    on dead refresh: preserve the error, don't hide it.
[17] app-manifest.json  template should FAIL until replaced -> {{DOMAIN e.g. HTMLDOCS.MYDOMAIN.AI}} style placeholders.
[18] create-app.mjs     rename to create-worker-app.mjs (more specific).
[19] create-app.mjs     move under scripts/setup/.
[20] create-app.mjs     add a short purpose paragraph ("Helper to set up GitHub + worker app; handles auth token capture and setup").
[21] create-app.mjs     when browser-open is skipped, print something so the agent sees what happened.
[22] package.json       confirm dep versions are real latest (verified via CLI), not LLM-hallucinated.
[23] README.md          delete the "What this deliverable is (and is NOT)" section.
[24] README.md          update env table for org-scope (no repo/branch configured).
[25] README.md          update routes table once branch/path encoding is decided.
[26] README.md          remove DOC_BRANCH from the config example.
[27] README.md          don't restate step-by-step what the scripts do; collapse / speak broadly.
[28] README.md          update "Use it" once paths are decided; remove the "No session ->" line (that's how it works, not how to use it).
[29] README.md          are we separating worker tests (vitest-pool-workers) from plain unit tests? what about regular vitest for units?
[30] setup.sh           move under scripts/setup/.
[31] SPIKES.md          move to docs/plans/ (with the plans), not app root.
[32] tsconfig.json      is this the latest recommended for Workers? add a doc-source link comment; verify via research before committing.
[33] wrangler.toml      make placeholders that FAIL without being updated.`

const PHASE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'filesChanged', 'gate', 'replies', 'blocked'],
  properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    gate: {
      type: 'object',
      additionalProperties: false,
      required: ['tsc', 'vitest', 'dryRun'],
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
        additionalProperties: false,
        required: ['comment', 'text'],
        properties: {
          comment: { type: 'number' },
          text: { type: 'string' },
        },
      },
    },
    blocked: { type: 'string', description: 'Empty if the gate is green; otherwise the failing output and why.' },
  },
}

function phasePrompt(body) {
  return `${body}\n\n${DECISIONS}\n\n${COMMENTS}\n\n${GATE}\n\n${NO_GITHUB}`
}

const results = []

// ---------------------------------------------------------------------------
// Phase 0 — Versions & tooling (serial; foundation for everything).
phase('Versions')
results.push(await agent(
  phasePrompt(`PHASE 0 — Versions & tooling. Work in ${APP}.
- Upgrade the stale dependency pins to verified-latest. VERIFY each version via the ctx7 CLI and/or 'npm view <pkg> version' (do NOT guess).
- The vitest-pool-workers major bump (0.8 -> 0.16) changes its config API; verify the CURRENT config form via ctx7 / the installed package's exported /config types and apply it. Do NOT adopt an unverified "cloudflareTest()" API.
- Modernize tsconfig.json per the LOCKED tsconfig decision (generated types via 'wrangler types' -> worker-configuration.d.ts; bundler/strict/verbatimModuleSyntax/isolatedModules/noEmit) with a comment linking the Cloudflare docs source you verified.
- Set up the TEST SPLIT: a plain vanilla vitest (node) config for pure src/core/ unit tests + the pool-workers config for src/worker/ tests, coexisting. Move the existing test/worker/proxy.test.ts under the worker project if needed; it must keep passing.
Owns comments: [22], [29], [32], and the tooling half of test-split. Reach the green gate.`),
  { label: 'phase0:versions', phase: 'Versions', schema: PHASE_SCHEMA, effort: 'high' }
))
log(`Phase 0 gate: tsc=${results[0]?.gate?.tsc} vitest=${results[0]?.gate?.vitest} dryRun=${results[0]?.gate?.dryRun}${results[0]?.blocked ? ' BLOCKED' : ''}`)

// ---------------------------------------------------------------------------
// Phase 1 — Moves & renames (serial; do before content edits).
phase('Moves')
results.push(await agent(
  phasePrompt(`PHASE 1 — Moves & renames. Work in ${APP} (and the repo's docs/plans for SPIKES).
- git mv create-app.mjs -> scripts/setup/create-worker-app.mjs   [18][19]
- git mv setup.sh -> scripts/setup/setup.sh                       [30]
- git mv SPIKES.md -> ../../docs/plans/d1-spikes.html? NO -- keep it markdown: move to repo docs/plans/d1-spikes.md (it's a checklist, not an htmldoc). [31]
- Extract the neutral() 404 responder out of core/docsource.ts into a small shared module (src/worker/common/responses.ts or src/core/responses.ts -- pick the layer that keeps core portable) and document it. [2]
- Update ALL references: setup.sh's own path assumptions, any path in README/SPIKES, create-app references, imports of neutral(), wrangler/package script paths. Use git mv to preserve history.
Owns: [2][18][19][30][31]. Reach the green gate (paths must still resolve).`),
  { label: 'phase1:moves', phase: 'Moves', schema: PHASE_SCHEMA, effort: 'high' }
))
log(`Phase 1 gate: tsc=${results[1]?.gate?.tsc} vitest=${results[1]?.gate?.vitest} dryRun=${results[1]?.gate?.dryRun}${results[1]?.blocked ? ' BLOCKED' : ''}`)

// ---------------------------------------------------------------------------
// Phase 2 — Scope reframe (serial; changes types + routing + tests).
phase('Scope')
results.push(await agent(
  phasePrompt(`PHASE 2 — Scope reframe (the headline change). Work in ${APP}.
Implement the LOCKED SCOPE + BRANCH/REF decisions:
- Parse the request URL as /{repo}/{...docPath}: first path segment = repo, remainder = doc path.
- Read optional ?ref= ; percent-encode it for the GitHub Contents API. If absent, send NO ref param (GitHub serves default).
- Remove DOC_REPO and DOC_BRANCH from the Env interface (worker/index.ts), from Config (core/config.ts), and from
  wrangler.toml [vars]. Keep DOC_OWNER. Document the Env interface [5].
- Update core/docsource.ts fetchDoc to take repo + path + optional ref (from the URL) instead of env repo/branch.
- Update worker/index.ts routing accordingly, and update the existing tests (repo now in the path; add a ?ref case and
  an omit-ref case).
Owns: [4][5][24-code][25-code][26-code] (the CODE/CONFIG side; README rows are Phase 5). Reach the green gate.`),
  { label: 'phase2:scope', phase: 'Scope', schema: PHASE_SCHEMA, effort: 'high' }
))
log(`Phase 2 gate: tsc=${results[2]?.gate?.tsc} vitest=${results[2]?.gate?.vitest} dryRun=${results[2]?.gate?.dryRun}${results[2]?.blocked ? ' BLOCKED' : ''}`)

// ---------------------------------------------------------------------------
// Phase 3 — Core auth code-quality pass (serial; single owner of the auth files
// to avoid self-conflict, since all these comments edit the same 4-5 files).
phase('CoreQuality')
results.push(await agent(
  phasePrompt(`PHASE 3 — Core auth code-quality pass. Work in ${APP}. You OWN a coherent edit of core/oauth.ts,
core/session.ts, core/cookies.ts, core/docsource.ts, and worker/index.ts. Do it as ONE consistent pass.
- ERROR HANDLING [1][3][16]: make readCookie, safeRepoPath, and doRefresh throw DOCUMENTED typed errors instead of
  silent null; catch at the worker entrypoint, log via LogTape (no secrets), map to the right response. Preserve the
  original error (cause) on the dead-refresh path -- don't swallow it.
- REFRESH RACE [decision]: implement retry-on-reread in the session refresh path (re-read KV once on dead-grant before
  forcing re-login; use a concurrently-rotated token if present). Add a brief comment noting the residual race is a known
  D1 limitation (no DO).
- SESSION ID [14]: single crypto.randomUUID(); comment citing OWASP (CSPRNG + >=64 bits; UUIDv4 ~122 bits).
- NAMING [11]: burnState -> clearStateCookieString everywhere.
- DEDUP/STRUCTURE [8][9][12][7]: route paths as shared constants [8]; factor the duplicated 401 re-auth into one path
  [9]; decide rejectAndBurn inline-vs-keep based on actual call count [12]; pick switch-vs-if for dispatch [7] (your call,
  keep it simple).
- HELPERS [1][6]: adopt the tiny standard helpers per the LOCKED HELPERS decision where they genuinely reduce code
  (cookie parse/serialize + clear; native Response), else keep a clean minimal hand-roll. Be consistent.
- COMMENTS [10][13][15]: add concise block comments to the oauth.ts functions, beginLogin, and doRefresh. For [15],
  sanity-check the refresh impl against arctic's documented refreshAccessToken/OAuth2Tokens shape.
(Unit tests for [10] are Phase 4, not here.) Owns: [1][3][6][7][8][9][11][12][13][14][15][16] + comment-half of [10].
Reach the green gate.`),
  { label: 'phase3:corequality', phase: 'CoreQuality', schema: PHASE_SCHEMA, effort: 'high' }
))
log(`Phase 3 gate: tsc=${results[3]?.gate?.tsc} vitest=${results[3]?.gate?.vitest} dryRun=${results[3]?.gate?.dryRun}${results[3]?.blocked ? ' BLOCKED' : ''}`)

// ---------------------------------------------------------------------------
// Phase 4 — Tests & standalone docs (PARALLEL: genuinely disjoint files).
phase('TestsDocs')
const p4 = (await parallel([
  () => agent(
    phasePrompt(`PHASE 4a — Core unit tests [10]. Work in ${APP}. Using the PLAIN vanilla vitest (node) project set up in
Phase 0, add focused unit tests for the pure helpers in src/core/oauth.ts (and any pure helpers in cookies.ts/docsource.ts):
the state HMAC sign/verify, timingSafeEqual, b64url, safeRepoPath (incl. traversal/encoding cases), and the
clearStateCookieString output. These are pure-logic tests -- do NOT use vitest-pool-workers. Only create files under
test/core/. Owns the unit-test half of [10]. Reach the green gate (both vitest projects pass).`),
    { label: 'phase4a:coretests', phase: 'TestsDocs', schema: PHASE_SCHEMA, effort: 'high' }
  ),
  () => agent(
    phasePrompt(`PHASE 4b — create-app polish. Work in ${APP}/scripts/setup/create-worker-app.mjs (moved in Phase 1).
- Add a short purpose paragraph at the top [20]: roughly "Helper for the GitHub App Manifest flow: creates the org's
  GitHub App, captures the returned credentials, and wires them into the Worker setup."
- When the browser auto-open is skipped, PRINT the URL / a clear message so the running agent/admin sees what happened [21].
Touch ONLY that file. Owns: [20][21]. Reach the green gate (this is a .mjs; ensure nothing else breaks).`),
    { label: 'phase4b:createapp', phase: 'TestsDocs', schema: PHASE_SCHEMA, effort: 'low' }
  ),
  () => agent(
    phasePrompt(`PHASE 4c — Fail-loud placeholders. Work in ${APP}.
- app-manifest.json [17]: replace soft placeholders with ones that clearly FAIL until replaced, e.g.
  "{{REPLACE_WITH_DOMAIN_e.g._htmldocs.mydomain.ai}}".
- wrangler.toml [33]: same idea for the route/domain (and any remaining placeholder) -- make them obviously invalid until
  edited, with a brief comment. (Note Phase 2 already removed DOC_REPO/DOC_BRANCH; don't re-add them.)
Touch ONLY those two files. Owns: [17][33]. Reach the green gate (dry-run may warn on placeholder domain -- that's fine,
but tsc/vitest must pass and the toml must parse).`),
    { label: 'phase4c:placeholders', phase: 'TestsDocs', schema: PHASE_SCHEMA, effort: 'low' }
  ),
])).filter(Boolean)
results.push(...p4)
log(`Phase 4 done: ${p4.length}/3 sub-phases; blocked=${p4.filter(r => r.blocked).length}`)

// ---------------------------------------------------------------------------
// Phase 5 — README cleanup (serial; LAST, depends on final scope/paths/tests).
phase('Readme')
results.push(await agent(
  phasePrompt(`PHASE 5 — README cleanup. Work in ${APP}/README.md (and reflect the moved SPIKES location).
- Delete the "What this deliverable is (and is NOT)" section [23].
- Update the env/config table + examples for ORG scope: only DOC_OWNER; no DOC_REPO/DOC_BRANCH [24][26].
- Update the routes/usage tables for the NEW URL shape /{repo}/{path}?ref=... [25][28]; remove the "No session ->"
  line from the "Use it" section (that's behavior, not usage) [28].
- Collapse the step-by-step restatement of what the setup scripts do into a broad description (less to drift) [27].
- Add/!update a short note on the test split (vanilla vitest for core, pool-workers for worker) [29].
- Fix any paths changed in Phase 1 (scripts/setup/, docs/plans/ SPIKES).
Owns: [23][24][25][26][27][28][29-readme]. Reach the green gate (docs-only, but confirm nothing references deleted vars).`),
  { label: 'phase5:readme', phase: 'Readme', schema: PHASE_SCHEMA, effort: 'high' }
))
log(`Phase 5 gate: tsc=${results[5]?.gate?.tsc} vitest=${results[5]?.gate?.vitest} dryRun=${results[5]?.gate?.dryRun}${results[5]?.blocked ? ' BLOCKED' : ''}`)

// ---------------------------------------------------------------------------
// Aggregate for the parent: every proposed reply (keyed by PR comment number)
// and any phase that ended blocked / non-green.
const replies = results.flatMap(r => (r?.replies || []).map(x => ({ ...x, _phase: r.summary?.slice(0, 40) })))
const blocked = results.filter(r => r?.blocked).map(r => ({ phase: r.summary?.slice(0, 60), blocked: r.blocked }))
const gateFinal = results.map((r, i) => ({ phase: i, tsc: r?.gate?.tsc, vitest: r?.gate?.vitest, dryRun: r?.gate?.dryRun }))

return {
  phases: results.length,
  filesChanged: [...new Set(results.flatMap(r => r?.filesChanged || []))],
  replies,
  blocked,
  gateFinal,
  note: 'Parent: review the full diff + re-run the gate independently, then POST these replies (in_reply_to) WITHOUT resolving threads.',
}
