export const meta = {
  name: 'd2-round3',
  description: 'Fold round-3 review comments into the D2 plan: rewrite the phases as a stacked-PR card flow, tighten API types/validation, plus mechanical fixes — via parallel design drafts, one serialized editor, then verify+repair',
  whenToUse: 'After round-3 comments on d2-review-mode-plan.html, with the PR-stack / timestamps / validation decisions settled in chat.',
  phases: [
    { title: 'Design', detail: '3 parallel design agents: the stacked-PR phases rewrite, the API type/validation tightening, and the batch/OpResult+error-UX detail — each emits structured draft HTML, no file edits' },
    { title: 'Fold-in', detail: 'ONE serialized editor applies every draft + every mechanical edit to the single HTML file' },
    { title: 'Verify', detail: 'One agent audits: all fresh comment-ids addressed, tags balanced, no edit-history artifacts, cards/collapses present' },
    { title: 'Repair', detail: 'If verify finds gaps, one agent fixes exactly those; re-verify (capped at 2 rounds)' },
  ],
}

// ---------------------------------------------------------------------------
// Single source of truth for this run.
// ---------------------------------------------------------------------------
const PLAN = '/Users/ben/agent-extensions/docs/plans/worker/d2-review-mode-plan.html'

// Decisions ratified in chat this round. Agents build on these; never relitigate.
const LOCKED = {
  prStack:
    'Implementation is a STACK of GitHub PRs (main <- PR1 <- PR2 <- ... <- PR6), each branch based on the previous. ' +
    'Ordered so every PR lands on proven ground and the Worker never appears before its local test harness. Each PR is ' +
    'rendered as a CARD: a box describing WHAT IS IN IT, with an attached box directly below describing WHAT WE VALIDATE. ' +
    'The six PRs:\n' +
    'PR1 — Extraction + shared UX + store seam (LOCAL ONLY): move src/comments/ into a shared review-ux/ tree (all UX: ' +
    'rendering through in-page interactions) plus adapters/{local,hosted}/; remove the article-only gate; define the ' +
    'ICommentsStore seam and the branded types (ThreadId, CommentId, Anchor, numeric epoch-ms timestamps); ship ' +
    'LocalFileStore; rebuild the checked-in dist/comments.mjs. Validate: unit tests for LocalFileStore + anchoring; ' +
    'regression-test local review mode (article gate gone, resolve=green indicator); the bundle artifact rebuilds clean.\n' +
    'PR2 — Comment API business logic, RUNTIME-AGNOSTIC: the op envelope (create/resolve/reopen/delete in v1; reply/edit ' +
    'reserved), Zod (zod/mini) request schemas, the OpResult discriminated union, and batch implemented as a loop over the ' +
    'single-op methods. The LOCAL server mounts this logic over HTTP so it is fully exercised with no Worker. Validate: ' +
    'unit tests per verb + batch partial-failure; Zod envelope-rejection tests; anchor SHAPE validated, DOM-match out of scope.\n' +
    'PR3 — Worker + Cloudflare D1: provision one D1 database, wire it into wrangler.toml + the deploy script, add the ' +
    'migration, implement D1Store behind the same seam. Validate: LOCAL workerd via @cloudflare/vitest-pool-workers — ' +
    'D1Store exercised against a real migrated D1 inside Miniflare; the store round-trips from within the Worker. No live deploy.\n' +
    'PR4 — Comment API on the Worker + checkAccess: mount PR2 logic on the existing doc route (?comments body-ops); add the ' +
    'checkAccess chokepoint that probes (repo, ref, path) ONCE PER REQUEST/BATCH and maps any non-200 to the neutral 404; ' +
    'the deny value is named denialResponse. Validate: workerd tests for list/create/resolve/delete/batch; unauthorized doc ' +
    '-> neutral 404; probe-once-per-batch asserted.\n' +
    'PR5 — Identity capture + session migration: completeLogin calls GET /user once, persists {login,name,id} + a version ' +
    'field; lazy on-read upgrade for older sessions, no forced re-auth. Validate: unit tests for the single-writer/migration; ' +
    'a workerd test that a real author name surfaces on a comment.\n' +
    'PR6 — Injection + docs (pass 1): Worker HTMLRewriter appends the widget script + an inline JSON seed of the doc\'s ' +
    'comments (resolved AND open, each carrying resolvedAt); the local server does the equivalent string-splice; a UNIFIED ' +
    'injection test runs one doc through BOTH paths and asserts identical output so they cannot diverge. Also writes the ' +
    'pass-1 docs at proxy.html level (what we built, references to related docs, forward-looking) plus the barest SKILL.md ' +
    'pointer. Validate: the unified injection test; an e2e in local workerd — comment on a hosted doc, reload, it persists, ' +
    'resolve it, indicator turns green while the comment stays visible.',
  validation:
    'Validation backbone is LOCAL: unit tests plus LOCAL workerd (@cloudflare/vitest-pool-workers / Miniflare) with real D1 ' +
    'bindings and migrations applied via readD1Migrations/applyD1Migrations. Follow the repo pattern of a vitest projects ' +
    'config splitting a "unit" project from a workerd-backed project, with *.workers.test.ts (or similar) excluded from the ' +
    'plain unit run and a separate npm script. LIVE integration tests (deploying a real test Worker and hitting its URL) are ' +
    'EXPLICITLY DEFERRED — noted as future work, not built now, because the deploy/auth/fixture complication is not worth it yet.',
  timestamps:
    'Timestamps are numeric epoch-milliseconds END TO END for consistency: D1 stores INTEGER epoch-ms, the same number ' +
    'crosses the JSON boundary (no ISO conversion), and internally the type is a branded Timestamp = number. This is the ' +
    'internally-consistent choice and it matches the aging-out DELETE WHERE created_at < ? path.',
  validator:
    'Request/envelope validation uses Zod 4, importing from zod/mini for its tree-shakable, smaller-bundle functional API ' +
    '(Workers is bundle-size sensitive). safeParse-style validation rejects a malformed envelope with 400 BEFORE any store ' +
    'call. Confirmed Workers-compatible. Not Valibot.',
  delete:
    'v1 INCLUDES a hard delete op (user reversed the earlier resolve-only stance): fold delete into the op envelope, the ' +
    'verb table, the store interface, and the v1 surface everywhere ops are defined — alongside resolve (soft-close). ' +
    'Both exist: resolve is the default soft-close, delete is a genuine purge.',
  branded:
    'IDs are branded types, not bare string, EXTENDING the pattern already in core/store.ts (SessionId is branded there): ' +
    'add ThreadId and CommentId (and keep them distinct). Anchor becomes a real named type alongside Author/Comment.',
  opResult:
    'OpResult is a DISCRIMINATED UNION: discriminate first on ok, then on op, so a single op returns its verb-specific ' +
    'payload — e.g. {ok:true, op:"create", thread:Thread} | {ok:true, op:"reply", comment:Comment} | {ok:true, ' +
    'op:"resolve"|"reopen", thread:Thread} | {ok:true, op:"delete", threadId:ThreadId} | {ok:false, op, error}. This is ' +
    'exactly what lets a batch return one array of mixed, type-safe results.',
  batchImpl:
    'Batch is implemented IN TERMS OF the single-op methods: loop the ops in order, call each op\'s own single-op store ' +
    'method independently, collect one OpResult per op; a failing op records its error and the loop continues (best-effort, ' +
    'no wrapping transaction). LocalFileStore doing a read+write per op in the loop is ACCEPTED for v1 (a load-once/save-once ' +
    'optimization is possible later but not needed now).',
  probeOnce:
    'The access probe is ONE GitHub Contents call PER REQUEST/BATCH, not per op — every op in a batch shares the same ' +
    '(repo, ref, path) doc key (the URL names the collection), so checkAccess runs once at the route chokepoint before any ' +
    'op executes. Fix any wording that says "per comment op".',
  anchorValidation:
    'The Worker validates the anchor SHAPE only (well-formed TextQuoteSelector: exact:string required, prefix/suffix ' +
    'optional strings) via Zod. It CANNOT validate that the anchor actually matches text in the doc, because the Worker ' +
    'streams HTML through HTMLRewriter and never builds a DOM — so semantic/DOM-match validation is EXPLICITLY OUT OF ' +
    'SCOPE and called out as such (orphaned anchors remain a handled client concern).',
  localNoRepo:
    'In the LOCAL case the URL has no <repo> segment (the local server serves a file tree, not an org\'s repos) — the ' +
    'route is the doc path + ?ref?&comments. Only the hosted Worker URL carries <repo>. Note this explicitly where the ' +
    'route shape is shown.',
  errorUx:
    'Define a MINIMAL set of user-facing errors shown in the widget modal that are useful without leaking: e.g. a generic ' +
    '"you don\'t have access to this doc, or it doesn\'t exist" for the neutral-404/denial (never distinguishing the two), ' +
    'a generic "couldn\'t save your comment, try again" for transient failures, and a "this comment no longer exists" for a ' +
    'stale id. The modal never surfaces repo existence, GitHub status codes, or tokens.',
  docsLevel:
    'The pass-1 docs are written at the SAME LEVEL as proxy.html: what we built, references to related docs, forward-looking ' +
    'voice. They live in the htmldocs skill path with the barest SKILL.md pointer, massaged in code review. Plan-record only ' +
    '(no files created in this workflow).',
}

