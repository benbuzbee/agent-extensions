export const meta = {
  name: 'd2-build-stack',
  description: 'Build the full Deliverable 2 stacked-PR series (PR0..PR6) from d2-review-mode-plan.html: per-PR design (Opus) -> Fable advisor critique -> implement (Opus) -> offline validation gate -> Fable review + /code-review methodology on the diff -> validation evidence logged into the plan HTML -> Graphite commit',
  whenToUse: 'Execute the approved D2 plan. Deliverable: a SUBMITTED Graphite stack (one draft PR per layer) with real validation evidence (command output) published into a validation section of each PR card in the plan HTML. Requires: main checked out, gt installed + authed, node. Optional args: {submit:false} to skip submission and keep the stack local; {startAt:"pr3"} to resume mid-stack (earlier branches must already exist).',
  phases: [
    { title: 'Preflight', detail: 'verify git/gt/node state and plan artifacts', model: 'sonnet' },
    { title: 'PR0 — plan & workflow', detail: 'commit planning artifacts + this workflow; docs link check', model: 'sonnet' },
    { title: 'PR1 — extraction + store seam', detail: 'shared review-ux/ tree + adapters, branded types, LocalFileStore, article-gate removal, dist rebuild' },
    { title: 'PR2 — API business logic', detail: 'op envelope + zod/mini validation + OpResult + batch loop; local server mounts ?comments' },
    { title: 'PR3 — Worker + Cloudflare D1', detail: 'D1 binding/migration/deploy-script authored as code; D1Store; workerd tests vs migrated D1' },
    { title: 'PR4 — API on Worker + checkAccess', detail: '?comments on the doc route; probe-once-per-batch chokepoint; neutral 404' },
    { title: 'PR5 — identity capture', detail: 'GET /user at login; single persist() writer; lazy session upgrade; real author stamps' },
    { title: 'PR6 — injection + docs', detail: 'HTMLRewriter/string-splice via shared helpers; unified injection test; e2e; pass-1 docs' },
    { title: 'Wrap-up', detail: 'full-stack gate, exit-criteria audit, wrap-up evidence into the plan, submit the stack as draft PRs' },
  ],
}

// ===========================================================================
// Ground truth every agent shares.
// ===========================================================================
const REPO = '/Users/ben/agent-extensions'
const PLAN = REPO + '/docs/plans/worker/d2-review-mode-plan.html'
const APP = REPO + '/apps/htmldoc-review'
const SKILL = REPO + '/plugins/useful-skills/skills/htmldocs'
const WORKFLOW_FILE = REPO + '/docs/plans/worker/d2-build-workflow.js'

const CONTEXT = `REPO LAYOUT (verified):
- The plan (SOURCE OF TRUTH — read the sections each task names): ${PLAN}
- What Deliverable 1 shipped + gotchas: ${REPO}/docs/plans/worker/d1-handoff.md
- Worker app: ${APP} — portable src/core/ (config, cookies, oauth, session, docsource, responses, store [has the SessionId brand]), Cloudflare src/worker/ (index.ts entry, kv-store, logging), test/core (plain vitest) + test/worker (@cloudflare/vitest-pool-workers + fetch-mock.ts), scripts: npm run typecheck | npm test | npx wrangler deploy --dry-run.
- htmldocs skill: ${SKILL} — src/comments/{main,ui,anchor,types,persistence,serve}.ts, checked-in dist/comments.mjs + dist/serve.mjs (esbuild, see package.json build scripts), playwright tests in test/, scripts: npm run check (typecheck+build+playwright+smoke). Read its CLAUDE.md before editing.
- Local review architecture: ${SKILL}/docs/review_system.html ; sidecar schema/agent recipe: ${SKILL}/references/comments.md
- Stack tool: Graphite (gt 1.8.6). Each PR is a branch stacked on its parent above main.`

const LOCKED = `NON-NEGOTIABLES distilled from the plan (its #decisions table is the full list — do not relitigate):
- Comment store = Cloudflare D1 (SQLite), ONE shared DB, Wrangler migrations from day one (0001_create_comments.sql). Sessions stay in Workers KV. Don't conflate the two stores' evolution mechanisms.
- API = body-ops over one collection URL: GET/POST <doc>?ref=<ref>&comments. v1 ops: create/resolve/reopen/delete; reply/edit are envelope-reserved (parse then 400 "op not yet supported"). Batch = a JSON array of op objects, best-effort per-op, 207 with per-op results in request order; no cross-op transaction.
- The LOCAL server route has NO <repo> segment (it serves a file tree); only the hosted Worker URL carries <repo>.
- checkAccess: ONE probe (GitHub Contents, Accept: application/vnd.github.object+json, status line only) at the single post-auth chokepoint, ONCE per request/batch. GitHub 403 AND 404 both map to the SAME neutral 404 (denialResponse). Comments must never leak a doc's existence.
- Branded ids: ThreadId/CommentId extending the SessionId brand pattern in src/core/store.ts. Timestamp = branded numeric epoch-milliseconds END TO END (D1 INTEGER === JSON number; no ISO strings anywhere).
- Validation: Zod 4 imported from zod/mini; safeParse rejects a malformed envelope with 400 BEFORE any store call. The anchor is validated for SHAPE only ({exact} required; prefix/suffix/sections optional) — DOM/semantic match is explicitly out of scope (the Worker streams via HTMLRewriter, no DOM).
- ICommentsStore seam (list/create/reply/resolve/reopen/delete/edit/batch) with LocalFileStore (server-only JSON; the agent NEVER reads the file off disk) and D1Store. batch() loops the single-op methods. OpResult is a discriminated union: first on ok, then on op.
- One shared review-ux/ package = EVERY pixel + interaction (anchor, highlight, gutter, popover, composer, mount lifecycle); adapters/{local,hosted}/ own transport + identity + injection ONLY. MountDeps {store, author} is the seam; each directory gets a claude.md stating its sharing contract. The article-only popover gate is removed (any non-collapsed selection in the doc body, excluding the widget's own UI).
- Identity: completeLogin calls GET /user once, persists {login,name,id} + version:2 on the session KV record; single persist() chokepoint writes ALL session records; iat is pinned (minted once, carried on refresh — never bumped); older sessions lazily upgrade on read, nobody is logged out. Author is stamped server-side from session/token, never from the request body.
- Resolve = soft-close: stamps resolved_at, row kept, indicator turns GREEN and the comment STAYS VISIBLE (never hidden). Delete = hard purge by threadId. Anyone who can see the doc may resolve. Agent surface: list + resolve/reopen + delete — NO agent create in v1.
- Injection: shared seedJsonScript(model)/widgetScriptTag() helpers own the emitted markup AND the </script>-breakout escaping; each runtime only PLACES those strings (string-splice before </body> locally; HTMLRewriter body-append hosted, on 200 HTML only — the neutral-404 path untouched).
- ref sentinel: a missing ?ref= is stored AND queried as the literal string 'default' (never '' or NULL); route and store must agree.`

