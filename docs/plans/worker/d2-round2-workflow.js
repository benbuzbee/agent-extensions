export const meta = {
  name: 'd2-round2',
  description: 'Fold round-2 review comments into the D2 review-mode plan: parallel research/design, one serialized editor, then verify+repair',
  whenToUse: 'After the user has left round-2 comments on d2-review-mode-plan.html and the locked decisions are settled.',
  phases: [
    { title: 'Research', detail: '4 parallel agents: worker-middleware, injection sharing, ICommentsStore design, UX-sharing architecture — each emits a structured draft, no file edits' },
    { title: 'Fold-in', detail: 'ONE serialized editor applies every draft + every mechanical edit to the single HTML file (no file races, one consistent voice)' },
    { title: 'Verify', detail: 'One agent audits: all 18 comment-ids addressed, tags balanced, no edit-history artifacts, required sections collapsed' },
    { title: 'Repair', detail: 'If verify finds gaps, one agent fixes exactly those; re-verify (capped at 2 rounds)' },
  ],
}

// ---------------------------------------------------------------------------
// Single source of truth for this run.
// ---------------------------------------------------------------------------
const PLAN = '/Users/ben/agent-extensions/docs/plans/worker/d2-review-mode-plan.html'

// The decisions the user ratified in chat. The editor treats these as settled;
// research agents may add grounding but must not relitigate them.
const LOCKED = {
  apiShape:
    'Comments API = body-ops over a resource URL. The URL names only the collection ' +
    '(GET  /<repo>/<doc>?ref=<ref>&comments  -> list ; POST same URL -> mutate). Every verb and ' +
    'thread id lives in the POST BODY, never in the query string. A single op is an object ' +
    '{op:"create"|"reply"|"resolve"|"edit", ...}; a batch is just a JSON array [{op..},{op..}] — ' +
    'batch falls out for free. There is NO &thread and NO &op in the URL. The resource marker is a ' +
    'bare valueless ?comments (with ?comments=1 accepted as an equivalent). This follows standard URL ' +
    'semantics (query string is orthogonal to path, so it cannot collide with a repo file path) — a ' +
    'design property to confirm in the router spike, not an asserted GitHub behavior.',
  localPersistence:
    'Drop the on-disk JSON sidecar as an agent-facing artifact: the agent ALWAYS calls HTTP and is simply ' +
    'handed a local URL (served locally) or the worker URL (served remotely) depending on context — same ' +
    'call shape either way. Behind the local URL the local server persists to a JSON file, but ONLY the ' +
    'server touches that file; it is an implementation detail of a LocalFileStore, not something the agent ' +
    'reads off disk. So ICommentsStore has two impls: LocalFileStore (JSON file) and D1Store (SQL). ' +
    'The old "agent reads the sidecar JSON off disk" path is tracked for deletion.',
  foldInStyle:
    'ONE serialized editor applies all edits to the single HTML file. No parallel file writers (they race ' +
    'on file state). Consistent voice, deterministic order.',
  newDocsPlacement:
    'Nothing that exists today moves. The plan only RECORDS that the NEW agent-prompting doc/skill we will ' +
    'later create lives in the htmldocs skill path, referenced with the barest pointer from SKILL.md ' +
    '(e.g. "for review 2.0 with a worker, see this file"), to be massaged in code review. This is plan-record ' +
    'only — no file creation/movement happens in this workflow.',
}