// Fresh round-3 comments (>= 22:49 timestamps). The <= 21:49 comments in the
// sidecar are the ALREADY-ADDRESSED prior round, re-persisted by a stale browser
// tab (last-writer-wins) — deliberately excluded here.
const COMMENTS = [
  // ---- API: route shape + typing + validation + batch echo ----
  { id: 'c-2f48473e', section: 'api', bucket: 'mechanical',
    anchorExact: 'repo', anchorHint: 'GET /<repo>/<doc>?ref=<ref>&comments route line',
    intent: 'Note that the LOCAL case has no <repo> segment — only the hosted Worker URL carries <repo>. ' + LOCKED.localNoRepo },
  { id: 'c-e62c21a6', section: 'api', bucket: 'mechanical',
    anchorExact: '(a repo doc literally named __review is\n      just another doc served normally)',
    intent: 'DELETE this parenthetical — it is a stale artifact of the abandoned __review-prefix idea. Remove it cleanly; keep the surrounding orthogonality sentence readable.' },
  { id: 'c-ad019300', section: 'api', bucket: 'typing',
    anchorExact: 'createdAt', anchorHint: 'the Comment type times as string',
    intent: 'Timestamps should be better-typed, not bare string. Apply LOCKED.timestamps: numeric epoch-ms end to end (D1 INTEGER, same on the wire, branded Timestamp=number). Update the Comment/Thread type fields (createdAt/editedAt/resolvedAt) accordingly.' },
  { id: 'c-aad3d4ee', section: 'api', bucket: 'typing',
    anchorExact: 'string', anchorHint: 'Thread.id typed as string',
    intent: 'Define branded/custom types for ids rather than bare string. Apply LOCKED.branded (ThreadId, CommentId, extending the existing SessionId brand pattern in core/store.ts). Update the type definitions.' },
  { id: 'c-98d3bc01', section: 'api', bucket: 'validation',
    anchorExact: 'anchor', anchorHint: 'create op required fields: anchor, text',
    intent: 'Define anchor as a real named type (Anchor, alongside Author/Comment). Address HOW incoming params are validated against the schema: use a Worker-compatible route/schema validator (Zod via zod/mini — LOCKED.validator), and yes there are unit tests. Add a short validation subsection covering this.' },
  { id: 'c-25d7ad1a', section: 'api', bucket: 'validation',
    anchorExact: 'W3C TextQuoteSelector triple the widget already serializes, passed through opaquely\n        (the server never parses it). patch for edit is {body:',
    intent: 'User: "ok good, lets validate it." Confirm the anchor SHAPE is validated (Zod), and patch too. Combine with c-79104e7c on the DOM-match limitation.' },
  { id: 'c-79104e7c', section: 'api', bucket: 'validation',
    anchorExact: 'anchor is the W3C TextQuoteSelector t',
    intent: 'Explicitly call out that the Worker probably cannot reject invalid anchors because it does not parse the DOM (streams via HTMLRewriter). Apply LOCKED.anchorValidation: shape-validate only; DOM/semantic match is out of scope, and say WHY (no DOM in the Worker).' },
  { id: 'c-8720b090', section: 'api', bucket: 'mechanical',
    anchorExact: 'threadId', anchorHint: 'resolve op required field',
    intent: 'Make explicit that threadId replaces commentId for thread-scoped verbs (resolve/reopen/delete operate on a thread id). User is fine with it, just wants it stated plainly.' },
  { id: 'c-fd7a37ab', section: 'api', bucket: 'affirm',
    anchorExact: 'thread', anchorHint: 'batch response echoes thread',
    intent: 'AFFIRMATION only (echoing the thread id back so the agent correlates without positional/spatial reliance). No change needed unless the point can be stated once, crisply, in the batch-response prose.' },
  { id: 'c-15fd525f', section: 'questions', bucket: 'decision',
    anchorExact: 'en decision: v1 removes hard-delete entirely (resolve only). If you instead want both — resolve\n    as the default, delete available for a genuine purge — delete is a small named-but-deferred addition.',
    intent: 'User REVERSED: fold delete into v1 everywhere ops are defined. Apply LOCKED.delete. Replace this open-decision with the settled "v1 has both resolve (default soft-close) and delete (genuine purge)".' },

  // ---- authz ----
  { id: 'c-64f1040c', section: 'authz', bucket: 'mechanical',
    anchorExact: 'deny', anchorHint: 'checkAccess result union: { ok:false; deny: Response }',
    intent: 'Rename the deny field to denialResponse in the checkAccess result type.' },
  { id: 'c-8f3d0507', section: 'authz', bucket: 'mechanical',
    anchorExact: 'r comment op (',
    intent: 'The probe cost is per BATCH/REQUEST, not per comment op. Apply LOCKED.probeOnce — fix this wording to "one GitHub Contents call per request/batch" and note all batch ops share one doc key so the probe runs once.' },

  // ---- widget: store interface, batch impl, error handling, extraction phase ----
  { id: 'c-91fbdd16', section: 'widget', bucket: 'typing',
    anchorExact: 'batch', anchorHint: 'ICommentsStore.batch signature returning OpResult',
    intent: 'Clarify how batch returns one type while individual ops return Thread or Comment: OpResult is a discriminated union. Apply LOCKED.opResult — show the union in the interface/collapsed detail.' },
  { id: 'c-7b3e25fd', section: 'widget', bucket: 'design',
    anchorExact: 'Loop the ops in order, running each op\'s own single statement independently (no wrapping db.batch()/transaction); collect one OpResult per op. A failing statement records its error and the loop continues.',
    intent: 'Batch should be implemented IN TERMS OF the single-op methods (call them in a loop), for BOTH stores. Apply LOCKED.batchImpl — reframe the per-store batch reckoning as "loop the single-op methods", LocalFile read/write-per-op accepted for v1.' },
  { id: 'c-cdfa6ab6', section: 'widget', bucket: 'design',
    anchorExact: 'Share all the review UX',
    intent: 'Add error-handling to the shared-UX design: if the auth probe fails (or other errors), the user sees a useful modal message that does NOT leak. Apply LOCKED.errorUx — define the minimal useful-without-leaking error set. Best as a short subsection/collapsed detail in the widget design.' },
  { id: 'c-43c0dd5a', section: 'widget', bucket: 'phases-ref',
    anchorExact: 'Constraint to design around: the skill checks in a prebuilt dist/comments.mjs for\n      distribution, so a shared source must still emit that checked-in artifact. This move gets its own phase.',
    intent: 'The extraction gets its OWN phase with its OWN validation, early — now realized as PR1 in the stacked-PR flow (LOCKED.prStack). Ensure this constraint (shared source must still emit the checked-in dist/comments.mjs) is captured in PR1\'s card + validation.' },
  { id: 'c-3c0ccd52', section: 'widget', bucket: 'design',
    anchorExact: 'Local: serve.ts string-splices the two helper outputs before\n        </body> on files it reads off disk (today\'s injectIntoHtml).',
    intent: 'Add a UNIFIED injection test: one doc, expected injected output, run through BOTH the local string-splice and the Worker HTMLRewriter paths, assert identical results so they cannot diverge. Reflect in the injection design + PR6 validation.' },

  // ---- phases: the big rewrite into a stacked-PR card flow ----
  { id: 'c-98ebbc58', section: 'phases', bucket: 'phases-rewrite',
    anchorExact: 'mplementation phases',
    intent: 'Go deeper: each phase becomes a CARD with a collapsible details section. Apply LOCKED.prStack — render the phases as the stacked-PR card flow (what-is-in-it box + attached what-we-validate box per PR).' },
  { id: 'c-722c5550', section: 'phases', bucket: 'phases-rewrite',
    anchorExact: ' binding + ',
    intent: 'Re-order per the user sketch: factor out the LOCAL stuff first (extraction + the new store, local-only), verify well; then the API business logic with local mode calling it; then the Worker side. Build a stack of GitHub PRs (main <- pr1 <- pr2 <- pr3...). Apply LOCKED.prStack.' },
  { id: 'c-3dd8a8ce', section: 'phases', bucket: 'phases-rewrite',
    anchorExact: 'ill\n      build and t',
    intent: 'The widget extraction should move UP — possibly the first set of work. Apply LOCKED.prStack (extraction is PR1).' },
  { id: 'c-b1fab968', section: 'phases', bucket: 'phases-rewrite',
    anchorExact: 'in\n      co',
    intent: 'Configure + implement the D1 store impl and test it — ideally live. LIVE integration testing is now DEFERRED (LOCKED.validation); instead validate the store with LOCAL workerd (@cloudflare/vitest-pool-workers + D1 migrations). Reflect in PR3\'s validation box, and note live integration as future work.' },
  { id: 'c-57c984df', section: 'phases', bucket: 'phases-rewrite',
    anchorExact: 'tity capture + session migration.',
    intent: 'Identity capture is its own PR (PR5) with its own validation. Live integration was suggested as its gate, but per LOCKED.validation that is deferred — validate via unit + local workerd instead.' },
  { id: 'c-c4ef34e1', section: 'phases', bucket: 'phases-rewrite',
    anchorExact: 'LRewriter step on 200 HTML doc responses, appending the',
    intent: 'Injection (PR6) can be tested locally with the local workerd environment (fine per LOCKED.validation); note that. Also fix the stale "drop from the default view" wording to the green-indicator behavior if it reappears here.' },
]