const GUARDRAILS = `HARD GUARDRAILS (violating any is task failure):
- OFFLINE ONLY for YOU. NEVER run: wrangler deploy (without --dry-run), wrangler d1 create, wrangler d1 migrations apply --remote, wrangler secret put, git push, gt submit. (The orchestrator submits the finished stack in its own wrap-up step — that is not your job.) Deploy/provisioning changes are AUTHORED AS CODE in deploy.sh/wrangler.toml, not executed. Local-only commands (vitest, miniflare/workerd, wrangler deploy --dry-run, d1 migrations apply --local inside tests) are fine.
- Tests never hit real GitHub and never need real credentials — mock outbound fetch (see test/worker/fetch-mock.ts).
- Never log or commit tokens/secrets. .dev.vars stays untracked.
- Work only inside ${REPO}. Do not touch ~/infrastructure or any deployed Worker.
- Preserve Deliverable 1 behavior: existing tests keep passing; the neutral-404 non-leak contract survives every change.`

const ADVISOR_TIP = `If you hit a consequential design fork the spec/plan does not settle, you may consult a Fable-class advisor: use the Agent tool with subagent_type "claude" and model "fable", ask ONE crisp question with the 2-3 options and your lean, and apply the answer. Use sparingly — most calls are already made in the plan.`

// ===========================================================================
// Forgiving schemas. Lesson from the D1 build: strict schemas (typed ints,
// additionalProperties:false, deep required) trip the StructuredOutput retry
// cap and kill agents whose file work already succeeded. One required anchor
// field each, free-form strings, results read defensively below.
// ===========================================================================
const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2-4 sentence digest of the design' },
    fileChanges: { type: 'string', description: 'file-by-file: path -> what lands there (tree + prose)' },
    decisions: { type: 'array', items: { type: 'string' }, description: 'calls made where the plan left latitude, with one-line rationale each' },
    testPlan: { type: 'array', items: { type: 'string' }, description: 'the specific behaviors the new tests assert' },
    commands: { type: 'array', items: { type: 'string' }, description: 'EXACT validation commands (with cd <absolute dir> prefixes) the gate should run for this PR, beyond the standing gates' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary'],
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: '"approve" or "revise"' },
    mustFix: { type: 'array', items: { type: 'string' }, description: 'blocking problems; empty if approve' },
    suggestions: { type: 'array', items: { type: 'string' }, description: 'non-blocking improvements worth folding in cheaply' },
    notes: { type: 'string' },
  },
  required: ['verdict'],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'true only if EVERY command succeeded' },
    commandLog: { type: 'string', description: 'each command run + the VERBATIM tail of its real output (test counts, "N passed" summary lines, dry-run success line). This log is published as validation evidence in the plan doc — it must be real terminal output, not paraphrase.' },
    failures: { type: 'array', items: { type: 'string' }, description: 'each failing command/test/type error, verbatim enough to act on' },
  },
  required: ['commandLog'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: '"approve" or "fix"' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', description: 'blocker | major | minor' },
          file: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
  required: ['verdict'],
}

const ISSUES_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          file: { type: 'string' },
          reason: { type: 'string', description: 'why flagged: CLAUDE.md adherence | bug | git history | prior PR feedback | code-comment guidance' },
        },
      },
    },
  },
  required: [],
}

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'string', description: 'confidence 0-100 that the issue is real (a bare number is fine too)' },
    reasoning: { type: 'string' },
  },
  required: ['score'],
}

// Defensive readers — agents get subtle shapes wrong; never let that crash the run.
const ok = (v) => v === true || v === 'true'
const arr = (x) => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x])
const str = (x) => (typeof x === 'string' ? x : JSON.stringify(x ?? ''))
const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0 }
const blockers = (r) =>
  arr(r?.findings).filter((f) => /blocker|major/i.test(str(f?.severity)) || (!f?.severity && str(r?.verdict).toLowerCase().includes('fix')))

// ===========================================================================
// Standing validation gates (real, verified npm scripts).
// ===========================================================================
const SKILL_GATE = [
  `cd ${SKILL} && npm install`,
  `cd ${SKILL} && npx playwright install chromium`,
  `cd ${SKILL} && npm run check`,
]
const APP_GATE = [
  `cd ${APP} && npm install`,
  `cd ${APP} && npm run typecheck`,
  `cd ${APP} && npm test`,
  `cd ${APP} && npx wrangler deploy --dry-run`,
]