// The 18 round-2 comments, canonical. `anchorExact` is the text the user highlighted
// (helps the editor locate the spot); `intent` is the distilled instruction; `bucket`
// routes the work. Every id here MUST be accounted for by the verifier.
const COMMENTS = [
  { id: 'c-f3553af7', section: 'db-design', bucket: 'docs-reminder',
    anchorExact: 'Cloudflare D1 has no TTL',
    intent: 'Leave a reminder (for us) that the "D1 has no TTL / aging-out is manual" fact should be captured in a high-level reviewing.html-level doc when D2 is done, alongside the proxy-layer capture. A tracked reminder in the plan, not the doc itself.' },
  { id: 'c-30f2dae1', section: 'db-design', bucket: 'mechanical',
    anchorExact: 'Open decision: confirm migrations-adoption and aging-out-deferral are firmly decided',
    intent: 'CONFIRMED. Delete this open-decision callout entirely — migrations adoption and aging-out deferral are now firmly decided.' },
  { id: 'c-4e1a1cf7', section: 'identity', bucket: 'schema',
    anchorExact: 'author_id',
    intent: 'We SHOULD store an author_id column on the comment row NOW (capture the data early), but we do NOT resolve it at render time (that would add another lookup). So: schema captures author_id; render still uses the snapshotted author_name/author_login. Adjust the identity/schema prose accordingly.' },
  { id: 'c-7eed519d', section: 'api', bucket: 'mechanical',
    anchorExact: 'The local skill\'s "sidecar" is a JSON file the agent reads off disk.',
    intent: 'Reword the API intro to open with framing like "What exists today is a local workflow that writes a JSON sidecar..." — forward from today\'s reality toward the hosted HTTP surface.' },
  { id: 'c-451662e9', section: 'api', bucket: 'api-redesign',
    anchorExact: 'wo consumers share it: the injected widget (browser session cookie) and the',
    intent: 'Adopt LOCKED.localPersistence: remove the JSON sidecar as an agent-facing artifact in favor of HTTP-only, identical call shape whether local or hosted (agent just gets the right URL). Track the old on-disk-sidecar path for deletion.' },
  { id: 'c-53529ab3', section: 'api', bucket: 'api-redesign',
    anchorExact: 'POST   /<doc-path>?ref=<ref>&comments&thread=<id>      -> reply / resolve / edit',
    intent: 'Do not put thread in the URL. Keep thread (and op) in the body. This naturally enables batch: wrap ops as an array [{op1},{op2}]. Apply LOCKED.apiShape.' },
  { id: 'c-6d115c07', section: 'api', bucket: 'api-redesign',
    anchorExact: 'Open decision: the exact ?comments spelling is a human call.',
    intent: 'RESOLVED in chat: follow standards, drop &thread, accept ?comments or ?comments=1. Replace this open-decision callout with the LOCKED.apiShape decision stated as settled (no longer "open").' },
  { id: 'c-428aba95', section: 'api', bucket: 'api-redesign',
    anchorExact: 'thread',
    intent: 'In the verb/route table, move the thread/op details out of the URL and into the POST body per LOCKED.apiShape.' },
  { id: 'c-105b665b', section: 'authz', bucket: 'hierarchy',
    anchorExact: 'Authorization —',
    intent: 'Clean up the hierarchy. High-level (visible): we create a checkAccess helper invoked on ALL routes via a single dispatch chokepoint (the Worker equivalent of middleware) so the access probe always runs. Push the current probe implementation detail into a collapsed area under the Auth section. Uses R1 research on the Worker middleware equivalent.' },
  { id: 'c-bac69c34', section: 'widget', bucket: 'mechanical',
    anchorExact: 'The sharp question the user raised: can we go further than sharing a widget',
    intent: 'The one-runtime answer was "recommend no". Delete this framing paragraph to stay forward-looking. Keep the decision up front (share one widget, two runtimes), and move the "why not one runtime" reasoning into a collapsed <details> titled "Alternatives considered: one runtime", hidden by default.' },
  { id: 'c-8ba62c09', section: 'widget', bucket: 'design',
    anchorExact: 'Open decision — the ICommentsStore signature.',
    intent: 'Stop leaving the ICommentsStore signature open. Since it is unit-testable, design the most ergonomic interface for the use cases implied by the locked queries/routes, and reckon each method\'s impl for BOTH stores (D1Store + LocalFileStore). Replace the open-decision with the chosen interface (visible) + impl reckoning (collapsed). Uses D1 research.' },
  { id: 'c-27ae3cec', section: 'widget', bucket: 'ux-sharing',
    anchorExact: 'ui',
    intent: 'Share ideally ALL the UX code so UX never diverges and we always reckon against both runtimes. The boundary must be clear — in directory structure AND in claude.md files describing each directory\'s purpose. Uses D2 research.' },
  { id: 'c-87da8920', section: 'widget', bucket: 'ux-sharing',
    anchorExact: 'becomes',
    intent: 'Clarify that "shared UX" covers everything from how it renders to in-page interactions. Fold into the same UX-sharing prose as c-27ae3cec.' },
  { id: 'c-090c3b5b', section: 'widget', bucket: 'research',
    anchorExact: 'th runtimes inject the same <script type="module"> tag',
    intent: 'Both runtimes inject basically the same thing. Should injection be common or separate code? Record the researched recommendation. Uses R2 research.' },
  { id: 'c-f8dec74d', section: 'prompting', bucket: 'mechanical',
    anchorExact: 'ent prompting',
    intent: 'Keep only the yellow summary visible; collapse the supporting reasoning into a hidden-by-default <details> section.' },
  { id: 'c-d14f66e1', section: 'prompting', bucket: 'mechanical',
    anchorExact: 'pass-1 home is kept concrete',
    intent: 'Apply LOCKED.newDocsPlacement: the prompt doc/skill we create lands in the htmldocs skill path, referenced by the barest SKILL.md pointer, massaged in code review. Record as a decision, not an open question.' },
  { id: 'c-7685c226', section: 'questions', bucket: 'mechanical',
    anchorExact: 'solve UX — reopen & visibility.',
    intent: 'Resolve UX: keep it simple for v1 — just change the comment indicator color to green (instead of the default color) to signal resolved. No hide/toggle/reopen machinery in v1; note UX can be expanded later.' },
  { id: 'c-fd47ac14', section: 'questions', bucket: 'api-redesign',
    anchorExact: 'open Probe cachin',
    intent: 'Design the APIs to accept batches [{ops}] for efficiency. This is the same batch decision as the API-shape work — ensure the questions/probe-caching area reflects that batch is a first-class part of the API, not a maybe.' },
]