const inSection = (s) => COMMENTS.filter((c) => c.section === s)
const byBucket = (b) => COMMENTS.filter((c) => c.bucket === b)
const idList = (arr) => arr.map((c) => c.id).join(', ')
const checklist = (arr) =>
  arr.map((c) => '  - [' + c.id + '] (#' + c.section + ') ' + c.intent +
    (c.anchorExact ? '\n      locate near: "' + c.anchorExact.slice(0, 90).replace(/\n/g, ' ') + '"' : '') +
    (c.anchorHint ? '\n      (' + c.anchorHint + ')' : '')).join('\n')

// ---------------------------------------------------------------------------
// Schemas — deliberately FORGIVING (one required field each, no nested required,
// no enums, all free-form strings). Strict schemas have tripped the
// StructuredOutput retry cap before; results are read defensively with ?? below.
// ---------------------------------------------------------------------------
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    section: { type: 'string', description: 'target section id in the plan (phases / api / widget / authz)' },
    commentIds: { type: 'array', items: { type: 'string' }, description: 'comment ids this draft serves' },
    summaryLine: { type: 'string', description: 'one-line takeaway' },
    recommendation: { type: 'string', description: 'the decision/design in plain prose' },
    visibleProseHtml: { type: 'string', description: 'forward-looking HTML to place VISIBLE (high-level)' },
    collapsedDetailHtml: { type: 'string', description: 'HTML for collapsed <details> block(s); "" if none' },
    fullReplacementHtml: { type: 'string', description: 'for a whole-section rewrite (e.g. the phases card flow): the entire new inner HTML for the section, if applicable' },
    openForHuman: { type: 'array', items: { type: 'string' }, description: 'anything still needing a human call' },
    grounding: { type: 'array', items: { type: 'string' }, description: 'sources consulted' },
  },
  required: ['recommendation'],
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    solid: { type: 'boolean', description: 'true if acceptable as-is, no revision needed' },
    holes: { type: 'array', items: { type: 'string' }, description: 'concrete gaps/contradictions' },
    mustFix: { type: 'array', items: { type: 'string' }, description: 'the subset that blocks acceptance' },
    notes: { type: 'string' },
  },
  required: ['solid'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    tagsBalanced: { type: 'boolean' },
    tagCounts: { type: 'string', description: 'e.g. "details 12/12, section 22/22, ..."' },
    artifacts: { type: 'array', items: { type: 'string' }, description: 'backward-looking / edit-history phrasings (empty if none)' },
    perComment: {
      type: 'array',
      description: 'one entry per comment id with addressed + brief evidence',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, addressed: { type: 'boolean' }, evidence: { type: 'string' } },
      },
    },
    unaddressed: { type: 'array', items: { type: 'string' }, description: 'comment ids not satisfied' },
    issues: { type: 'array', items: { type: 'string' }, description: 'other problems (missing cards/collapses, drift, etc.)' },
  },
  required: ['tagsBalanced'],
}