// ===========================================================================
// The PR cards. scope = condensed brief; the plan card (planAnchor) is the
// full spec and every agent must read it. gates = standing commands; the
// design's own `commands` are appended at gate time.
// ===========================================================================
const CARDS = [
  {
    key: 'pr0', phase: 'PR0 — plan & workflow', branch: 'd2/pr0-plan-docs', planAnchor: '#pr0',
    needsDesign: false, implModel: 'sonnet', securityLens: false,
    scope: `Land the planning artifacts as the base of the stack. Commit exactly these files (all should already exist; create nothing new except fixing broken internal links if the check finds any):
- docs/plans/worker/d2-review-mode-plan.html (the plan)
- docs/plans/worker/d2-plan-revisions.md
- docs/plans/worker/d2-round2-workflow.js and d2-round3-workflow.js (planning-round history)
- docs/plans/worker/d2-build-workflow.js (THIS execution workflow)
No product code changes. If 'git status' shows other unexpected untracked files, leave them out and mention them in your report.`,
    validate: `Docs-only check: every internal href/anchor inside d2-review-mode-plan.html resolves (in-page #ids exist; relative file links point at real files); the build workflow's phases map 1:1 to the plan's PR0-PR6 cards. Report pass/fail with the broken links listed.`,
    gates: [],
  },
  {
    key: 'pr1', phase: 'PR1 — extraction + store seam', branch: 'd2/pr1-extraction-store-seam', planAnchor: '#pr1 (plus #widget, #widget-dirs, #widget-share, #anchoring)',
    needsDesign: true, implModel: 'opus', securityLens: false,
    scope: `LOCAL ONLY. Move ${SKILL}/src/comments/ into the shared comments/ tree from the plan's #widget-dirs layout: review-ux/ (anchor, types, store seam, highlight, gutter, popover, composer, mount — every pixel and interaction) + adapters/local/ + adapters/hosted/ (hosted may be stubs/claude.md-only where the plan defers), each directory with its claude.md sharing contract. Remove the article-only popover gate (minimal predicate: non-collapsed selection, in doc body, not inside widget UI). Land the FULL type layer: branded ThreadId/CommentId/Timestamp (extend the SessionId brand pattern), Anchor, Author/Comment/Thread, per-op envelope types (CreateOp/ResolveOp/ReopenOp/DeleteOp; ReplyOp/EditOp reserved), the OpResult discriminated union, ICommentsStore + MountDeps. Ship LocalFileStore behind the seam. The skill's esbuild step MUST still emit the checked-in dist/comments.mjs and dist/serve.mjs (update package.json entry paths as needed). NO Zod, NO op handlers, NO Worker changes — those are PR2/PR3.
KEY OPEN CALL THE DESIGN MUST SETTLE (plan flags it open): the physical home of the shared comments/ tree such that both the skill esbuild and the (future) Worker build can consume it — decide, justify, record.`,
    validate: `Unit tests for LocalFileStore round-trip + anchor encode/decode across block/inline boundaries; playwright regression proves the popover now appears OUTSIDE <article> and resolve shows a green indicator with the comment still visible; dist/comments.mjs + dist/serve.mjs rebuilt (git diff shows them regenerated); full skill 'npm run check' green.`,
    gates: SKILL_GATE,
  },
  {
    key: 'pr2', phase: 'PR2 — API business logic', branch: 'd2/pr2-comment-api-logic', planAnchor: '#pr2 (plus #api, #api-route, #api-verbs, #api-v1, #anchor-validation)',
    needsDesign: true, implModel: 'opus', securityLens: false,
    scope: `RUNTIME-AGNOSTIC. Implement the whole comment API as pure logic that knows nothing about Cloudflare, against PR1's types: one handler per v1 verb (create/resolve/reopen/delete), reply/edit parsed-then-400, zod/mini per-op schemas rejecting a malformed envelope with 400 BEFORE any store call, anchor shape-only validation, each handler returning its OpResult arm, batch as a loop over the single-op methods (best-effort, ordered results, 207 for arrays). Mount it on the LOCAL Node server (serve.ts) over HTTP at <doc>?ref=&comments (NO repo segment locally) against LocalFileStore, so curl drives every verb with no Worker. Author is supplied by the caller/runtime, never read from the body.`,
    validate: `One unit suite per verb; batch partial-failure (one bad op does not roll back the rest); zod rejection cases (unknown op, missing field, non-array batch, bad anchor shape) all 400 with zero store interaction; resolve/reopen idempotency (no double timestamp overwrite); an HTTP-level test against the local server exercising list/create/resolve/delete/batch end to end.`,
    gates: SKILL_GATE,
  },
  {
    key: 'pr3', phase: 'PR3 — Worker + Cloudflare D1', branch: 'd2/pr3-worker-d1-store', planAnchor: '#pr3 (plus #store, #db-design, #db-schema, #db-migrations)',
    needsDesign: true, implModel: 'opus', securityLens: true,
    scope: `Bring the database online — provisioning AS CODE and the store, no API mounted yet. Add [[d1_databases]] to wrangler.toml (database_id = "REPLACE_WITH_D1_DATABASE_ID" placeholder), extend scripts/setup/deploy.sh with the guarded create-once step (grep placeholder -> wrangler d1 create -> sed the 36-char UUID in) and the unconditional post-deploy 'wrangler d1 migrations apply <db> --remote' (mirroring the existing idempotent steps — study deploy.sh first); ensure vendor.sh carries migrations/. Add migrations/0001_create_comments.sql exactly per the plan's DDL (epoch-ms INTEGER timestamps, idx_comments_doc on (repo,ref,path), ref DEFAULT 'default'). Implement D1Store behind ICommentsStore: normalize missing ref to 'default' on write, back Q1-Q4, resolve/reopen guard on real transitions (zero rows -> not_found), batch loops the single-op methods. NOTHING here runs against live infrastructure.`,
    validate: `Workerd tests via @cloudflare/vitest-pool-workers: migrations applied into Miniflare's D1 with readD1Migrations/applyD1Migrations; create->list->resolve->reopen->delete round-trips asserted from inside the Worker; the ref sentinel behavior asserted ('default' stored and queried). tsc, full app vitest, wrangler deploy --dry-run all green. NO live deploy, NO real D1.`,
    gates: APP_GATE,
  },
  {
    key: 'pr4', phase: 'PR4 — API on Worker + checkAccess', planAnchor: '#pr4 (plus #authz, #authz-probe, #authz-deny, #api-route)', branch: 'd2/pr4-worker-api-checkaccess',
    needsDesign: true, implModel: 'opus', securityLens: true,
    scope: `Mount PR2's logic on the Worker and put authorization in front of it. The catch-all route gains one branch: query string carries the bare key 'comments' -> comment handler with the already-parsed (repo, ref, path); else serveDoc. checkAccess(cfg, store, token, repo, ref, path) sits at the single post-auth chokepoint BEFORE the fork, probing GitHub Contents with Accept: application/vnd.github.object+json, status line only; 200/304 pass, everything else returns denialResponse = the shared neutral 404. The probe runs ONCE per request/batch, never per op. Writes stamp Author through the seam from a PLACEHOLDER identity satisfying the NOT NULL author columns (real capture is PR5 — do not reach forward). Missing ?ref= normalizes to the 'default' sentinel consistently with the doc route and store.`,
    validate: `Workerd suites (mocked GitHub fetch): each verb + batch against migrated D1; unauthorized doc -> neutral 404 byte-identical to the doc route's (no existence leak, no widget markup); a spy asserts the probe fires EXACTLY ONCE per batch request; 401-refresh-retry on serveDoc still works; envelope 400s produce no store calls and no probe leak.`,
    gates: APP_GATE,
  },
  {
    key: 'pr5', phase: 'PR5 — identity capture', branch: 'd2/pr5-identity-capture', planAnchor: '#pr5 (plus #identity, #identity-existing-sessions, #identity-writer, #identity-logging)',
    needsDesign: true, implModel: 'opus', securityLens: true,
    scope: `Real author names. completeLogin calls GET /user once and persists {login, name, id} + version on the session record. ALL session writes (login, refresh, lazy backfill) go through ONE persist() chokepoint in core/session.ts per the plan's sketch: version stamped every write, iat pinned (prior?.iat else now — a refresh must NEVER bump it), identity pinned/carried unless a fresher one is supplied, token triple supplied fresh. getValidAccessToken deletes-on-read any record with iat < SESSION_VALID_SINCE (new wrangler.toml [vars] entry, default 0). Pre-identity (version 1) records lazily upgrade on read via GET /user with the stored token — nobody is logged out. The comment API's author stamp switches from PR4's placeholder to the captured identity. Comment create/resolve log lines include author_login (identity is logged ON PURPOSE, per plan); tokens still never logged.`,
    validate: `Unit tests: persist() is the only SessionData constructor; iat pinned across refresh; version-1 record upgrades in place on read; SESSION_VALID_SINCE cutoff deletes-on-read and returns null. Workerd test: a created comment surfaces the real captured author name. Full app gate green.`,
    gates: APP_GATE,
  },
  {
    key: 'pr6', phase: 'PR6 — injection + docs', branch: 'd2/pr6-injection-docs', planAnchor: '#pr6 (plus #widget-inject, #prompting, and the exit-criteria aside in #phases)',
    needsDesign: true, implModel: 'opus', securityLens: true,
    scope: `Wire the widget into served docs + pass-1 docs. Shared seedJsonScript(model)/widgetScriptTag() helpers own the emitted markup and the </script>-breakout escaping (< -> \\u003c or &lt; inside the JSON seed); NEITHER runtime hand-rolls the tags. Local: serve.ts string-splices both before </body>. Hosted: HTMLRewriter appends both to <body> on 200 HTML doc responses ONLY — the neutral-404 path emits no widget, no seed. Seed carries open AND resolved threads, each with resolvedAt, plus the session author for MountDeps. Docs: a pass-1 doc at proxy.html's level (what we built, how an agent drives hosted review — the ?comments shape, bearer auth, list -> address -> resolve recipe, neutral-404 behavior) in the htmldocs skill path per plan decision 6, with the barest one-line SKILL.md pointer; ALSO round out the still-missing htmldoc-review skill docs flagged after Deliverable 1 (the docs-gap TODO) in this same pass.`,
    validate: `The UNIFIED injection test: one fixture doc + comments model through BOTH injectors, asserting the identical shared fragment (seed + script tag) — placement may differ, the emitted markup may not. Escaping test: a comment body containing </script> cannot break out of the seed. E2e in workerd: comment on a hosted doc, reload -> persists, resolve -> green indicator, comment still visible; 404 path has no widget markup. Both packages' full gates green.`,
    gates: [...APP_GATE, ...SKILL_GATE],
  },
]