const inSection = (s) => COMMENTS.filter((c) => c.section === s)
const byBucket = (b) => COMMENTS.filter((c) => c.bucket === b)
const idList = (arr) => arr.map((c) => c.id).join(', ')
const checklist = (arr) =>
  arr.map((c) => '  - [' + c.id + '] (#' + c.section + ') ' + c.intent +
    (c.anchorExact ? '\n      locate near: "' + c.anchorExact + '"' : '')).join('\n')

// ---------------------------------------------------------------------------
// Schemas. Deliberately FORGIVING: only ONE required field each, everything
// else optional, no nested-object `required`, no enums, all free-form strings.
// Overly strict schemas have repeatedly tripped the StructuredOutput retry cap
// on prior runs, so we accept a looser shape and defensively read it in JS
// (?? fallbacks everywhere the results are consumed).
// ---------------------------------------------------------------------------
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    section: { type: 'string', description: 'target section id in the plan, e.g. authz / widget / api' },
    commentIds: { type: 'array', items: { type: 'string' }, description: 'comment ids this draft serves' },
    summaryLine: { type: 'string', description: 'one-line takeaway for a visible yellow-summary aside' },
    recommendation: { type: 'string', description: 'the decision/recommendation in plain prose' },
    visibleProseHtml: { type: 'string', description: 'forward-looking HTML to place VISIBLE in the section (high-level)' },
    collapsedDetailHtml: { type: 'string', description: 'HTML for a collapsed <details> block (impl detail); "" if none' },
    openForHuman: { type: 'array', items: { type: 'string' }, description: 'anything genuinely still needing a human call' },
    grounding: { type: 'array', items: { type: 'string' }, description: 'sources consulted (doc URLs, ctx7 ids, gh paths)' },
  },
  // Only the substance is required; the editor tolerates missing optional fields.
  required: ['recommendation'],
}