const STYLE = [
  'HOUSE STYLE (strict):',
  '- Forward-looking voice ONLY. Never write "previously", "used to", "this changes", "reverses the earlier",',
  '  "the user raised/reversed", "moved up from", or any edit-history / iteration artifact. Write as if freshly authored.',
  '- Match the plan\'s existing HTML conventions: <section>/<article>, <aside class="risk">, <aside data-kind="...">,',
  '  <span class="rec">Decision: ...</span>, <span class="badge ok">v1</span> / <span class="badge warn">deferred</span>,',
  '  <details><summary>, <pre><code>, <table>. Escape < > & as &lt; &gt; &amp; inside <pre><code>.',
  '- Collapsed detail uses <details> with NO open attribute (hidden by default).',
  '- Keep VISIBLE prose tight and high-level; push implementation detail into a collapse.',
].join('\n')

// ===========================================================================
// PHASE 1 — Design drafts (parallel). Barrier is correct: the single serialized
// editor needs all drafts together for one consistent pass. The load-bearing
// drafts (phases rewrite, API typing) get a critique -> revise-if-needed layer.
// ===========================================================================
phase('Design')

// The phases article is fully rewritten into the stacked-PR card flow. Give the
// agent the CSS reality: cards should reuse existing classes/markup patterns.
const PHASES_PROMPT = [
  'You are redesigning the "Implementation phases" section (article id="phases") of the htmldoc-review D2 plan into a',
  'STACKED-PR CARD FLOW. This is the load-bearing rewrite of this round.',
  '',
  'FIRST read the plan to match its exact HTML/CSS conventions: ' + PLAN,
  'Look at how existing sections use <article>, <section>, <aside data-kind="...">, <table>, <span class="rec">, badges,',
  'and <details>. Reuse those patterns — do NOT invent new CSS classes the stylesheet will not have. If you need a',
  '"card" look, build it from the existing element vocabulary (e.g. a <section> per PR with an aside for validation),',
  'and note any small CSS addition you assume so the editor can add it to the <style> block.',
  '',
  'THE STACK TO RENDER (settled — do not relitigate):',
  LOCKED.prStack,
  '',
  'ALSO fold in these constraints where they belong:',
  '- ' + LOCKED.validation,
  '- Extraction constraint: shared source must still emit the checked-in dist/comments.mjs (PR1).',
  '- Unified injection test lives in PR6 validation; identity is PR5; delete is in v1 (PR2 op set).',
  '',
  'STRUCTURE: an intro line, then ONE CARD PER PR (PR1..PR6) in order. Each card = a box describing WHAT IS IN IT with an',
  'attached box directly below describing WHAT WE VALIDATE (the user explicitly wants this two-box card shape). A',
  'collapsible <details> per card MAY hold the deeper specifics (files touched, test names) so the visible card stays',
  'scannable. Show the stack lineage (main <- PR1 <- ... <- PR6) somewhere near the top. Keep the exit-criteria aside,',
  'updated to the green-indicator resolve behavior (resolved comments stay visible with a green indicator, never hidden).',
  '',
  'OUTPUT: put the ENTIRE new inner HTML of the phases article in fullReplacementHtml (from just after the <h2> to just',
  'before </article>), so the editor can swap the whole section body. Also give recommendation (2-3 sentence summary) and',
  'set commentIds to: ' + idList(byBucket('phases-rewrite')) + ', plus c-43c0dd5a and c-3c0ccd52 which its validation boxes support.',
  '',
  STYLE,
].join('\n')

