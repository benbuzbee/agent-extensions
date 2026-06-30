export const meta = {
  name: 'build-htmldoc-review-d1',
  description: 'Research minimal practices, then implement + locally test Deliverable 1 (proxy + auth) of the htmldoc-review Worker',
  phases: [
    { title: 'Research', detail: 'parallel web-grounded research per artifact (manifest, wrangler.toml, deploy, arctic OAuth, KV sessions, vitest-pool-workers)' },
    { title: 'Synthesize', detail: 'merge findings + plan doc + locked decisions into one build spec (file tree, binding/secret/var names)' },
    { title: 'Implement', detail: 'build disjoint artifacts + tests in parallel from the shared spec' },
    { title: 'Verify', detail: 'RUN tsc + vitest + wrangler dry-run, plus static coherence/security lenses' },
    { title: 'Fix', detail: 'apply blocker fixes, re-run the build/test gate' },
  ],
}

// ---------------------------------------------------------------------------
// Shared context every agent grounds in.
const PLAN = 'docs/plans/htmldoc_worker_review.html'
const APP_DIR = 'apps/htmldoc-review'

const SCOPE = `Deliverable 1 ONLY = proxy + auth. A Cloudflare Worker that:
(1) logs a viewer in via a GitHub APP user-to-server OAuth flow; stores the token SERVER-SIDE in Workers KV keyed by an
    opaque session-id cookie (cookie holds ONLY the id; HttpOnly; Secure; SameSite=Lax);
(2) fetches the requested doc from the GitHub Contents API AS THAT USER
    (GET /repos/{owner}/{repo}/contents/{path}?ref={branch}, owner from DOC_OWNER config);
    200 -> serve raw HTML; 404 -> neutral "not found or no access" (do NOT distinguish missing from forbidden).
NO review-UI injection, NO comment store, NO HTMLRewriter, NO D1/SQL — those are Deliverable 2.
Topology: self-hosted, per-org. Each org creates its OWN GitHub App via the App Manifest flow and runs its OWN Worker;
we ship a manifest template + a wrangler-based setup script. We never hold anyone's secret.`

// Decisions already made WITH THE USER — agents must honor these, not relitigate them.
const DECISIONS = `LOCKED TECH DECISIONS (do not reopen):
- Token storage: Workers KV with native per-key TTL (put(key, val, { expirationTtl })) for {session_id -> access_token,
  refresh_token, expires_at}. Cleanup is the native TTL — NO Durable Object, NO alarm, NO D1/SQL in Deliverable 1.
- Expiry handling: two tiers. 8h access token expired -> SILENT refresh using the 6-month refresh token, write the new
  token back to KV, continue the request. Refresh token expired/revoked -> only THEN bounce through full GitHub re-login.
- OAuth library: use "arctic" (arcticjs.dev) for the GitHub token exchange + refresh — it has CONFIRMED GitHub-App
  support (refreshAccessToken(), accessTokenExpiresAt()) and is Workers-native. Do NOT use @octokit/core for the
  Contents call (heavy + nodejs_compat friction) — use plain fetch. Do NOT rely on @hono/oauth-providers for refresh.
- Hand-roll (no library): the single-use signed 'state' CSRF nonce (HMAC via Web Crypto, short-lived cookie, verify-and-burn
  on callback); the session read/write/refresh logic; the opaque session-id cookie.
- Contents API: plain fetch with Authorization: Bearer <token>, Accept: application/vnd.github.raw+json, a User-Agent header.
- Local testing: @cloudflare/vitest-pool-workers (real workerd runtime, local KV, mockable outbound fetch). Tests must NOT
  hit real GitHub or need real credentials — mock the GitHub fetch to return canned 200/404/token responses.`

// ---------------------------------------------------------------------------
// Schemas
const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['artifact', 'minimalPractices', 'minimalExample', 'pitfalls', 'recommendation', 'citations'],
  properties: {
    artifact: { type: 'string' },
    minimalPractices: { type: 'array', items: { type: 'string' }, description: 'Smallest-footprint current best practices' },
    minimalExample: { type: 'string', description: 'A concrete minimal example (file contents / command sequence / code)' },
    pitfalls: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string', description: 'What WE should do for this artifact, given the locked scope + decisions' },
    citations: { type: 'array', items: { type: 'string' } },
  },
}

const SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'bindings', 'secrets', 'envVars', 'routes', 'testPlan', 'notes'],
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'purpose', 'keyContents'],
        properties: {
          path: { type: 'string' },
          purpose: { type: 'string' },
          keyContents: { type: 'string', description: 'Enough that an implementer writes it without guessing — fold in the minimal examples from research' },
        },
      },
    },
    bindings: { type: 'array', items: { type: 'string' }, description: 'Exact binding names used in BOTH wrangler.toml and Worker code (e.g. SESSIONS for the KV namespace)' },
    secrets: { type: 'array', items: { type: 'string' }, description: 'Exact secret names set via wrangler secret put' },
    envVars: { type: 'array', items: { type: 'string' }, description: 'Exact non-secret config var names (e.g. DOC_OWNER)' },
    routes: { type: 'array', items: { type: 'string' } },
    testPlan: { type: 'array', items: { type: 'string' }, description: 'The specific behaviors the vitest suite must cover (state CSRF, 404-no-leak, 200 serve, silent refresh, cookie shape)' },
    notes: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'issue', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tscPass', 'vitestPass', 'dryRunPass', 'commandLog', 'failures'],
  properties: {
    tscPass: { type: 'boolean' },
    vitestPass: { type: 'boolean' },
    dryRunPass: { type: 'boolean', description: 'wrangler deploy --dry-run succeeded (builds + validates config locally, no upload)' },
    commandLog: { type: 'string', description: 'The actual commands run and their key output' },
    failures: { type: 'array', items: { type: 'string' }, description: 'Specific failing tests / type errors / config errors, verbatim' },
  },
}

// ---------------------------------------------------------------------------
// Phase 1 — Research (parallel, web-grounded, minimal-practice focused).
phase('Research')
const ANGLES = [
  {
    key: 'github-app-manifest',
    prompt: `Research the MINIMAL GitHub App Manifest + create-from-manifest flow for self-hosted use. Need: Contents=read-only,
"request user authorization (OAuth) during installation" enabled, user-token EXPIRATION enabled, one callback URL, and the manifest
'redirect_url'. Cover the exact minimal manifest JSON keys; POST to /settings/apps/new?state=; the code->credentials conversion
(POST /app-manifests/{code}/conversions) and what it returns (id, pem, client_id, client_secret, webhook_secret). Find the SMALLEST correct manifest.`,
  },
  {
    key: 'wrangler-toml',
    prompt: `Research the MINIMAL modern wrangler.toml (Wrangler v4, current compatibility_date) for a Worker needing a Workers KV
namespace binding, plain [vars] config, and a route/custom-domain. Show the smallest valid config with correct current keys
(name, main, compatibility_date, [[kv_namespaces]], [vars], routes). Note deprecated keys to avoid. NO d1/D1 — we are not using SQL in D1.`,
  },
  {
    key: 'wrangler-deploy',
    prompt: `Research the MINIMAL wrangler CLI workflow for a single setup.sh an org admin runs: creating a KV namespace (wrangler kv namespace create)
and wiring its id into wrangler.toml; setting secrets (wrangler secret put); a .dev.vars file for local dev; wrangler deploy; and
wrangler deploy --dry-run (what it validates locally without uploading). NO D1 commands.`,
  },
  {
    key: 'arctic-github-oauth',
    prompt: `Research the "arctic" library (arcticjs.dev) GitHub provider for a GitHub APP user-to-server flow on Cloudflare Workers.
Cover the exact API: constructing the GitHub provider, creating the authorization URL (and where 'state' goes), validateAuthorizationCode(code)
-> tokens with accessToken()/accessTokenExpiresAt()/refreshToken(), and refreshAccessToken(refreshToken). Confirm GitHub-APP expiring-token +
refresh support specifically (not classic OAuth App). Give a minimal TS sketch. Also confirm it runs on workerd without nodejs_compat.`,
  },
  {
    key: 'kv-session-ttl',
    prompt: `Research Workers KV as a session store with native TTL. Cover: put(key, value, { expirationTtl }) semantics and the MINIMUM
allowed TTL; get() for reads; delete() for explicit logout; the ~60s eventual-consistency window and exactly when it bites for sessions
(immediately-after-login reads at a different PoP). Give a minimal sessions helper (create/get/refresh/delete) for {session_id -> access_token,
refresh_token, expires_at}. Confirm there is no cleanup code needed beyond TTL.`,
  },
  {
    key: 'vitest-pool-workers',
    prompt: `Research @cloudflare/vitest-pool-workers for unit-testing a Worker locally in the real workerd runtime. Cover: minimal setup
(vitest.config + the pool), how local KV bindings work in tests, and HOW TO MOCK OUTBOUND fetch to GitHub (so tests return canned 200/404/token
responses with NO real network or credentials). Show a minimal test that drives a fetch handler and asserts on the Response. Cite Cloudflare docs.`,
  },
]

const research = (await parallel(ANGLES.map(a => () =>
  agent(
    `${a.prompt}\n\nProject scope:\n${SCOPE}\n\n${DECISIONS}\n\nUse web search / WebFetch (and the ctx7 CLI if available) for CURRENT docs — do not rely on memory. Return findings for artifact "${a.key}".`,
    { label: `research:${a.key}`, phase: 'Research', schema: RESEARCH_SCHEMA }
  )
))).filter(Boolean)