// ===========================================================================
// Preflight
// ===========================================================================
phase('Preflight')
const pre = await agent(
  `Preflight for building a stacked-PR series in ${REPO}. Check and report (do not fix code):
1. 'git -C ${REPO} status --porcelain' — current branch must be main; tracked files clean. Untracked files under docs/plans/worker/ are EXPECTED (they are PR0's payload); list any OTHER untracked files as warnings.
2. These files exist: ${PLAN}, ${WORKFLOW_FILE}, ${REPO}/docs/plans/worker/d2-plan-revisions.md.
3. 'gt --version' works. Check Graphite is initialized for this repo (e.g. 'gt log short' from ${REPO} succeeds); if it errors about initialization, run 'gt init --trunk main' non-interactively and confirm it took.
4. node + npm available; ${APP} and ${SKILL} have package.json.
5. Submission auth (the finished stack is submitted as draft PRs): 'gh auth status' succeeds and 'git -C ${REPO} remote -v' shows a GitHub origin. If gt needs its own auth ('gt auth --help' / a failed 'gt log short' hints), report it as a failure — do NOT store or print any token.
Return JSON-ish via the schema: pass=true only if every check is green (warnings don't block).`,
  { label: 'preflight', phase: 'Preflight', model: 'sonnet', effort: 'low', agentType: 'general-purpose', schema: GATE_SCHEMA }
)
if (!ok(pre?.pass)) {
  return { aborted: 'preflight', detail: pre, next: 'Fix the preflight failures (see detail.failures), then re-run this workflow.' }
}
log('Preflight green — building the stack')

// ===========================================================================
// The build loop — inherently sequential: each PR stacks on the previous
// branch's git state and design decisions. Parallelism lives INSIDE a card
// (review lenses), never across cards.
// ===========================================================================
const startIdx = Math.max(0, args?.startAt ? CARDS.findIndex((c) => c.key === args.startAt) : 0)
const ledger = []