// API typing + validation tightening: branded ids, Anchor type, timestamps,
// discriminated OpResult, Zod validation, anchor-shape-only, delete verb, local no-repo.
const API_PROMPT = [
  'You are tightening the TYPES and VALIDATION of the comment API in the htmldoc-review D2 plan (article id="api", with',
  'the store interface in id="widget"). Read the plan first to match conventions and see the current type blocks: ' + PLAN,
  '',
  'Apply ALL of these settled decisions coherently (they interlock):',
  '1. BRANDED IDS: ' + LOCKED.branded,
  '2. TIMESTAMPS: ' + LOCKED.timestamps,
  '3. ANCHOR TYPE + VALIDATION: define a real Anchor type; ' + LOCKED.anchorValidation,
  '4. VALIDATOR: ' + LOCKED.validator,
  '5. OP RESULT: ' + LOCKED.opResult,
  '6. DELETE IN V1: ' + LOCKED.delete,
  '7. THREAD ID: threadId is the thread-scoped id for resolve/reopen/delete, replacing commentId for those verbs (edit still targets a commentId).',
  '8. LOCAL NO-REPO: ' + LOCKED.localNoRepo,
  '9. PROBE ONCE: ' + LOCKED.probeOnce,
  '',
  'CONCRETELY produce:',
  '- Updated TypeScript type block(s) for Author/Comment/Thread/Anchor/OpResult with branded ThreadId/CommentId/Timestamp,',
  '  numeric epoch-ms times, and the discriminated OpResult union including the delete arm. (These replace the current',
  '  <pre><code> type blocks in #api.)',
  '- A short VISIBLE validation note in #api plus a collapsed <details> covering: Zod (zod/mini) safeParse rejects a bad',
  '  envelope with 400 before any store call; anchor SHAPE is validated but DOM/semantic match is OUT OF SCOPE (no DOM in',
  '  the Worker) — say why; and yes, unit-tested.',
  '- The delete verb woven into the verb table and the v1 surface (op set: create/resolve/reopen/delete v1; reply/edit reserved).',
  '',
  'OUTPUT: visibleProseHtml = the visible edits (type blocks + validation note framing). collapsedDetailHtml = the',
  'validation details + anything deep. Use recommendation for a 2-3 sentence summary. commentIds = ' +
    idList([...byBucket('typing'), ...byBucket('validation'), ...inSection('api').filter((c) => c.bucket === 'mechanical' || c.bucket === 'decision')]) + '.',
  'Note in openForHuman anything you cannot settle from the decisions above.',
  '',
  STYLE,
].join('\n')