log(`Research complete: ${research.length}/${ANGLES.length} artifacts covered`)

// ---------------------------------------------------------------------------
// Phase 2 — Synthesize ONE locked build spec. Barrier: needs all research to fix
// binding/secret/var names and the test plan globally.
phase('Synthesize')
const spec = await agent(
  `You are the architect. Turn the research + plan doc + locked decisions into ONE internally-consistent build spec for ${APP_DIR}.
Read ${PLAN} for the agreed design (abstractions, decisions, D1 exit criteria).

Scope:\n${SCOPE}\n\n${DECISIONS}

Decide the EXACT shared contract every implementer obeys: file tree under ${APP_DIR}, binding names (the KV namespace binding, e.g. SESSIONS),
secret names, env var names (incl. DOC_OWNER), routes, and the testPlan. Keep it MINIMAL. Expected files: app-manifest.json (+ tiny create-app
helper), wrangler.toml, setup.sh, package.json (deps: arctic, wrangler, vitest, @cloudflare/vitest-pool-workers, typescript), tsconfig.json,
vitest.config.ts, src/ (router, oauth via arctic, session via KV, docsource/proxy fetch), test/ (the vitest suite), .dev.vars.example, README.
Fold the per-artifact minimal examples from research into keyContents so implementers don't re-derive them.

Research findings (JSON):\n${JSON.stringify(research)}`,
  { label: 'synthesize:spec', phase: 'Synthesize', schema: SPEC_SCHEMA }
)

log(`Spec locked: ${spec.files.length} files; bindings=[${spec.bindings}] secrets=[${spec.secrets}]; ${spec.testPlan.length} test behaviors`)

// ---------------------------------------------------------------------------
// Phase 3 — Implement. Parallel over DISJOINT file groups; all obey the locked spec.
phase('Implement')
const SPEC_JSON = JSON.stringify(spec)
const groups = [
  {
    key: 'manifest+create',
    files: 'app-manifest.json and any small create-app helper/page',
    detail: 'Minimal GitHub App Manifest (Contents:read, user OAuth on, token expiry on, callback) + the create-from-manifest helper capturing returned credentials.',
  },
  {
    key: 'wrangler+setup+pkg',
    files: 'wrangler.toml, setup.sh, package.json, tsconfig.json, vitest.config.ts, .dev.vars.example',
    detail: 'wrangler.toml with the exact spec KV binding + vars (NO d1); setup.sh that runs wrangler kv namespace create, sets secrets, deploys; package.json with arctic + vitest + vitest-pool-workers + wrangler + typescript; tsconfig + vitest.config wired to @cloudflare/vitest-pool-workers. NO secrets committed.',
  },
  {
    key: 'worker-src',
    files: 'everything under src/ (router, oauth, session, docsource proxy)',
    detail: 'The Worker: router with spec routes; GitHub user-to-server OAuth via arctic (authorize URL + validateAuthorizationCode + refreshAccessToken) with a hand-rolled signed single-use state cookie; KV session store (create/get/refresh/delete with expirationTtl); silent-refresh on expired access token; DocSource proxy fetch as the user (?ref), 200->serve raw HTML, 404->neutral page. TypeScript; no injection, no comments, no D1.',
  },
  {
    key: 'tests',
    files: 'everything under test/ (the vitest suite)',
    detail: 'vitest-pool-workers tests covering the spec testPlan: state mint/verify + replay rejection; 404-from-GitHub -> neutral page with NO distinct 403; 200 -> raw HTML served; expired access token -> silent refresh path (mock the refresh); cookie carries only the session id with correct flags. MOCK the outbound GitHub fetch — no real network/creds.',
  },
  {
    key: 'readme+spikes',
    files: 'README.md and SPIKES.md',
    detail: 'README: self-hosted setup walkthrough (create App via manifest -> install on org -> run setup.sh -> use) + how to run tests locally. SPIKES.md: the MANUAL checklist incl. Spike 1 (live intersection 200/404) that cannot run unattended, and the GitHub-actually-returns-404-not-403 assumption to confirm.',
  },
]

const built = (await parallel(groups.map(g => () =>
  agent(
    `Implement the "${g.key}" part of the htmldoc-review Worker (Deliverable 1), writing ONLY these files: ${g.files}.
${g.detail}

Obey the LOCKED spec exactly — use its binding/secret/var names and routes verbatim; do not invent alternatives; do not touch files outside your group.
Write real, working, minimal code/config — no placeholders except genuinely deployment-specific values (use the spec's env/secret names). Create files under ${APP_DIR}.

Scope:\n${SCOPE}\n\n${DECISIONS}\n\nLOCKED SPEC (JSON):\n${SPEC_JSON}`,
    { label: `impl:${g.key}`, phase: 'Implement' }
  )
))).filter(Boolean)