// Critique of a draft. One required verdict field; everything else optional.
const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    solid: { type: 'boolean', description: 'true if the draft is sound as-is and needs no revision' },
    holes: { type: 'array', items: { type: 'string' }, description: 'concrete gaps, contradictions, or unhandled cases' },
    mustFix: { type: 'array', items: { type: 'string' }, description: 'the subset of holes that block acceptance' },
    notes: { type: 'string', description: 'any other guidance for the reviser' },
  },
  required: ['solid'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    tagsBalanced: { type: 'boolean' },
    tagCounts: { type: 'string', description: 'e.g. "details 6/6, section 21/21, ..."' },
    artifacts: { type: 'array', items: { type: 'string' }, description: 'backward-looking / edit-history phrasings (empty if none)' },
    perComment: {
      type: 'array',
      description: 'one entry per comment id with addressed:true/false and brief evidence',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          addressed: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
    unaddressed: { type: 'array', items: { type: 'string' }, description: 'comment ids not satisfied' },
    issues: { type: 'array', items: { type: 'string' }, description: 'other problems (missing collapse, API drift, etc.)' },
  },
  // Only the go/no-go signal is required; the loop reads the rest defensively.
  required: ['tagsBalanced'],
}

// Shared preamble so every agent shares the same forward-looking house style.
const STYLE = [
  'HOUSE STYLE (strict):',
  '- Forward-looking voice ONLY. Never write "previously", "used to", "this changes", "reverses the earlier",',
  '  "the user raised", or any edit-history / iteration artifact. Write as if freshly authored.',
  '- Match the existing HTML conventions in the plan: <section>/<article>, <aside class="risk">,',
  '  <span class="rec">Decision: ...</span>, <span class="badge ok">chosen</span>, <details><summary>, <pre><code>.',
  '  (Escape < > & as &lt; &gt; &amp; inside <pre><code>.)',
  '- Collapsed detail goes in a <details> with NO open attribute (hidden by default).',
  '- Keep VISIBLE prose tight and high-level; push implementation detail into the collapse.',
].join('\n')

// ===========================================================================
// PHASE 1 — Research & design (parallel).
// A barrier (parallel) is correct here: the single serialized editor in Phase 2
// genuinely needs ALL four drafts together before it can make one consistent pass.
//
// Depth where it matters: the two LOAD-BEARING drafts (the comments-API design
// and the UX-sharing architecture) each go through a critique -> revise-if-needed
// layer before the editor trusts them. The two lighter drafts (R1, R2) are a
// single generate pass. This makes the fan-out DEEPER on the quality-critical
// work rather than WIDER — no extra generation agents, just a skeptic + optional
// revise on the drafts that decide the round.
// ===========================================================================
phase('Research')

// ---- Prompt bodies (named so the critique layer can reference each) ----------

const R1_PROMPT = [
  'You are researching for a design plan (htmldoc-review, a per-org Cloudflare Worker).',
  '',
  'QUESTION: Cloudflare Workers have no Express-style built-in middleware. What is the idiomatic',
  'equivalent for running a checkAccess helper on EVERY route (both the doc-proxy routes and the new',
  'comments routes) so the GitHub access-probe authorization ALWAYS runs and can never be forgotten?',
  '',
  'Consider and compare: a single dispatch chokepoint inside the fetch() handler that wraps/guards every',
  'route; router libraries with middleware (itty-router, Hono) and whether adopting one is warranted here;',
  'a compose(handlers) pattern. Recommend the lightest approach that guarantees checkAccess runs on all',
  'authenticated routes and maps deny (403/404 from GitHub) to the neutral 404.',
  '',
  'GROUND IT: use `npx ctx7@latest library "Cloudflare Workers" "<q>"` then `npx ctx7@latest docs <id> "<q>"`,',
  'and/or WebFetch developers.cloudflare.com. Cite what you consulted in `grounding`. Do NOT invent API behavior.',
  '',
  'OUTPUT the DRAFT: visibleProseHtml = the HIGH-LEVEL big picture (we create a checkAccess helper invoked',
  'on all routes via <the recommended chokepoint>; Workers\' middleware equivalent explained in one or two',
  'sentences). collapsedDetailHtml = the probe implementation detail (the current access-probe mechanics)',
  'plus a short helper-shape sketch, in a <details>. This serves comment c-105b665b in the #authz section.',
  '',
  STYLE,
].join('\n')