// Widget-side detail: batch-as-loop for both stores, OpResult union in the store
// signature, and the error-UX minimal set. (Lighter — single pass.)
const WIDGET_PROMPT = [
  'You are refining the SHARED-WIDGET / store design in the htmldoc-review D2 plan (article id="widget"). Read the plan',
  'first to match conventions: ' + PLAN,
  '',
  'Apply these settled decisions:',
  '1. BATCH IMPL: ' + LOCKED.batchImpl,
  '2. OP RESULT UNION in the store signature: ' + LOCKED.opResult,
  '3. ERROR UX: ' + LOCKED.errorUx,
  '',
  'CONCRETELY:',
  '- Reframe the per-store (D1Store vs LocalFileStore) batch reckoning as "batch loops the single-op methods" for BOTH',
  '  stores, best-effort per op, LocalFile read/write-per-op accepted for v1 (mention load-once/save-once as a possible',
  '  later optimization, not needed now).',
  '- Make the ICommentsStore batch() signature return OpResult[] where OpResult is the discriminated union; show it.',
  '- Add a short error-handling design (a subsection or collapsed <details>): the minimal set of useful-without-leaking',
  '  modal messages (denial/404 -> one generic "no access or not found"; transient save failure -> "couldn\'t save, retry";',
  '  stale id -> "comment no longer exists"), and the rule that the modal never leaks repo existence / GitHub status / tokens.',
  '',
  'OUTPUT: visibleProseHtml = visible edits; collapsedDetailHtml = the batch/impl + error-table detail. recommendation =',
  '2-3 sentence summary. commentIds = ' + idList([...byBucket('design')]) + '.',
  '',
  STYLE,
].join('\n')

