export const meta = {
  name: 'd1-review-fixes-v2',
  description: 'Finish PR #9 review fixes (phases 3-5; 0-2 already committed). Loosened schema so agents stop fighting validation.',
  phases: [
    { title: 'CoreQuality', detail: 'one coherent pass on the auth files: throws+logging, refresh race, naming, dedup, helpers, comments' },
    { title: 'TestsDocs', detail: 'parallel disjoint: core unit tests for oauth helpers, create-app polish, fail-loud placeholders' },
    { title: 'Readme', detail: 'README cleanup last, once scope/paths/tests are final' },
  ],
}

// ---------------------------------------------------------------------------
// Phases 0-2 (Versions, Moves, Scope) are DONE and committed (8dd37e3). This run
// finishes the remaining review comments. The tree is GREEN at start.
const APP = 'apps/htmldoc-review'

const DONE = `ALREADY DONE + COMMITTED (do NOT redo; build on this):
- Versions/tooling: wrangler 4, vitest 4, vitest-pool-workers 0.16 (built-in fetchMock gone -> local
  test/worker/fetch-mock.ts), modern tsconfig, test split (vanilla vitest test/core/ + pool-workers test/worker/,
  each with its own vitest.config.ts).
- Moves: scripts/setup/create-worker-app.mjs + scripts/setup/setup.sh; SPIKES -> docs/plans/d1-spikes.md;
  neutral() 404 extracted to src/core/responses.ts.
- Scope: Env/Config carry only DOC_OWNER (no DOC_REPO/DOC_BRANCH); core/docsource.ts has parseDocRequest (repo = first
  URL segment, doc path = remainder) + safeSegments + fetchDoc(cfg, token, repo, path, ref?) with ?ref passthrough
  (omit -> GitHub default); InvalidPathError is thrown from path parsing.
Comments already addressed by 0-2: [2][4][5][18][19][22][24-code][25-code][26-code][29][30][31][32][33-partial].`

const DECISIONS = `LOCKED DECISIONS (honor, do not relitigate):
- ERRORS: core helpers throw DOCUMENTED typed errors (InvalidPathError already exists) instead of silent null; the
  Worker entrypoint catches, logs via LogTape (NEVER secrets), maps to a response. The neutral-404 mapping stays.
  Preserve the original error (use Error cause) on the dead-refresh path -- do not swallow it [16].
- REFRESH RACE: handle WITHOUT a Durable Object (D1 has none). Approach = retry-on-reread: if refreshAccessToken fails as
  a dead grant, RE-READ the KV session once before forcing re-login -- a concurrent request may have already rotated the
  token; if the re-read has a still-valid token, use it. Only force re-login if the re-read also lacks one. Add a brief
  comment noting the residual race is a known D1 limitation.
- SESSION ID: a single crypto.randomUUID() is enough (122 bits > OWASP 64-bit floor); drop the double-UUID; add a short
  comment citing OWASP Session Management (CSPRNG + >=64 bits) [14].
- HELPERS: prefer small standard helpers where they genuinely cut code -- Response.redirect / native Response (mind the
  immutable-headers gotcha: when ALSO setting cookies, hand-build new Response(null,{status:302,headers})); the tiny
  "cookie" npm package (parse/serialize, clear via maxAge 0) for cookie read/clear, OR keep a clean ~10-line hand-roll.
  Implementer's judgment; minimal + consistent [1][6].
- LOGGING: structured via the existing LogTape getLogger pattern; never log tokens, codes, secrets, or auth headers.`

const GATE = `GREEN GATE (run in ${APP}; do NOT finish until all pass; self-fix until green; if truly blocked, set blocked to the failing output):
  npm install            (only if deps changed)
  npx tsc --noEmit
  npx vitest run         (ALL tests pass across BOTH projects; never weaken a security test to pass)
  npx wrangler deploy --dry-run`

const NO_GITHUB = `Do NOT touch GitHub, gh, or post/resolve anything. RETURN proposed replies as data; the parent posts them. For each
PR comment you addressed, add an entry to replies: { comment: "<number, as a STRING e.g. '14'>", text: "<short reply: what
changed or the decision + why>" }. Only propose replies for comments your phase owns.`