const R2_PROMPT = [
  'You are researching for the htmldoc-review D2 plan.',
  '',
  'CONTEXT: Two runtimes serve review-mode docs. (a) The LOCAL node server injects a <script type="module">',
  'tag for the built comments bundle plus an inline JSON seed of existing comments (today it does string/DOM',
  'injection). (b) The hosted Cloudflare WORKER injects the same script+seed, but via HTMLRewriter (streaming).',
  '',
  'QUESTION: should the injection logic be COMMON (shared code) or SEPARATE per runtime, given they do',
  'basically the same job through different mechanisms? Identify the platform-independent core (what to inject:',
  'the script tag + the JSON seed contract) vs. the unavoidable per-runtime shim (HTMLRewriter streaming vs.',
  'node string/DOM). Recommend one, with the boundary drawn explicitly.',
  '',
  'GROUND IT: use ctx7 (`npx ctx7@latest library "Cloudflare Workers" "HTMLRewriter injecting script and inline json"`',
  'then docs) and/or WebFetch developers.cloudflare.com for HTMLRewriter capabilities/limits. Cite in `grounding`.',
  '',
  'OUTPUT the DRAFT: visibleProseHtml = the recommendation in one or two sentences (shared seed/contract core,',
  'thin per-runtime injector). collapsedDetailHtml = the shared-core-vs-shim breakdown in a <details>.',
  'Serves comment c-090c3b5b in the #widget section.',
  '',
  STYLE,
].join('\n')

// LOAD-BEARING: the whole comments-API design (route/body + op envelope + batch + store).
const API_PROMPT = [
  'You are designing THE comments API for the htmldoc-review D2 plan — the load-bearing design of this round.',
  'This is a design/reckoning task; grounding is optional (SQLite/D1 + JSON-file semantics only). Produce a',
  'complete, coherent, standards-following spec that a reader could implement against with no further decisions.',
  '',
  'LOCKED (do not relitigate — build on these):',
  '1. ' + LOCKED.apiShape,
  '2. ' + LOCKED.localPersistence,
  '',
  'DESIGN ALL FOUR LAYERS as one coherent whole:',
  '',
  'A) ROUTE + BODY SPEC. The URL names only the collection (GET /<repo>/<doc>?ref=<ref>&comments -> list;',
  '   POST same URL -> mutate). Specify the exact request/response bodies. No &thread/&op in the URL.',
  '   Serves c-451662e9, c-53529ab3, c-6d115c07, c-428aba95.',
  'B) OP ENVELOPE. Define the single-op object shape {op:"create"|"reply"|"resolve"|"reopen"|"edit", ...fields}',
  '   for each verb (what fields each carries: anchor+text for create; threadId for resolve/reopen; threadId+text',
  '   for reply; commentId+patch for edit). Show a concrete JSON example of each.',
  'C) BATCH. A batch request is a JSON array [{op..},{op..}] mixing verbs freely. Specify: response shape',
  '   (per-op results, order preserved), partial-failure semantics, and idempotency. This is first-class, not a',
  '   maybe. Serves c-fd47ac14.',
  'D) STORE INTERFACE. Design the MOST ERGONOMIC ICommentsStore for exactly these use cases, cleanest to UNIT',
  '   TEST and mapping naturally to the op envelope. Decide the open question — coarse full-model save with a',
  '   hosted-side diff vs. granular methods (list/create/reply/resolve/reopen/edit + batch(ops)). For EACH method',
  '   reckon the concrete impl in BOTH stores: D1Store (SQL) and LocalFileStore (read-modify-write of one JSON',
  '   file, server-only). Call out divergence — especially how batch executes: D1 transaction vs. single JSON',
  '   rewrite — and atomicity/partial-failure guarantees per store. Serves c-8ba62c09.',
  '',
  'CONSISTENCY REQUIREMENT: layers A–D must not contradict each other. The batch semantics in C must be exactly',
  'what the store batch() in D executes, and the op envelope in B must be exactly what the routes in A accept.',
  '',
  'OUTPUT the DRAFT: recommendation = the API in a nutshell (2–4 sentences). visibleProseHtml = the high-level',
  'API narrative + chosen store interface signatures (replaces any "open decision" in #api and #widget).',
  'collapsedDetailHtml = the detailed spec: route/body table, per-verb JSON examples, batch response shape, the',
  'TypeScript ICommentsStore interface, and the per-method D1-vs-LocalFile impl+atomicity reckoning (tables fine),',
  'all inside <details> blocks. Set commentIds to the ids above; put anything you truly cannot settle in openForHuman.',
  '',
  STYLE,
].join('\n')