// ---- critique -> revise-if-needed for the two load-bearing drafts -----------
async function draftWithCritique(genPrompt, critiqueFocus, opts) {
  const draft = await agent(genPrompt, { ...opts, schema: DRAFT_SCHEMA })
  if (!draft) return null
  const critique = await agent([
    'You are a skeptical design reviewer for the htmldoc-review D2 plan. Poke holes in the DRAFT below. Be concrete and',
    'adversarial, but do not manufacture problems — if it is sound, say solid:true.',
    '',
    'Focus especially on: ' + critiqueFocus,
    '',
    'DRAFT (JSON):', JSON.stringify(draft, null, 2),
    '',
    'Report via schema: solid, holes, mustFix (blocking subset), notes. Keep it tight.',
  ].join('\n'), { label: opts.label + ':critique', phase: 'Design', schema: CRITIQUE_SCHEMA, agentType: 'general-purpose' })

  const mustFix = critique?.mustFix ?? []
  if ((critique?.solid ?? true) && mustFix.length === 0) return draft

  const revised = await agent([
    'Revise your DRAFT to fix ONLY the blocking issues below. Keep what works; do not rewrite wholesale. Return the SAME',
    'schema shape (a full draft, including fullReplacementHtml if you produced one).',
    '', 'Blocking (mustFix):', JSON.stringify(mustFix, null, 2),
    'Other holes if cheap:', JSON.stringify(critique?.holes ?? [], null, 2),
    'Notes: ' + (critique?.notes ?? '(none)'),
    '', 'Your original DRAFT (JSON):', JSON.stringify(draft, null, 2),
    '', 'Original task, for reference:', genPrompt,
  ].join('\n'), { label: opts.label + ':revise', phase: 'Design', schema: DRAFT_SCHEMA, agentType: 'general-purpose' })
  return revised ?? draft
}

const drafts = await parallel([
  () => draftWithCritique(
    PHASES_PROMPT,
    'whether the six PR cards are truly independently landable and correctly ordered (nothing in an early PR depends on a ' +
      'later one); whether each card has BOTH a what-is-in-it box AND a what-we-validate box; whether the validation is ' +
      'genuinely local (unit + workerd) with live integration correctly marked deferred; whether the card markup only uses ' +
      'CSS the plan\'s stylesheet actually has (or flags any new class needed); whether the stack lineage is shown.',
    { label: 'phases-rewrite', phase: 'Design' },
  ),
  () => draftWithCritique(
    API_PROMPT,
    'internal type consistency (branded ThreadId/CommentId used everywhere, not bare string; Timestamp numeric everywhere ' +
      'incl. D1 and JSON; the OpResult union has one arm per verb INCLUDING delete and compiles); the anchor-shape-only ' +
      'validation with DOM-match explicitly out of scope and the reason (no DOM in Worker) stated; delete woven in ' +
      'consistently across envelope + verb table + v1 surface; local-no-repo noted where the route is shown.',
    { label: 'api-typing', phase: 'Design' },
  ),
  () => agent(WIDGET_PROMPT, { label: 'widget-detail', phase: 'Design', schema: DRAFT_SCHEMA, agentType: 'general-purpose' }),
]).then((r) => r.filter(Boolean))

log('Design drafts in: ' + drafts.length + '/3 returned (2 critiqued)')

// ===========================================================================
// PHASE 2 — Fold-in (ONE serialized editor over the single file).
// ===========================================================================
phase('Fold-in')

const editorPrompt = [
  'You are the SOLE editor of one HTML planning doc. Apply EVERY change below to this file and only this file:',
  '  ' + PLAN,
  '',
  'Read it fully first, then make precise Edit calls. Do NOT run a server, do NOT touch git, do NOT edit any other file.',
  '',
  '=== SETTLED DECISIONS (state as decided, never as open) ===',
  Object.entries(LOCKED).map(([k, v]) => '• ' + k + ': ' + v).join('\n'),
  '',
  '=== PHASE-1 DESIGN DRAFTS (fold in; each carries visible + collapsed, and the phases draft carries a full-section replacement) ===',
  'For the phases draft, if it has fullReplacementHtml, REPLACE the inner body of <article id="phases"> (between the',
  '</h2> after the phases heading and </article>) with it — that is the intended whole-section rewrite into PR cards.',
  'If the phases draft assumes any new CSS class, ADD the minimal rule to the document <style> block so it renders.',
  'For the other drafts, splice visibleProseHtml into the target section and put collapsedDetailHtml in a <details>.',
  JSON.stringify(drafts, null, 2),
  '',
  '=== MECHANICAL / DIRECT EDITS (apply exactly) ===',
  '#api:', checklist(inSection('api').filter((c) => ['mechanical', 'affirm'].includes(c.bucket))),
  '',
  '#authz:', checklist(inSection('authz')),
  '',
  '#questions:', checklist(inSection('questions')),
  '',
  '=== COHERENCE REQUIREMENTS ===',
  '- delete is now a v1 op EVERYWHERE ops are listed (envelope, verb table, v1 surface, store interface, PR2 card).',
  '- Timestamps are numeric epoch-ms in every type block and the schema/DDL; no ISO strings on the wire.',
  '- The probe is "per request/batch", never "per op" — fix all occurrences.',
  '- Resolve behavior is green-indicator + stays-visible everywhere; delete NO stale "hidden/drop from view" wording.',
  '- IDs are branded (ThreadId/CommentId) in every type block, matching the SessionId brand already in core/store.ts.',
  '- The phases section is the stacked-PR card flow; the #widget and #api store/type edits must stay consistent with it',
  '  (same op set, same OpResult union, same validation story).',
  '',
  STYLE,
  '',
  'When done, return a PLAIN-TEXT summary: for each of the ' + COMMENTS.length + ' comment ids, one line on what changed',
  'and where. Concise and factual — read by the orchestrator, not the end user.',
].join('\n')