log(`Implementation complete: ${built.length}/${groups.length} file groups written`)

// ---------------------------------------------------------------------------
// Phase 4 — Verify. The build/test GATE actually RUNS; two static lenses read.
phase('Verify')

async function runGate(label) {
  return agent(
    `Run the local build/test gate for ${APP_DIR} and report REAL results (run the commands; do not guess). In ${APP_DIR}:
1. Install deps (npm install or npm ci).
2. Type-check: npx tsc --noEmit.
3. Unit tests: npx vitest run (uses @cloudflare/vitest-pool-workers; tests mock GitHub — no network/creds needed).
4. Config/bundle validation WITHOUT deploying: npx wrangler deploy --dry-run (builds the bundle + validates wrangler.toml locally; no upload, no account needed).
Report each command's pass/fail and paste key output. If a command can't run, say why explicitly. Do NOT attempt a real deploy or any command needing real GitHub/Cloudflare credentials.`,
    { label, phase: 'Verify', schema: GATE_SCHEMA }
  )
}

const [gate, statics] = await Promise.all([
  runGate('verify:gate'),
  parallel([
    { key: 'coherence', prompt: `Static CROSS-FILE coherence in ${APP_DIR}: do wrangler.toml KV binding + vars match what the Worker reads from env? Do setup.sh secret/binding names match the code and spec? Does the manifest callback URL match the router's /auth/callback route? Do referenced files exist? NO d1 references should remain.` },
    { key: 'security', prompt: `Static SECURITY review of ${APP_DIR}: single-use signed 'state' CSRF nonce (minted, cookie-held, verify-and-burn); token stored in KV only, cookie holds just the opaque id with HttpOnly+Secure+SameSite; 404 path does NOT leak repo existence (no distinct 403 branch); silent-refresh writes the new token back and does not log it; NO secrets committed to source/wrangler.toml.` },
  ].map(l => () =>
    agent(
      `${l.prompt}\n\nRead the actual files. Scope is Deliverable 1 only — absence of injection/comments/D1 is CORRECT, not a finding.\n\nLOCKED SPEC (JSON):\n${SPEC_JSON}\n\nReturn findings for lens "${l.key}"; empty array if clean.`,
      { label: `verify:${l.key}`, phase: 'Verify', schema: REVIEW_SCHEMA }
    )
  )),
])

const reviews = statics.filter(Boolean)
const staticBlockers = reviews.flatMap(r => (r.findings || []).filter(f => f.severity === 'blocker' || f.severity === 'major'))
const gateFailed = !gate || !gate.tscPass || !gate.vitestPass || !gate.dryRunPass
log(`Verify: gate tsc=${gate?.tscPass} vitest=${gate?.vitestPass} dryRun=${gate?.dryRunPass}; ${staticBlockers.length} static blocker/major findings`)

// ---------------------------------------------------------------------------
// Phase 5 — Fix (only if the gate failed or static blockers exist), then re-run the gate.
phase('Fix')
let fixSummary = 'No gate failures or blocker/major findings — nothing to fix.'
let regate = gate
if (gateFailed || staticBlockers.length) {
  fixSummary = await agent(
    `Fix these problems in ${APP_DIR}, minimally and consistently with the locked spec (no Deliverable-2 scope).
${gateFailed ? `BUILD/TEST GATE FAILURES:\n${JSON.stringify({ tscPass: gate?.tscPass, vitestPass: gate?.vitestPass, dryRunPass: gate?.dryRunPass, failures: gate?.failures, commandLog: gate?.commandLog })}\n` : ''}
${staticBlockers.length ? `STATIC BLOCKER/MAJOR FINDINGS:\n${JSON.stringify(staticBlockers)}\n` : ''}
LOCKED SPEC (JSON):\n${SPEC_JSON}\n\nApply the fixes, then report what you changed.`,
    { label: 'fix:blockers', phase: 'Fix' }
  )
  regate = await runGate('verify:regate')
  log(`Re-gate after fix: tsc=${regate?.tscPass} vitest=${regate?.vitestPass} dryRun=${regate?.dryRunPass}`)
}

return {
  artifactsResearched: research.map(r => r.artifact),
  filesPlanned: spec.files.map(f => f.path),
  bindings: spec.bindings,
  secrets: spec.secrets,
  envVars: spec.envVars,
  routes: spec.routes,
  testPlan: spec.testPlan,
  staticFindings: reviews.map(r => ({ lens: r.lens, findings: (r.findings || []).length })),
  gate: { tscPass: regate?.tscPass, vitestPass: regate?.vitestPass, dryRunPass: regate?.dryRunPass, failures: regate?.failures },
  fixSummary,
  manualNext: 'Run SPIKES.md — esp. Spike 1 (live intersection 200/404) which needs a real installed App + real user creds.',
}