// LOAD-BEARING: share ALL UX code, boundary in dirs + claude.md.
const UX_PROMPT = [
  'You are designing the code-sharing architecture for the htmldoc-review D2 plan.',
  '',
  'GOAL: share ideally ALL the UX code between the local review server and the hosted Worker so the review',
  'UX NEVER diverges — everything from how comments RENDER (highlights via CSS.highlights, margin-gutter',
  'thread bubbles, resolved=green indicator) to in-page INTERACTIONS (selection popover, the <dialog> composer,',
  'submit/reply/resolve wiring). Only the transport differs: the ICommentsStore impl and the injection shim.',
  '',
  'DELIVER: a clear boundary expressed in BOTH (1) directory structure — which directories hold shared UX vs.',
  'per-runtime adapters — and (2) a claude.md file per key directory describing that directory\'s purpose and the',
  'sharing contract, so the boundary is self-documenting and future edits reckon against both runtimes. Note',
  'that the article-only comment gate is being removed, which makes more of the UX shareable document-wide.',
  '',
  'OUTPUT the DRAFT: visibleProseHtml = the sharing architecture + the boundary rule (high-level). ',
  'collapsedDetailHtml = the proposed directory layout and the per-directory claude.md purpose blurbs, in a',
  '<details>. Serves c-27ae3cec and c-87da8920 in the #widget section.',
  '',
  STYLE,
].join('\n')

// ---- Critique -> revise-if-needed for the load-bearing drafts ---------------
// Generate a draft, have a skeptic poke holes, and revise ONLY if it flags
// blocking gaps. Every step degrades gracefully: a null draft short-circuits,
// a null/!solid-less critique is treated as "no blocking issues", and a failed
// revise falls back to the original draft. Never throws.
async function draftWithCritique(genPrompt, critiqueFocus, opts) {
  const draft = await agent(genPrompt, { ...opts, schema: DRAFT_SCHEMA })
  if (!draft) return null

  const critique = await agent([
    'You are a skeptical design reviewer for the htmldoc-review D2 plan. Poke holes in the DRAFT below.',
    'Be concrete and adversarial, but do not manufacture problems — if it is sound, say so (solid:true).',
    '',
    'Focus especially on: ' + critiqueFocus,
    '',
    'DRAFT (JSON):',
    JSON.stringify(draft, null, 2),
    '',
    'Report via the schema: solid (true if acceptable as-is), holes (concrete gaps/contradictions/unhandled',
    'cases), mustFix (the subset that BLOCKS acceptance), notes (any guidance). Keep it tight.',
  ].join('\n'), { label: opts.label + ':critique', phase: 'Research', schema: CRITIQUE_SCHEMA, agentType: 'general-purpose' })

  const mustFix = critique?.mustFix ?? []
  const solid = critique?.solid ?? true // missing/failed critique => don't force a revise
  if (solid && mustFix.length === 0) return draft

  const revised = await agent([
    'Revise your DRAFT to fix ONLY the blocking issues a reviewer raised. Keep everything that already works;',
    'do not rewrite wholesale. Return the SAME schema shape as before (a full draft).',
    '',
    'Blocking issues (mustFix):',
    JSON.stringify(mustFix, null, 2),
    'Other holes worth addressing if cheap:',
    JSON.stringify(critique?.holes ?? [], null, 2),
    'Reviewer notes: ' + (critique?.notes ?? '(none)'),
    '',
    'Your original DRAFT (JSON):',
    JSON.stringify(draft, null, 2),
    '',
    'Original task, for reference:',
    genPrompt,
  ].join('\n'), { label: opts.label + ':revise', phase: 'Research', schema: DRAFT_SCHEMA, agentType: 'general-purpose' })

  return revised ?? draft // if revise died, the original draft still stands
}