// PR #9 comments still OPEN after phases 0-2 (remapped to current paths).
const COMMENTS = `STILL-OPEN PR #9 COMMENTS (number, current path, gist):
[1]  src/core/cookies.ts     readCookie: std helper vs re-derive? documented throw, not silent null.
[3]  src/core/docsource.ts   safeSegments already throws InvalidPathError -- confirm it's wired/logged at the entrypoint (close the loop).
[6]  src/worker/index.ts     clearing cookies: use a helper instead of hand-rolled Set-Cookie?
[7]  src/worker/index.ts     switch vs if for route dispatch? (no full router). Implementer's call.
[8]  src/worker/index.ts     route paths repeated -> shared constants.
[9]  src/worker/index.ts     401 re-auth block duplicated -> factor into one path.
[10] src/core/oauth.ts       all functions need block comments AND unit tests (comments here; unit tests in Phase 4a).
[11] src/core/oauth.ts       burnState -> clearStateCookieString; rename everywhere.
[12] src/core/oauth.ts       rejectAndBurn maybe unnecessary -> inline if used <=2x; keep only if it earns its place.
[13] src/core/oauth.ts       beginLogin needs an explanatory block comment.
[14] src/core/session.ts     session id rationale -> single randomUUID + OWASP comment.
[15] src/core/session.ts     doRefresh block comment; sanity-check vs arctic refreshAccessToken/OAuth2Tokens shape.
[16] src/core/session.ts     on dead refresh: preserve the error, don't hide it; implement the refresh-race retry-on-reread.
[17] app-manifest.json       placeholders must FAIL until replaced -> {{REPLACE_WITH_DOMAIN_e.g._htmldocs.mydomain.ai}} style.
[20] scripts/setup/create-worker-app.mjs  add a short purpose paragraph.
[21] scripts/setup/create-worker-app.mjs  when browser-open is skipped, PRINT the URL/message so the agent sees it.
[23] README.md               delete the "What this deliverable is (and is NOT)" section.
[24] README.md               env table -> org scope only (no repo/branch). (prose)
[25] README.md               routes table -> new /{repo}/{path}?ref= shape. (prose)
[26] README.md               remove DOC_BRANCH from the config example. (prose)
[27] README.md               don't restate what scripts do; collapse / speak broadly.
[28] README.md               update "Use it" for new paths; remove the "No session ->" line (behavior, not usage).
[33] wrangler.toml           make the route/domain placeholder FAIL until updated (with a brief comment).`

// Loosened schema: comment is a STRING, no additionalProperties:false, minimal required fields.
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
          comment: { type: 'string', description: "PR comment number as a string, e.g. '14'" },
          text: { type: 'string' },
        },
      },
    },
    blocked: { type: 'string', description: 'Empty/omitted if green; else the failing output.' },
  },
}

function prompt(body) {
  return `${body}\n\n${DONE}\n\n${DECISIONS}\n\n${COMMENTS}\n\n${GATE}\n\n${NO_GITHUB}`
}

const results = []

// ---------------------------------------------------------------------------
// Phase 3 — Core auth code-quality pass (serial; one owner of the auth files).
phase('CoreQuality')
results.push(await agent(
  prompt(`PHASE 3 — Core auth code-quality pass. Work in ${APP}. You OWN a coherent edit of src/core/oauth.ts,
src/core/session.ts, src/core/cookies.ts, and src/worker/index.ts. Do it as ONE consistent pass.
- ERROR HANDLING [1][3][16]: make readCookie throw a documented typed error instead of silent null (or justify keeping
  null if genuinely cleaner for an absent cookie -- but a PARSE problem should throw); confirm safeSegments/InvalidPathError
  is caught + logged at the worker entrypoint and mapped to neutral 404 [3]; on dead refresh, preserve the original error
  (cause) and log it -- don't swallow [16].
- REFRESH RACE [16/decision]: implement retry-on-reread in the session refresh path; brief comment that the residual race
  is a known D1 limitation (no DO).
- SESSION ID [14]: single crypto.randomUUID() + OWASP comment.
- NAMING [11]: burnState -> clearStateCookieString everywhere.
- DEDUP/STRUCTURE [7][8][9][12]: route paths as shared constants [8]; factor the duplicated 401 re-auth into one path
  [9]; decide rejectAndBurn inline-vs-keep by actual call count [12]; switch-vs-if your call [7], keep it simple.
- HELPERS [1][6]: adopt the tiny standard helpers per the HELPERS decision where they cut code, else clean hand-roll. Be consistent.
- COMMENTS [10][13][15]: concise block comments on the oauth.ts functions, beginLogin, and doRefresh; for [15] sanity-check
  the refresh impl against arctic's refreshAccessToken/OAuth2Tokens shape.
(oauth.ts UNIT TESTS are Phase 4a, not here.) Owns: [1][3][6][7][8][9][11][12][13][14][15][16] + comment-half of [10].
Reach the green gate.`),
  { label: 'p3:corequality', phase: 'CoreQuality', schema: PHASE_SCHEMA, effort: 'high' }
))
log(`Phase 3 gate: tsc=${results[0]?.gate?.tsc} vitest=${results[0]?.gate?.vitest} dryRun=${results[0]?.gate?.dryRun}${results[0]?.blocked ? ' BLOCKED' : ''}`)