for (const card of CARDS.slice(startIdx)) {
  phase(card.phase)
  const priorNotes = ledger.length
    ? `DECISION LEDGER from the PRs already landed below you (honor these — they are on your base branch):\n${JSON.stringify(ledger.map((l) => ({ pr: l.pr, branch: l.branch, decisions: l.decisions, summary: l.summary })), null, 2)}`
    : 'You are the base of the stack; no prior PR decisions to honor.'

  // --- Design (Opus) -> Fable advisor critique -> revise -------------------
  let spec = null
  if (card.needsDesign) {
    const designPrompt = `You are the ARCHITECT for one layer of a stacked-PR build. Design ${card.key.toUpperCase()} — "${card.phase}" — to the file level, BEFORE any code is written. Do not write or edit any files; read and design only.

READ FIRST, in order: the plan card ${card.planAnchor} in ${PLAN} (and the sections it links), then the current code this PR touches.

${CONTEXT}

BRIEF:\n${card.scope}

${priorNotes}

${LOCKED}

${GUARDRAILS}

Produce the spec an implementer can execute without guessing: exact file paths (created/moved/edited) and what lands in each; every naming/API/placement call the plan leaves open, decided with a one-line why; the test plan mapped to this card's validation contract:\n${card.validate}\nAnd the EXACT extra validation commands (cd <absolute dir> && ...) the gate must run beyond the standing gates. Keep it minimal — the smallest design that satisfies the card. Return via the schema.`
    spec = await agent(designPrompt, { label: `${card.key}:design`, phase: card.phase, model: 'opus', effort: 'high', agentType: 'general-purpose', schema: DESIGN_SCHEMA })

    const critique = await agent(
      `You are a Fable-class DESIGN ADVISOR. Adversarially review this implementation spec for ${card.key.toUpperCase()} of the htmldoc-review Deliverable 2 stack before code is written. Ground yourself in the plan card ${card.planAnchor} in ${PLAN} and the actual code the spec claims to change (read both — trust neither the spec nor your memory).

Hunt specifically for: contradictions with the plan's locked decisions; reaching forward into a later PR's scope or depending on work that doesn't exist yet on the base branch; breakage of Deliverable 1 behavior (neutral 404, sessions, existing tests) or of local review mode; the checked-in dist artifacts not being rebuilt when their sources move; validation that couldn't actually catch the card's failure modes; guardrail violations (anything touching live infra). Do NOT manufacture problems — approve a sound spec.

${LOCKED}

${GUARDRAILS}

THE SPEC:\n${JSON.stringify(spec, null, 2)}

Return verdict approve/revise with mustFix (blocking only) via the schema.`,
      { label: `${card.key}:advisor-design`, phase: card.phase, model: 'fable', effort: 'high', agentType: 'general-purpose', schema: CRITIQUE_SCHEMA }
    )

    const mustFix = arr(critique?.mustFix)
    if (mustFix.length || str(critique?.verdict).toLowerCase().includes('revise')) {
      spec = (await agent(
        `Revise this implementation spec for ${card.key.toUpperCase()} to resolve ONLY the blocking issues below (fold in cheap suggestions if they cost nothing). Keep everything that works. Re-read the plan card ${card.planAnchor} in ${PLAN} where the critique disputes it. Return the full revised spec via the same schema.

BLOCKING:\n${JSON.stringify(mustFix, null, 2)}
SUGGESTIONS:\n${JSON.stringify(arr(critique?.suggestions), null, 2)}
ADVISOR NOTES: ${str(critique?.notes)}

ORIGINAL SPEC:\n${JSON.stringify(spec, null, 2)}

${LOCKED}\n\n${GUARDRAILS}`,
        { label: `${card.key}:design-revise`, phase: card.phase, model: 'opus', effort: 'high', agentType: 'general-purpose', schema: DESIGN_SCHEMA }
      )) ?? spec
    }
    log(`${card.key}: design locked — ${str(spec?.summary).slice(0, 140)}`)
  }

  // --- Implement ------------------------------------------------------------
  const implSummary = await agent(
    `You are the SOLE implementer of ${card.key.toUpperCase()} — "${card.phase}" — one layer of a stacked-PR build in ${REPO}. The working tree currently sits on the previous layer's branch; build directly on it. Do NOT create branches or commit — the orchestrator commits after validation. Do not touch git except to read (status/diff/log).

READ FIRST: the plan card ${card.planAnchor} in ${PLAN}${card.needsDesign ? ', then execute the LOCKED SPEC below exactly — its file paths and names are the contract; do not invent alternatives' : ''}.

${CONTEXT}

BRIEF:\n${card.scope}

${card.needsDesign ? `LOCKED SPEC:\n${JSON.stringify(spec, null, 2)}\n\n` : ''}${priorNotes}

${LOCKED}

${GUARDRAILS}

${ADVISOR_TIP}

Write real, working, minimal code — no placeholder bodies, no TODO stubs (except values the plan itself defines as placeholders, e.g. REPLACE_WITH_D1_DATABASE_ID). Match surrounding code conventions (read neighboring files and any CLAUDE.md in the directories you touch). Write the tests your card's validation demands alongside the code. Rebuild any checked-in dist artifacts your changes affect. When done, return a plain-text report: files created/moved/edited, deviations from the spec (with why), and anything the validator should know.`,
    { label: `${card.key}:implement`, phase: card.phase, model: card.implModel, effort: 'high', agentType: 'general-purpose' }
  )

  // --- Validation gate loop (run for real; Opus debugs) ----------------------
  const gateCmds = [...card.gates, ...arr(spec?.commands)]
  const gatePrompt = (note) => card.key === 'pr0'
    ? `Validate PR0 (docs-only). ${card.validate}\nWork in ${REPO}. Read the files; check every internal link/anchor programmatically where possible (grep ids vs hrefs). ${note} Return pass/commandLog/failures via the schema.`
    : `Run the validation gate for ${card.key.toUpperCase()} in ${REPO} and report REAL results — execute the commands, do not guess or summarize from memory. ${note}
COMMANDS (in order; a failure doesn't stop you from running the rest):\n${gateCmds.map((c, i) => `${i + 1}. ${c}`).join('\n')}
BEHAVIORAL CONTRACT to confirm the tests actually cover (read the new test files; a gap here is a failure):\n${card.validate}
${GUARDRAILS}
Install deps / playwright browsers if a command needs them. Return pass=true ONLY if every command succeeded AND the behavioral contract is covered; put each failure verbatim in failures.`

  let gate = await agent(gatePrompt('First run after implementation.'), { label: `${card.key}:gate`, phase: card.phase, model: 'opus', effort: 'medium', agentType: 'general-purpose', schema: GATE_SCHEMA })

  let round = 0
  while (!ok(gate?.pass) && round < 3) {
    round++
    log(`${card.key}: gate red (round ${round}) — ${arr(gate?.failures).length} failure(s); debugging`)
    await agent(
      `You are the DEBUGGER for ${card.key.toUpperCase()} in ${REPO}. The validation gate failed. Diagnose by reproducing (run the failing command, read the real error), then fix minimally and consistently with the plan card ${card.planAnchor} in ${PLAN}${card.needsDesign ? ' and the locked spec' : ''}. Fix root causes in the product code or the tests — whichever is actually wrong; never weaken a test just to pass it, and never violate the guardrails.

FAILURES:\n${JSON.stringify(arr(gate?.failures), null, 2)}
GATE LOG:\n${str(gate?.commandLog).slice(0, 8000)}
${card.needsDesign ? `LOCKED SPEC:\n${JSON.stringify(spec, null, 2)}\n` : ''}
${LOCKED}\n\n${GUARDRAILS}\n\n${ADVISOR_TIP}

Do not commit. Report what you changed and why.`,
      { label: `${card.key}:fix-r${round}`, phase: card.phase, model: 'opus', effort: 'high', agentType: 'general-purpose' }
    )
    gate = await agent(gatePrompt(`Re-run after fix round ${round}.`), { label: `${card.key}:regate-r${round}`, phase: card.phase, model: 'opus', effort: 'medium', agentType: 'general-purpose', schema: GATE_SCHEMA })
  }

  if (!ok(gate?.pass)) {
    ledger.push({ pr: card.key, branch: card.branch, committed: false, gateGreen: false, summary: str(implSummary).slice(0, 500), failures: arr(gate?.failures) })
    return {
      aborted: `${card.key} gate never went green after 3 fix rounds — stack halted so a red base cannot poison later layers`,
      ledger,
      workingTree: 'Uncommitted changes for the failed layer are still in the working tree for inspection.',
      next: `Inspect the failures, fix by hand or in a session, commit as ${card.branch} via 'gt create -am', then re-run this workflow with args {startAt:"${CARDS[CARDS.indexOf(card) + 1]?.key ?? 'wrapup'}"} — or resumeFromRunId after editing.`,
    }
  }

  // --- Review of the actual diff: Fable lenses + the /code-review methodology
  // (5 independent reviewers -> confidence scoring -> filter >=80), adapted to
  // an unpushed local layer. pr0 (docs-only) skips code-review.
  const lensPrompt = (lens) =>
    `You are a Fable-class CODE REVIEWER (${lens} lens) for ${card.key.toUpperCase()} in ${REPO}. Review the UNCOMMITTED working-tree changes for this layer: use 'git -C ${REPO} status --porcelain' and 'git -C ${REPO} diff' plus reading new/untracked files in full. Judge them against the plan card ${card.planAnchor} in ${PLAN}.

${lens === 'plan-fidelity'
      ? `FOCUS: does the code deliver the card, exactly? Locked decisions honored (spot-check against the plan's #decisions table); nothing reaching forward into later PRs; Deliverable 1 and local review behavior preserved; the card's validation contract genuinely covered by the tests (not vacuously); code quality consistent with the surrounding codebase; checked-in dist artifacts regenerated if their sources changed.`
      : `FOCUS: security & non-leak. The neutral 404 stays byte-indistinguishable for deny vs missing (no existence leak via comments, injection, headers, or timing-obvious branches); tokens/secrets never logged, never in a cookie, never in an OpError or modal string; author identity only ever stamped server-side; the JSON seed escaping actually prevents </script> breakout; SQL is parameterized; probe result never exposes GitHub status codes to the client; nothing here can touch live infrastructure.`}

${LOCKED}

Report via the schema: verdict approve/fix; findings with severity blocker/major/minor (only blocker/major will be acted on — don't inflate). Do not edit anything.`

  const lenses = card.securityLens ? ['plan-fidelity', 'security'] : ['plan-fidelity']

  // /code-review methodology on the layer's diff (skip pr0: docs-only, not
  // substantive code). Five independent reviewer angles from the code-review
  // command, adapted from "PR on GitHub" to "uncommitted stacked layer":
  const CR_ANGLES = [
    { key: 'claude-md', brief: `Find every CLAUDE.md/claude.md that governs the files this diff touches (repo root + each touched directory upward). Audit the changes for compliance. CLAUDE.md is guidance for writing code, so skip instructions that don't apply at review time.` },
    { key: 'bug-scan', brief: `Read the file changes in the diff, then do a shallow scan for obvious bugs. Stay focused on the changed lines themselves rather than deep context. Flag only large bugs — no nitpicks, no likely false positives.` },
    { key: 'git-history', brief: `Read 'git log' / 'git blame' for the modified files (their pre-change history on the base branch) and identify bugs in light of that historical context — regressions of past fixes, violated invariants that earlier commits established.` },
    { key: 'prior-prs', brief: `Read previous pull requests / commits that touched these same files ('git log --follow', 'gh pr list --search' if available) and check whether feedback or fixes from them also apply to this change.` },
    { key: 'code-comments', brief: `Read the code comments in the modified files and make sure the changes comply with any guidance, warnings, or invariants stated in those comments.` },
  ]
  const crIssues = card.key === 'pr0' ? [] : (await parallel(CR_ANGLES.map((a) => () =>
    agent(
      `You are one of five independent code reviewers for ${card.key.toUpperCase()} — an UNCOMMITTED stacked layer in ${REPO} (not a GitHub PR; review the working tree: 'git -C ${REPO} status --porcelain', 'git -C ${REPO} diff', plus new untracked files in full).

YOUR ANGLE: ${a.brief}

Ignore false-positive patterns: pre-existing issues, things a typechecker/linter/test run catches (the gate runs those separately), pedantic nitpicks a senior engineer wouldn't raise, intentional changes related to the layer's purpose (its brief: ${str(card.scope).slice(0, 600)}...), issues on unmodified lines. Return the issues you found with the reason each was flagged, via the schema. An empty list is a good answer.`,
      { label: `${card.key}:cr-${a.key}`, phase: card.phase, model: 'sonnet', effort: 'medium', agentType: 'general-purpose', schema: ISSUES_SCHEMA }
    ).then((r) => arr(r?.issues).map((i) => ({ ...i, angle: a.key })))
  ))).filter(Boolean).flat()

  // Confidence-score each issue (0-100 rubric from the code-review command); keep >=80.
  const crScored = crIssues.length ? (await parallel(crIssues.map((issue) => () =>
    agent(
      `Score your confidence that this code-review issue on the uncommitted ${card.key.toUpperCase()} changes in ${REPO} is real (verify against the actual diff and files — 'git -C ${REPO} diff', read the file). If it was flagged for CLAUDE.md adherence, double-check the relevant CLAUDE.md actually calls that out specifically.

ISSUE (angle: ${issue.angle}): ${str(issue.description)} — file: ${str(issue.file)} — reason: ${str(issue.reason)}

Scale (verbatim rubric):
0: Not confident at all. This is a false positive that doesn't stand up to light scrutiny, or is a pre-existing issue.
25: Somewhat confident. This might be a real issue, but may also be a false positive. You weren't able to verify it. If stylistic, it is not explicitly called out in the relevant CLAUDE.md.
50: Moderately confident. Verified real, but might be a nitpick or rare in practice. Not very important relative to the rest of the change.
75: Highly confident. Double-checked and very likely real and will be hit in practice; the existing approach is insufficient, or it's directly mentioned in the relevant CLAUDE.md.
100: Absolutely certain. Double-checked, definitely real, will happen frequently; the evidence directly confirms it.

Return score + reasoning via the schema.`,
      { label: `${card.key}:cr-score`, phase: card.phase, model: 'haiku', effort: 'low', agentType: 'general-purpose', schema: SCORE_SCHEMA }
    ).then((s) => ({ ...issue, score: num(s?.score), scoreReasoning: str(s?.reasoning).slice(0, 300) }))
  ))).filter(Boolean) : []
  const crConfirmed = crScored.filter((i) => i.score >= 80)
  if (card.key !== 'pr0') log(`${card.key}: code-review found ${crIssues.length} candidate issue(s), ${crConfirmed.length} confirmed at >=80 confidence`)

  const reviews = (await parallel(lenses.map((lens) => () =>
    agent(lensPrompt(lens), { label: `${card.key}:advisor-${lens}`, phase: card.phase, model: 'fable', effort: 'high', agentType: 'general-purpose', schema: REVIEW_SCHEMA })
  ))).filter(Boolean)

  const actionable = [
    ...reviews.flatMap(blockers),
    ...crConfirmed.map((i) => ({ severity: 'major', file: str(i.file), issue: `[code-review/${i.angle}, confidence ${i.score}] ${str(i.description)}`, fix: str(i.reason) })),
  ]
  if (actionable.length) {
    log(`${card.key}: advisor found ${actionable.length} blocker/major finding(s) — fixing`)
    await agent(
      `Apply fixes for these reviewer findings on the uncommitted ${card.key.toUpperCase()} changes in ${REPO}, minimally, consistent with the plan card ${card.planAnchor} in ${PLAN} and the guardrails. If a finding is factually wrong, skip it and say why.

FINDINGS:\n${JSON.stringify(actionable, null, 2)}
${card.needsDesign ? `LOCKED SPEC:\n${JSON.stringify(spec, null, 2)}\n` : ''}${GUARDRAILS}

Do not commit. Report what you changed / skipped.`,
      { label: `${card.key}:review-fixes`, phase: card.phase, model: 'opus', effort: 'high', agentType: 'general-purpose' }
    )
    gate = await agent(gatePrompt('Final re-run after review fixes.'), { label: `${card.key}:regate-final`, phase: card.phase, model: 'opus', effort: 'medium', agentType: 'general-purpose', schema: GATE_SCHEMA })
    if (!ok(gate?.pass)) {
      ledger.push({ pr: card.key, branch: card.branch, committed: false, gateGreen: false, summary: str(implSummary).slice(0, 500), failures: arr(gate?.failures) })
      return { aborted: `${card.key}: review fixes broke the gate — halted with the working tree intact`, ledger, next: 'Inspect, fix, commit the branch by hand, then re-run with startAt on the next card.' }
    }
  }

  // --- Publish validation evidence into the plan HTML -------------------------
  // Real command output from the green gate + review stats, appended as a
  // "Validation evidence" section inside this PR's card in the plan doc, so the
  // proof travels in the same commit as the layer it validates.
  const evidence = {
    layer: card.key,
    branch: card.branch,
    gate: { pass: true, fixRounds: round, commands: gateCmds.length ? gateCmds : ['(docs-only link/anchor check)'], commandLog: str(gate?.commandLog) },
    codeReview: card.key === 'pr0' ? 'skipped (docs-only layer)' : { candidateIssues: crIssues.length, confirmedAt80: crConfirmed.length, confirmed: crConfirmed.map((i) => ({ angle: i.angle, file: str(i.file), description: str(i.description).slice(0, 300), score: i.score })) },
    fableReview: reviews.map((r, i) => ({ lens: lenses[i] ?? 'plan-fidelity', verdict: str(r?.verdict), blockerMajorCount: blockers(r).length })),
    findingsFixed: actionable.length,
  }
  await agent(
    `Edit ${PLAN} to publish validation evidence for ${card.key.toUpperCase()}. Find this PR's card (the section/article anchored at ${card.planAnchor.split(' ')[0]}) and append INSIDE it, at the end of the card, a validation-evidence block. Rules:
- If the card already has a <details class="validation-evidence"> block (from a previous run), REPLACE its contents; otherwise append a new one. Never duplicate.
- Match the document's existing markup conventions (read nearby asides/sections first). Structure: <details class="validation-evidence" open><summary>Validation evidence — ${card.branch} (gate green, ${round} fix round(s))</summary> ... </details>
- Inside: a short list (commands run, code-review + Fable review outcomes, findings fixed) followed by a <pre> containing the VERBATIM command log below. HTML-escape the log's & < > characters inside the <pre>. Trim the log to the meaningful tails (final test-summary lines per command, "N passed", tsc silence noted as "exit 0", wrangler dry-run success line) but keep it real output — no paraphrasing. Cap the <pre> around 60 lines.
- Touch NOTHING else in the document.

EVIDENCE DATA:\n${JSON.stringify(evidence, null, 2).slice(0, 12000)}

Confirm by re-reading your edit: valid HTML, exactly one validation-evidence block in this card, page still well-formed.`,
    { label: `${card.key}:log-evidence`, phase: card.phase, model: 'sonnet', effort: 'low', agentType: 'general-purpose' }
  )

  // --- Commit the layer with Graphite ----------------------------------------
  const commit = await agent(
    `Commit the current working-tree changes in ${REPO} as one stacked Graphite branch. Steps:
1. 'git -C ${REPO} status --porcelain' — sanity-check the changed/untracked files plausibly belong to ${card.key.toUpperCase()} ("${card.phase}"). A change to docs/plans/worker/d2-review-mode-plan.html is EXPECTED (validation evidence) and belongs in this commit. If something clearly unrelated appears (e.g. stray junk outside the touched areas), leave it UNSTAGED and note it; node_modules/.wrangler must not be committed (they are gitignored — verify).
2. From ${REPO}: stage the relevant files ('git add -A' is fine if step 1 was clean), then 'gt create -m "<message>" ${card.branch}'. Message: first line "${card.key}: ${card.phase.replace(/^PR\d+ — /, '')}", then 2-4 body lines summarizing the layer, then "Part of the D2 stacked-PR series (see docs/plans/worker/d2-review-mode-plan.html ${card.planAnchor.split(' ')[0]})".
3. Confirm with 'gt log short' that ${card.branch} now sits on top of the stack, and 'git status' is clean.
Do NOT push, do NOT gt submit — the stack is submitted once, at wrap-up. Return: the commit hash, the gt log short output, and any files you deliberately left unstaged.`,
    { label: `${card.key}:commit`, phase: card.phase, model: 'sonnet', effort: 'low', agentType: 'general-purpose' }
  )

  ledger.push({
    pr: card.key,
    branch: card.branch,
    committed: true,
    gateGreen: true,
    gateRounds: round,
    codeReview: card.key === 'pr0' ? 'skipped' : `${crIssues.length} candidates -> ${crConfirmed.length} confirmed (>=80)`,
    reviewFindingsFixed: actionable.length,
    decisions: arr(spec?.decisions),
    summary: str(spec?.summary ?? implSummary).slice(0, 500),
    commit: str(commit).slice(0, 400),
  })
  log(`${card.key}: committed ${card.branch} (gate green after ${round} fix round(s), ${actionable.length} review finding(s) fixed)`)
}

// ===========================================================================
// Wrap-up: whole-stack gate, exit-criteria audit, optional draft submit.
// ===========================================================================
phase('Wrap-up')

const [finalGate, exitAudit] = await parallel([
  () => agent(
    `Final whole-stack gate on the TOP branch of the stack in ${REPO} (verify with 'gt log short' / 'git branch --show-current'; check out the top d2/ branch if needed). Run everything and report real results:
${[...APP_GATE, ...SKILL_GATE].map((c, i) => `${i + 1}. ${c}`).join('\n')}
${GUARDRAILS}
Return pass/commandLog/failures via the schema.`,
    { label: 'final-gate', phase: 'Wrap-up', model: 'opus', effort: 'medium', agentType: 'general-purpose', schema: GATE_SCHEMA }
  ),
  () => agent(
    `You are the Fable-class COMPLETENESS AUDITOR for the finished Deliverable 2 stack in ${REPO}. Read the exit-criteria aside at the end of the #phases article in ${PLAN}, then verify EACH criterion against the actual code and tests on the stack (read them — no criterion passes on vibes):
- reviewer can comment on any DOM region, persists across reloads/users
- agent with a GitHub token can list + resolve/delete by id; neutral 404 when unauthorized
- comments show real author names
- resolved comments stay visible with a green indicator, never hidden; delete purges
- local review mode has no regression
Also: which plan risks/"verify" badges remain unverified, and exactly what needs a HUMAN + live infrastructure (first real deploy, D1 create, migrations apply --remote, live probe behavior) — the plan defers these on purpose; list them as the manual checklist, not failures.
Return via the schema: verdict = approve/fix; findings = unmet criteria (blocker) or gaps (major/minor); notes = the human manual checklist.`,
    { label: 'exit-audit', phase: 'Wrap-up', model: 'fable', effort: 'high', agentType: 'general-purpose', schema: REVIEW_SCHEMA }
  ),
])

// Whole-stack evidence into the plan's exit-criteria area, amended onto the
// top branch so the published stack carries its own proof.
await agent(
  `Edit ${PLAN} to publish WHOLE-STACK validation evidence, then fold it into the top branch of the Graphite stack in ${REPO}.
1. In the plan, find the exit-criteria aside at the end of the #phases article. Append (or replace, if one exists from a prior run) a <details class="validation-evidence" open> block titled "Stack-wide validation evidence": final full-stack gate result with a <pre> of the verbatim trimmed command log (HTML-escape & < >; cap ~60 lines), the exit-criteria audit verdict with any unmet criteria, and the human manual checklist. Match the document's markup conventions; touch nothing else.
2. Fold into the top branch: 'git -C ${REPO} add docs/plans/worker/d2-review-mode-plan.html' then 'gt modify' (amends the current top commit; check 'gt modify --help' if flags differ in gt 1.8.6). Confirm 'git status' is clean and 'gt log short' still shows the full stack.

FINAL GATE:\n${JSON.stringify({ pass: ok(finalGate?.pass), failures: arr(finalGate?.failures), commandLog: str(finalGate?.commandLog).slice(0, 10000) }, null, 2)}
EXIT AUDIT:\n${JSON.stringify({ verdict: str(exitAudit?.verdict), unmet: blockers(exitAudit), manualChecklist: str(exitAudit?.notes) }, null, 2)}`,
  { label: 'wrapup-evidence', phase: 'Wrap-up', model: 'sonnet', effort: 'low', agentType: 'general-purpose' }
)

// Submit the stack — this IS the deliverable. Default on; {submit:false} keeps
// it local; a red final gate blocks submission (never publish a broken stack).
let submitted
if (args?.submit === false) {
  submitted = 'skipped by args {submit:false} — submit by hand with: gt submit --stack --draft'
} else if (!ok(finalGate?.pass)) {
  submitted = 'BLOCKED — final gate not green; fix the failures, then submit with: gt submit --stack --draft'
} else {
  submitted = str(await agent(
    `From ${REPO}, submit the whole Graphite stack as DRAFT pull requests: 'gt submit --stack --draft --no-interactive' (if a flag is unsupported in gt 1.8.6, check 'gt submit --help' and use the closest draft/non-interactive equivalent). This pushes branches and opens one PR per layer with correct base branches. Then verify with 'gh pr list --author @me --limit 10' and report every PR URL with its layer. Do nothing else.`,
    { label: 'submit-stack', phase: 'Wrap-up', model: 'sonnet', effort: 'low', agentType: 'general-purpose' }
  )).slice(0, 2000)
}

return {
  stack: ledger,
  finalGate: { pass: ok(finalGate?.pass), failures: arr(finalGate?.failures) },
  exitCriteria: { verdict: str(exitAudit?.verdict), unmet: blockers(exitAudit), manualChecklist: str(exitAudit?.notes) },
  submitted,
  validationEvidence: `Published into ${PLAN}: one "Validation evidence" details block per PR card + a stack-wide block by the exit criteria, each carrying real command output.`,
  next: [
    'Review the draft PRs (URLs above) and mark ready-for-review up the stack.',
    'Human-in-the-loop live steps (deliberately NOT automated): run deploy.sh once to create the real D1 database + apply migrations --remote, then manually verify the exit criteria on the deployed Worker.',
    'Merge order: PR0 first, then up the stack; gt sync after each merge.',
  ],
}