const editSummary = await agent(editorPrompt, { label: 'fold-in-editor', phase: 'Fold-in', agentType: 'general-purpose' })
log('Editor pass complete.')

// ===========================================================================
// PHASE 3 — Verify -> Repair (capped at 2 rounds).
// ===========================================================================
const allIds = COMMENTS.map((c) => c.id)

const verifyPrompt = (roundNote) => [
  'Audit this edited HTML planning doc: ' + PLAN,
  roundNote,
  '',
  'Report via the schema:',
  '1. For EACH of these ' + allIds.length + ' comment ids, is its intent satisfied? Brief evidence (quoted phrase / section). ids:',
  checklist(COMMENTS),
  '',
  '2. Tag balance: count opening vs closing for details, section, article, pre, code, table, tr, td, aside, summary.',
  '   tagCounts string + tagsBalanced true only if ALL match.',
  '3. Edit-history artifacts: flag backward-looking/iteration phrasing or stale "Open decision" now settled. Empty if none.',
  '4. Phases section is the STACKED-PR CARD FLOW: six PR cards in order, each with a what-is-in-it box AND a what-we-validate',
  '   box, stack lineage shown, live integration marked deferred, resolve=green in exit criteria. List gaps as issues.',
  '5. Coherence: delete is a v1 op everywhere; timestamps numeric epoch-ms everywhere; probe is per request/batch not per op;',
  '   ids branded; no stale "hidden/drop from view" resolve wording. Flag any drift as issues.',
  '',
  'Read the file directly; trust no summary. Do not edit — report only.',
].join('\n')

let round = 0
let verdict = await agent(verifyPrompt('First audit after the editor pass.'), {
  label: 'verify-r0', phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose',
})

const isClean = (v) =>
  v && v.tagsBalanced === true &&
  (v.unaddressed?.length ?? 0) === 0 &&
  (v.artifacts?.length ?? 0) === 0 &&
  (v.issues?.length ?? 0) === 0

while (!isClean(verdict) && round < 2) {
  round++
  log('Repair round ' + round + ': ' +
    (verdict?.unaddressed?.length ?? 0) + ' unaddressed, ' +
    (verdict?.artifacts?.length ?? 0) + ' artifacts, ' +
    (verdict?.issues?.length ?? 0) + ' issues, tagsBalanced=' + verdict?.tagsBalanced)

  phase('Repair')
  await agent([
    'Repair exactly the problems below in this file and nothing else: ' + PLAN,
    '',
    'Unaddressed comment ids (satisfy their intent — full list follows):',
    (verdict.unaddressed || []).join(', ') || '(none)',
    '', 'Edit-history artifacts to rewrite forward-looking:', JSON.stringify(verdict.artifacts || []),
    '', 'Other issues to fix:', JSON.stringify(verdict.issues || []),
    '', 'Tag balance report (fix any imbalance): ' + (verdict.tagCounts || '(n/a)'),
    '', 'Full comment intents for reference:', checklist(COMMENTS),
    '', STYLE,
    '', 'Make minimal, surgical edits. Return a concise plain-text list of what you fixed.',
  ].join('\n'), { label: 'repair-r' + round, phase: 'Repair', agentType: 'general-purpose' })

  phase('Verify')
  verdict = await agent(verifyPrompt('Re-audit after repair round ' + round + '.'), {
    label: 'verify-r' + round, phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose',
  })
}

return {
  file: PLAN,
  designDrafts: drafts.length,
  editSummary,
  finalVerdict: verdict,
  clean: isClean(verdict),
  repairRounds: round,
  note: isClean(verdict)
    ? 'All round-3 comment ids addressed; tags balanced; no artifacts; phases rebuilt as PR-card flow. Ready for human review.'
    : 'Stopped after ' + round + ' repair round(s) with residual items — see finalVerdict.unaddressed/issues.',
}