// ---------------------------------------------------------------------------
// Phase 4 — Tests & standalone docs (PARALLEL: disjoint files).
phase('TestsDocs')
const p4 = (await parallel([
  () => agent(
    prompt(`PHASE 4a — Core unit tests [10]. Work in ${APP}. Using the vanilla-vitest core project (test/core/, node env --
NOT pool-workers), add focused unit tests for the pure helpers in src/core/oauth.ts (and any pure helpers touched in
Phase 3): state HMAC sign/verify, timingSafeEqual, b64url, and clearStateCookieString output. (safeSegments already has
tests in test/core/docsource.test.ts -- extend only if Phase 3 changed its contract.) Only create/edit files under
test/core/. Owns the unit-test half of [10]. Reach the green gate (both vitest projects pass).`),
    { label: 'p4a:coretests', phase: 'TestsDocs', schema: PHASE_SCHEMA, effort: 'high' }
  ),
  () => agent(
    prompt(`PHASE 4b — create-app polish. Work ONLY in ${APP}/scripts/setup/create-worker-app.mjs.
- Add a short purpose paragraph at the top [20]: roughly "Helper for the GitHub App Manifest flow: creates the org's
  GitHub App, captures the returned credentials, and wires them into the Worker setup."
- When the browser auto-open is skipped, PRINT the URL / a clear message so the running agent/admin sees what to do [21].
Touch ONLY that file. Owns: [20][21]. Reach the green gate.`),
    { label: 'p4b:createapp', phase: 'TestsDocs', schema: PHASE_SCHEMA, effort: 'low' }
  ),
  () => agent(
    prompt(`PHASE 4c — Fail-loud placeholders. Work in ${APP}.
- app-manifest.json [17]: replace soft placeholders with ones that clearly FAIL until replaced, e.g.
  "{{REPLACE_WITH_DOMAIN_e.g._htmldocs.mydomain.ai}}".
- wrangler.toml [33]: make the route/domain (and any remaining placeholder) obviously invalid until edited, with a brief
  comment. Do NOT re-add DOC_REPO/DOC_BRANCH (removed in Phase 2).
Touch ONLY those two files. Owns: [17][33]. Reach the green gate (dry-run may warn on a placeholder domain -- fine -- but
tsc/vitest must pass and the toml must parse).`),
    { label: 'p4c:placeholders', phase: 'TestsDocs', schema: PHASE_SCHEMA, effort: 'low' }
  ),
])).filter(Boolean)
results.push(...p4)
log(`Phase 4 done: ${p4.length}/3 sub-phases; blocked=${p4.filter(r => r?.blocked).length}`)

// ---------------------------------------------------------------------------
// Phase 5 — README cleanup (serial; LAST, depends on final scope/paths/tests).
phase('Readme')
results.push(await agent(
  prompt(`PHASE 5 — README cleanup. Work in ${APP}/README.md.
- Delete the "What this deliverable is (and is NOT)" section [23].
- Update the env/config table + examples for ORG scope: only DOC_OWNER; no DOC_REPO/DOC_BRANCH [24][26].
- Update routes/usage for the NEW URL shape /{repo}/{path}?ref=... [25][28]; remove the "No session ->" line from "Use it" [28].
- Collapse the step-by-step restatement of what the setup scripts do into a broad description [27].
- Fix any paths changed in phase 1 (scripts/setup/, docs/plans/d1-spikes.md). (Test-split note [29] already added.)
Owns: [23][24][25][26][27][28]. Reach the green gate (docs-only; confirm nothing references deleted vars).`),
  { label: 'p5:readme', phase: 'Readme', schema: PHASE_SCHEMA, effort: 'high' }
))
log(`Phase 5 gate: tsc=${results[results.length-1]?.gate?.tsc} vitest=${results[results.length-1]?.gate?.vitest} dryRun=${results[results.length-1]?.gate?.dryRun}`)

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