const research = await parallel([
  // Light drafts: single generate pass.
  () => agent(R1_PROMPT, { label: 'R1-middleware', phase: 'Research', schema: DRAFT_SCHEMA, agentType: 'general-purpose' }),
  () => agent(R2_PROMPT, { label: 'R2-injection', phase: 'Research', schema: DRAFT_SCHEMA, agentType: 'general-purpose' }),

  // Load-bearing drafts: generate -> critique -> revise-if-needed.
  () => draftWithCritique(
    API_PROMPT,
    'internal consistency across the four layers (does the op envelope in B match the routes in A and the ' +
      'store.batch() in D?); batch partial-failure + idempotency actually specified, not hand-waved; every verb ' +
      '(create/reply/resolve/reopen/edit) representable in the envelope; LocalFileStore vs D1Store atomicity for ' +
      'batch honestly reckoned; the interface being genuinely unit-testable and REST-standard-ish.',
    { label: 'D1-api-design', phase: 'Research' },
  ),
  () => draftWithCritique(
    UX_PROMPT,
    'whether the boundary truly leaves NOTHING runtime-specific leaking into shared UX (injection shim and store ' +
      'transport are the only per-runtime pieces?); whether the directory layout + claude.md scheme is concrete ' +
      'enough to act on; whether removing the article-only gate is fully reflected in what becomes shareable.',
    { label: 'D2-ux-sharing', phase: 'Research' },
  ),
]).then((r) => r.filter(Boolean))

log('Research drafts in: ' + research.length + '/4 returned (2 critiqued)')

// ===========================================================================
// PHASE 2 — Fold-in (ONE serialized editor over the single file).
// ===========================================================================
phase('Fold-in')

const editorPrompt = [
  'You are the SOLE editor of one HTML planning doc. Apply EVERY change below to this file and only this file:',
  '  ' + PLAN,
  '',
  'This is a human-reviewed design doc. Read it fully first, then make precise Edit calls. Do NOT run a server,',
  'do NOT touch git, do NOT edit any other file.',
  '',
  '=== LOCKED DECISIONS (settled — state them as decided, never as open) ===',
  '1. API shape: ' + LOCKED.apiShape,
  '2. Local persistence: ' + LOCKED.localPersistence,
  '3. New docs placement: ' + LOCKED.newDocsPlacement,
  '',
  '=== PHASE-1 RESEARCH/DESIGN DRAFTS (fold these in; they carry their own visible + collapsed HTML) ===',
  'Each draft targets a section and lists the comment ids it satisfies. Use the visibleProseHtml as the visible',
  'high-level content and collapsedDetailHtml inside a <details>. Adapt wording to fit the surrounding prose, but',
  'preserve the substance and keep the collapse/visible split the draft intends.',
  JSON.stringify(research, null, 2),
  '',
  '=== MECHANICAL / DIRECT EDITS (no research needed — apply exactly as intended) ===',
  '#api section:',
  checklist(inSection('api')),
  '',
  '#authz section:',
  checklist(inSection('authz')),
  '',
  '#widget section:',
  checklist(inSection('widget')),
  '',
  '#identity section:',
  checklist(inSection('identity')),
  '',
  '#prompting section:',
  checklist(inSection('prompting')),
  '',
  '#db-design section:',
  checklist(inSection('db-design')),
  '',
  '#questions section:',
  checklist(inSection('questions')),
  '',
  '=== BATCH/API COHERENCE NOTE ===',
  'The api-redesign comments (' + idList(byBucket('api-redesign')) + ') and the ICommentsStore draft must end up',
  'CONSISTENT: URL names the collection, body carries op(s), batch is an array, no &thread/&op in the URL, and the',
  'store interface exposes a batch path. Reconcile them into one coherent API narrative; do not leave contradictory',
  'route tables. Replace any now-settled "Open decision" callouts in these areas with the decided design.',
  '',
  '=== DELETIONS / TRACKING ===',
  '- Delete the confirmed open-decision callout (c-30f2dae1) rather than rewording it.',
  '- Delete the one-runtime framing paragraph (c-bac69c34); relocate its "why not" into a collapsed',
  '  "Alternatives considered: one runtime" <details> hidden by default.',
  '- Where LOCKED.localPersistence retires the agent-reads-sidecar path, mark that path as tracked-for-deletion',
  '  in the plan (a clear note), consistent with the forward-looking voice.',
  '',
  STYLE,
  '',
  'When done, return a PLAIN-TEXT summary: for each of the ' + COMMENTS.length + ' comment ids, one line stating',
  'what you changed and where. This summary is read by the orchestrator, not the end user — be concise and factual.',
].join('\n')

const editSummary = await agent(editorPrompt, { label: 'fold-in-editor', phase: 'Fold-in', agentType: 'general-purpose' })
log('Editor pass complete.')

// ===========================================================================
// PHASE 3 — Verify, then Repair (loop capped at 2 rounds).
// ===========================================================================
const allIds = COMMENTS.map((c) => c.id)

const verifyPrompt = (roundNote) => [
  'Audit this edited HTML planning doc: ' + PLAN,
  roundNote,
  '',
  'Check ALL of the following and report via the schema:',
  '1. For EACH of these ' + allIds.length + ' comment ids, is its intent satisfied in the doc? Give brief evidence',
  '   (a quoted phrase or the section it landed in). ids + intents:',
  checklist(COMMENTS),
  '',
  '2. Tag balance: count opening vs closing for details, section, article, pre, code, table, tr, td, aside, summary.',
  '   Report the counts string and set tagsBalanced true only if ALL match.',
  '3. Edit-history artifacts: flag any backward-looking / iteration phrasing ("previously", "used to", "this changes",',
  '   "reverses", "the user raised", stale "Open decision" that is now settled, etc.). Empty array if none.',
  '4. Required collapses present & hidden-by-default (<details> without open): the authz probe impl (c-105b665b),',
  '   "Alternatives considered: one runtime" (c-bac69c34), the prompting reasoning (c-f8dec74d), the ICommentsStore',
  '   impl reckoning (c-8ba62c09), and the injection detail (c-090c3b5b). List any missing/incorrect as issues.',
  '5. API coherence: the route table and prose reflect body-ops + batch array, NO &thread/&op in URL. Flag drift.',
  '',
  'Read the file directly; do not trust any summary. Do not edit anything — report only.',
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
    'Unaddressed comment ids (satisfy their intent — see the full list for what each means):',
    (verdict.unaddressed || []).join(', ') || '(none)',
    '',
    'Edit-history artifacts to rewrite forward-looking:',
    JSON.stringify(verdict.artifacts || []),
    '',
    'Other issues to fix (missing collapses, tag imbalance, API drift, etc.):',
    JSON.stringify(verdict.issues || []),
    '',
    'Tag balance report from the audit (fix any imbalance): ' + (verdict.tagCounts || '(n/a)'),
    '',
    'Full comment intents for reference:',
    checklist(COMMENTS),
    '',
    STYLE,
    '',
    'Make minimal, surgical edits. Return a concise plain-text list of what you fixed.',
  ].join('\n'), { label: 'repair-r' + round, phase: 'Repair', agentType: 'general-purpose' })

  phase('Verify')
  verdict = await agent(verifyPrompt('Re-audit after repair round ' + round + '.'), {
    label: 'verify-r' + round, phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose',
  })
}

return {
  file: PLAN,
  researchDrafts: research.length,
  editSummary,
  finalVerdict: verdict,
  clean: isClean(verdict),
  repairRounds: round,
  note: isClean(verdict)
    ? 'All comment ids addressed; tags balanced; no artifacts. Ready for human review.'
    : 'Stopped after ' + round + ' repair round(s) with residual items — see finalVerdict.unaddressed/issues.',
}
