# Deliverable 2 — Proposed plan revisions

**What this is.** This document collects proposed revisions to
[`docs/plans/worker/d2-review-mode-plan.html`](d2-review-mode-plan.html), drafted in
response to the user's review comments on that plan. It is **prose for approval, not
yet applied to the HTML.** Each section below corresponds to one drafted revision unit,
lists the review comment ids it addresses, gives a one-paragraph summary of the change,
reproduces the drafted prose verbatim, and surfaces any items flagged as open for a human
to decide. A coverage matrix at the end maps every review comment id to the unit(s) that
address it, flagging any gaps.

Reading order below follows the shape of the target document: overview → starting-point →
unification → db-design → identity → api → authz → prompting → questions-and-phases.

> Note: sections 6 (api) and 7 (authz) were re-grounded in GitHub API research after an
> initial ungrounded pass.

---

## 1. Overview & goal

**Comments addressed:** `c-fefe9bb4`

**Summary.** The Overview described what Deliverable 1 shipped but never linked its
documentation. This revision cross-links the D1 proxy/auth docs (the app README) and the
D1 handoff on the first mention of "Deliverable 1 shipped," and keeps a pointer to the
architecture plan as "the plan for it." The load-bearing change is one added parenthetical
in the opening sentence; no decisions are changed.

**Drafted prose:**

## Overview & goal

Deliverable 1 shipped: a per-org Cloudflare Worker logs a viewer in via a GitHub App and serves any repo's `.html` doc *as that user*, with GitHub's `404` acting as the access gate. (See the [proxy/auth README](../../../apps/htmldoc-review/README.md) for how it works and how to deploy it, the [D1 handoff](d1-handoff.md) for what actually shipped and its live status, and the [architecture plan](htmldoc_worker_review.html) for the plan behind it.) Deliverable 2 adds the **review layer**: inject a comment UI into the served doc, persist comments in a store the Worker owns, and — new in this round — give an **agent** a first-class way to read and delete those comments over HTTP, so the hosted experience reaches parity with (and in one way exceeds) the htmldocs skill's existing local `serve.sh` review mode.

The three things this deliverable must produce:

- **A reviewer**, on a rendered doc, can select *anywhere in the document* (not just inside an `<article>`), leave an anchored comment, and see it persist across reloads and across users.
- **An agent**, holding a GitHub token, can `GET` the comments on a doc and `DELETE` a comment by id — the hosted equivalent of the local sidecar file the agent reads off disk.
- **Comments show real author names**, captured from GitHub at login.

The original architecture plan ([htmldoc_worker_review.html](htmldoc_worker_review.html) § "Deliverable 2") sketched this with a Durable-Object-per-doc store and an injected widget. This plan supersedes the store choice (now [Cloudflare D1](#store)) and adds the agent API + identity capture, which that sketch did not cover.

---

Alternative (tighter) if you would rather not front-load three links in sentence one: leave the opening sentence as-is and add a single lead-in clause instead:

> Deliverable 1 shipped: a per-org Cloudflare Worker logs a viewer in via a GitHub App and serves any repo's `.html` doc *as that user*, with GitHub's `404` acting as the access gate — see the [proxy/auth README](../../../apps/htmldoc-review/README.md) (docs + deploy) and the [D1 handoff](d1-handoff.md) (what shipped, live status); its plan is the [architecture doc](htmldoc_worker_review.html). Deliverable 2 adds the **review layer**: ...

Either way the same three targets are linked; the second keeps them in one clause and reuses the architecture link the last paragraph already carries.

**Open for human.** Two judgment calls: (1) There is no dedicated proxy.html doc under
apps/htmldoc-review — the actual proxy/auth documentation is the app README.md, so I linked
that per the comment's fallback instruction. (2) The comment says "ref to plan for it too";
the architecture plan (htmldoc_worker_review.html) is already linked in the Overview's last
paragraph, so linking it again in sentence one is mild duplication. I included it for a
self-contained first mention, but the tighter alternative avoids the double-link if
preferred. Also: the relative path ../../../apps/htmldoc-review/README.md is from
docs/plans/worker/ and matches the ../../../ prefix the doc's other app-relative links
already use — worth a quick check when porting into HTML. These same links also appear in
the Related aside at the bottom, so the Overview cross-link is intentional redundancy for
readers starting at the top.

---

## 2. Corrected framing — the local review widget (starting-point)

**Comments addressed:** `c-64b37b31`

**Summary.** Reframes the local review widget from "shipped & mature" to what it honestly
is: a fairly nascent implementation that we can use as a basis but expect to build on. The
corrected table row still credits the real, reusable core (the transport-agnostic anchor
model) so the reuse decision stays justified, but drops the "mature" claim and flags that
extraction is a build-on step, not a lift-and-shift of a finished thing. The companion "key
reuse insight" aside is retitled and softened for the same reason. No decisions change — the
plan still shares one widget; the framing just stops overselling its readiness.

**Drafted prose:**

## Corrected framing — the local review widget

### Starting-point table row (replaces the current "Local review widget" row)

| Asset | State after Deliverable 1 | D2 relationship |
| --- | --- | --- |
| **Local review widget** | **Early but usable** in the [htmldocs skill](../../../plugins/useful-skills/skills/htmldocs/): `src/comments/` → `dist/comments.mjs` anchors via W3C TextQuoteSelector, highlights via `CSS.highlights`, and persists to a JSON sidecar over `PUT /__htmldocs/sidecar/<doc>`. It works, but it's fairly nascent — a foundation to build on, not a finished component. | **Reuse as the basis, then harden** — same anchor core, new transport, and expect to shore it up along the way. See [Shared widget](#widget). |

### Notes on wording (for whoever ports this into the HTML)

- Drop "**Shipped & mature**." The widget is real and works locally, but calling it mature oversells it. Frame it as **nascent / early but usable** — a **basis to build on**, not a done thing.
- Keep the concrete capability list (TextQuoteSelector anchoring, `CSS.highlights`, sidecar PUT) — that's the honest, load-bearing part that justifies reusing it. The honesty adjustment is about *maturity*, not about *what it does*.
- Change the D2-relationship cell from a clean "Extract & share" to "**Reuse as the basis, then harden**" so the plan doesn't imply a lift-and-shift of a finished artifact. Extraction is a build-on step.

### Companion "key reuse insight" aside (retitle + soften)

Retitle from **"The key reuse insight"** to something like **"What's actually reusable (and what isn't yet)"**, and adjust the body so it credits the solid core without implying the whole widget is polished:

> **What's actually reusable.** The part worth building on is the widget's *anchor model* — the 32-char prefix/exact/suffix TextQuoteSelector (Hypothesis convention), which is already source- and transport-agnostic: it serializes a comment to JSON and PUTs it somewhere. That core is sound, so D2 keeps it and changes only *where* the JSON goes (Cloudflare D1 via the Worker, not a file) and *who else* reads it (an agent over HTTP, not off disk). The surrounding UI and build wiring are less settled — extracting and sharing them is real work (see [Shared widget](#widget)), and we should expect to refine the widget as we go rather than treat it as frozen.

### Optional touch-ups elsewhere (same theme, only if the human wants full consistency)

- **§Shared widget** already says the extraction "is the single largest piece of plumbing in this deliverable" — that's consistent with the nascent framing and needs no change. If anything, it *reinforces* the point that the widget is a basis, not a finished part.
- The overview's phrase "reaches parity with … the htmldocs skill's existing local `serve.sh` review mode" is fine — "existing" is accurate and doesn't claim maturity. Leave as-is.

**Open for human.** Two judgment calls to confirm: (1) I retitled the "key reuse insight"
aside to "What's actually reusable" and added a clause noting the UI/build wiring is less
settled — if you'd rather keep the aside narrowly about the anchor model and not touch its
maturity framing at all, drop that last sentence. (2) I left the overview's "parity with
the existing local review mode" wording untouched since "existing" isn't a maturity claim;
flag if you want that softened too. Table column headers are kept identical to the current
doc so the port is a drop-in row replacement.

---

## 3. Unifying the worker and local path efficiently (unification)

**Comments addressed:** `c-3ae8f6c2`, `c-8d7356d2`, `c-102be5b9`, `c-38f8542f`, `c-f42dd993`, `c-5cbec2b0`

**Summary.** Rewrites the old "Shared widget & injection" section as "Unifying the worker
and local path efficiently." It states the unification goal (one system, minimal
duplication), then makes the core call: we investigated running the *same* Worker runtime
locally via embedded Miniflare (which is genuinely clean and platform-independent) and still
recommend AGAINST it — the two servers live at different layers (auth/proxy vs. local file
sidecar) so "one runtime" is the wrong target. Instead we unify on one browser widget plus
one ICommentsStore interface, keeping two thin HTTP runtimes. The section presents Miniflare
as the evaluated-and-rejected fallback (with the crisp reason), defines ICommentsStore with
its opaque-doc-key seam, tables what's shared vs adapter-specific, describes injection for
both runtimes, and explicitly states PR #6 is NOT superseded and should merge on its own.

**Drafted prose:**

## Unifying the worker and local path efficiently

Two review paths now exist: the mature **local** one (the htmldocs skill's `serve.ts` Node server + `src/comments/` widget, writing JSON sidecars to disk) and the **hosted** one this deliverable builds (the Worker + Cloudflare D1). The overarching steer for this round is to *unify the system* — one review experience, one body of code, gate-removals and bug fixes that land once and benefit both — rather than let a hosted fork of the widget drift away from the local one.

The sharp question the user raised: **can we go further than sharing a widget and actually run one runtime?** i.e. run the *Worker's own code* as the local review server, so "local" is just "the hosted app, pointed at your disk." We took that seriously — including whether there's a clean, platform-independent way to run a Worker + Cloudflare D1 locally at all — because if it exists it collapses two servers into one. This section records what we found and the resulting decision.

### The decision, up front

> **Unify on one widget + one store interface, not one server.** Extract the browser widget (`src/comments/`) so both runtimes inject the *identical* built artifact, and put a pluggable `ICommentsStore` seam behind its persistence layer (sidecar impl locally, D1/HTTP impl hosted). Keep the two HTTP runtimes **separate**: the Node server locally, the Cloudflare Worker hosted.

This is *not* the "`serve.sh` shells out to `node`" anti-pattern the user rejected, and it is *not* a widget fork. It is a single shared client and a single persistence contract, with two small adapters behind it. The reasoning — including why the tempting "one runtime" path loses even though a clean mechanism for it exists — is below.

### Why not one runtime (even though we can run a Worker locally)

There *is* a clean way to run Worker code locally: **embed [Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/) as a library** inside a Node script. Miniflare (v3+) is powered by `workerd` — the same runtime as production — runs entirely in-process with **no per-OS branching** and **no `wrangler` dependency**, and emulates **Cloudflare D1 (local SQLite) and KV** in-process (`d1Persist` / `kvPersist` for state that survives across runs). So the platform-independence question the user asked has a real answer: *yes, a Worker + D1 can run locally, cleanly, from a script.* This is the fallback we would have taken if the runtimes were otherwise interchangeable.

They are not. The local and hosted servers sit at **different layers**, and their differences are their *reason to exist*, not incidental plumbing:

| Concern | Local server (`serve.ts`) | Hosted Worker |
|---|---|---|
| **Persistence** | Writes JSON sidecars to a local FS path **the agent reads off disk** — the entire point of the local UX. | Writes to Cloudflare D1; cannot touch the user's disk. |
| **Auth** | None — single-user localhost. | OAuth, sessions, fetch-as-user, access probe. Its whole reason to exist. |
| **Doc source** | Arbitrary files off a `--root` tree. | GitHub Contents API by `(org, repo, path, ref)`. |
| **Injection** | String-splice into files read off disk. | `HTMLRewriter` streaming over a proxied GitHub response. |
| **Runtime API** | `node:http/fs/os`, yargs, `process` signals. | `fetch()` handler, KV/D1 bindings, `HTMLRewriter`, `ExecutionContext`. |

Running the Worker locally would mean **no on-disk sidecar** (defeating the agent-reads-the-file workflow) and would **force a GitHub login onto a today-zero-auth flow**. The Worker's portable `core/` (config, cookies, oauth, session, docsource) *is* genuinely platform-independent — but it is the auth/proxy machinery the local runtime doesn't want, not the comments machinery it shares. So "one runtime" would unify the *wrong* half. We adopt the two-runtime shape not as a fallback we settled for, but because the shared surface is the widget, not the server.

### What we share: one widget, one store interface

The reuse boundary already exists in the code. The widget's persistence layer (`persistence.ts`) hides the transport behind a small store object; `main.ts` depends only on that surface. We formalize it as **`ICommentsStore`**:

```ts
interface ICommentsStore {
  load(key: DocKey): Promise<CommentsModel>;
  save(key: DocKey, model: CommentsModel): Promise<void>;
}
```

- **`key` is an opaque doc key the store maps** — *not* a bare basename. Locally that key resolves to `location.pathname` under `--root`; hosted it resolves to the `(repo, ref, path)` tuple D1 is keyed on. Making the key opaque is what lets the same widget serve both without knowing which world it's in.
- **`CommentsModel` and the anchor types** (`types.ts`) are the single wire+disk shape, already validated identically (`isWellShapedModel`) on both ends. Shared verbatim.
- **The anchor model** (`anchor.ts`) is already runtime- and transport-agnostic — a W3C TextQuoteSelector triple over the visible-text stream, decoded against the whole document. Nothing in it knows about a file, a server, or Cloudflare. Shared verbatim.

Two implementations sit behind the interface:

| Impl | Where | `load` | `save` |
|---|---|---|---|
| **`SidecarStore`** | local | reads the inline JSON seed | PUTs the **full model** to `/__htmldocs/sidecar/<doc>` (last-writer-wins, as today) |
| **`ReviewApiStore`** | hosted | inline seed, or `GET /__review/comments?repo=&ref=&path=` | **per-comment** `POST` / `DELETE /__review/comments` |

The widget picks its impl by sniffing which seed/routes the server injected — no build-time fork. The full-model-`save` vs. per-comment-op mismatch is the one real interface tension: the hosted store either diffs the model inside `save`, or we widen the interface to `create(key, comment)` / `remove(key, id)`. The plan leans per-comment hosted-side (it's what the agent API wants and it sidesteps whole-file last-writer-wins); the exact signature is tracked as an [open question](#questions).

### Shared vs. adapter-specific, at a glance

| Layer | Shared (one codebase) | Adapter-specific |
|---|---|---|
| Capture / anchor / highlight | ✅ `anchor.ts`, `ui.ts`*, `main.ts` | — |
| Wire/disk model | ✅ `types.ts` (`CommentsModel`, `Anchor`) | — |
| Store interface | ✅ `ICommentsStore` | — |
| Store implementation | — | `SidecarStore` (local) · `ReviewApiStore` (hosted) |
| Identity | — | fixed `"user"` (local) · real GitHub name from session (hosted) |
| HTTP server | — | `serve.ts` Node (local) · Worker `fetch` (hosted) |

\* `ui.ts` becomes shareable once the article-only popover gate is dropped ([Removing the article-only limit](#anchoring)) — a one-predicate change, not an anchoring change.

The single largest piece of plumbing is relocating `src/comments/` to a location **both** builds consume — the skill's esbuild step (which emits the checked-in `dist/comments.mjs` the skill distributes) and the Worker's build. `anchor.ts` / `types.ts` / `ui.ts` / `main.ts` move as-is; only `persistence.ts` grows a second impl and `main.ts`'s store selection changes. **Constraint to design around:** the skill checks in a prebuilt `dist/comments.mjs` for distribution, so a shared source must still emit that checked-in artifact. This move gets its own phase.

### Injection

Both runtimes inject the *same* `<script type="module">` tag for the *same* built bundle, plus an inline JSON seed of existing comments so the page paints with its comments and zero extra round trips. Only the injection *mechanism* differs:

- **Local:** `serve.ts` string-splices the seed + script tag before `</body>` on files it reads off disk (today's `injectIntoHtml`, unchanged).
- **Hosted:** the Worker wraps the Deliverable 1 doc response in `HTMLRewriter` and appends the same two nodes to `<body>`. Injection only happens on a `200` HTML response — the neutral 404 path is untouched (no widget, no leak).

```js
new HTMLRewriter()
  .on('body', { element(el) {
    el.append(seedJsonScript(comments), { html: true });
    el.append(widgetScriptTag(), { html: true });
  }})
  .transform(docResponse)
```

### PR #6 is not superseded

[PR #6](https://github.com/benbuzbee/agent-extensions/pull/6) (node-native review server + Mermaid `noscript` fallback) is **orthogonal** to this deliverable and is **not** superseded. It moves port/arg/file-vs-dir handling out of `serve.sh` into `serve.ts`'s yargs CLI (so review mode runs anywhere `node` is on PATH) and adds a Mermaid fallback. It touches only the local skill — not the widget, the anchor model, the persistence seam, or the Worker. It should **merge on its own**; D2's server-side changes then layer cleanly on top of the node-native `serve.ts` it produces. (It is also unrelated to the Miniflare question above: PR #6 is about the *local* Node server, not about running Worker code locally.)

**Open for human.** Three judgment calls to confirm: (1) I recommend AGAINST one-runtime
despite Miniflare being clean — matching your north star's "otherwise fall back" branch,
since the runtimes diverge at the persistence/auth layer. If you'd still rather prototype the
Miniflare-embedded path as a spike, say so and I'll reframe it as a recommended experiment
rather than a rejected option. (2) The `ICommentsStore` signature (full-model `save` +
hosted-side diff, vs. widening to `create`/`remove`) is left as an open question consistent
with the existing doc; I did not lock it. (3) I referenced PR #6 by the
benbuzbee/agent-extensions URL from the research — confirm that's the correct public repo
path for the doc's audience. Also note: the R5 Miniflare doc subpaths
(/workers/testing/miniflare/storage/d1/ etc.) came through search-redirect wrappers and
should be click-confirmed before anyone cites them verbatim; I only linked the top-level
Miniflare overview URL to stay safe.

---

## 4. DB Design (db-design)

**Comments addressed:** `c-9c954d4e`, `c-83ffbc44`, `c-c31e3d00`, `c-f42dd993`, `c-fc693430`

**Summary.** Turns the single "Proposed schema" block into a full "DB Design" section with
three subsections (Expected queries, Proposed schema, Migrations) plus a short "Aging out"
note and an explicit "Decisions needed" callout. The schema is reframed as the concern of
the D1 adapter behind the ICommentsStore abstraction (so the local sidecar adapter is
unaffected). Two substantive content changes reflect user decisions: the no-ref sentinel is
now the literal string 'default' (not empty string), and D1's lack of any built-in TTL is
stated with a decision to defer manual cron-based aging-out. The migrations subsection
documents the concrete wrangler d1 migrations workflow and the safe add-a-column pattern.
Verify-before-locking items (current Cloudflare pricing, exact wrangler syntax,
wrangler.toml vs .jsonc, DROP COLUMN support) are flagged, matching the doc's existing
"figures drift, re-verify" tone.

**Drafted prose:**

# DB Design

> Replaces the current single "Proposed schema" block under **The comment store — Cloudflare D1**. The store choice (one shared Cloudflare D1 database) is already decided above; this section is the *design of that database* — what it's queried for, its shape, and how we change it later.

The schema below is the concern of exactly one thing: the **D1 adapter behind `ICommentsStore`**. The widget and the agent talk to `ICommentsStore` (`list` / `create` / `delete`, plus `resolve` if we add it); the hosted deployment wires in `D1CommentsStore` and the local `serve.sh` keeps its JSON-sidecar adapter (`SidecarCommentsStore`). Nothing outside the D1 adapter knows these columns exist, so the sidecar path is untouched by anything here.

## 1. Expected queries

The store only ever answers a handful of shapes. Designing the columns and indexes around exactly these keeps it honest and cheap.

| # | When | Query | Notes |
|---|------|-------|-------|
| Q1 | Doc paints; agent reads feedback | `SELECT … FROM comments WHERE repo = ? AND ref = ? AND path = ? ORDER BY created_at` | The hot path. Backs `GET /__review/comments` and the inline seed. Must hit an index — this is the one query that runs on every doc load. |
| Q2 | Author or agent deletes | `DELETE FROM comments WHERE id = ?` | Primary key lookup. Backs `DELETE /__review/comments/<id>`. |
| Q3 | Reviewer posts | `INSERT INTO comments (…) VALUES (…)` | Server mints `id`, stamps `author_*` from the session, stamps `created_at`. |
| Q4 | *(if resolve ships)* agent soft-closes | `UPDATE comments SET resolved_at = ? WHERE id = ?` | Reserved, not in v1. See open decisions. |

**The `ref` rule (decided).** A comment is scoped to `(repo, ref, path)`. `ref` stores the literal value the reviewer was viewing:

- If a **branch** was requested (`?ref=main`), the comment stores `"main"` and thereby *moves with the branch* — it shows on whatever `main` points at now. This is intended.
- If a **commit SHA** was requested, the comment stores that SHA and pins to it.
- If **no `ref` was given**, we store the literal string **`'default'`** — never an empty string, never `NULL`. Q1 then queries `ref = 'default'` for a no-ref view. Using a real sentinel (rather than `''`) keeps the column unambiguous in the index and in logs, and makes "the default view" a value you can grep for.

> Whether a SHA view should *also* surface `ref = 'default'` (or branch) comments is a **display-policy** question decided in the API layer, not here — the store faithfully returns rows for the exact `ref` asked. (Tracked in Open questions → "Comment identity vs ref.")

## 2. Proposed schema (`schema_version = 1`)

```sql
CREATE TABLE comments (
  id           TEXT PRIMARY KEY,               -- server-minted uuid
  repo         TEXT NOT NULL,                  -- e.g. "internal-automation"
  ref          TEXT NOT NULL DEFAULT 'default',-- branch/tag/sha; 'default' == no ref requested
  path         TEXT NOT NULL,                  -- doc path within the repo
  anchor       TEXT NOT NULL,                  -- JSON: {sections, prefix, exact, suffix}
  body         TEXT NOT NULL,
  author_login TEXT NOT NULL,                  -- GitHub login, from the session
  author_name  TEXT,                           -- display name, from the session (nullable)
  created_at   TEXT NOT NULL,                  -- ISO-8601
  resolved_at  TEXT                            -- nullable; reserved for resolve, see decisions
);

-- Covers Q1 exactly (repo, ref, path) and keeps the per-load list an index scan.
CREATE INDEX idx_comments_doc ON comments (repo, ref, path);
```

Notes on the shape:

- **`anchor`** is the same W3C TextQuoteSelector triple the local widget already serializes (`{sections, prefix, exact, suffix}`), stored as an opaque JSON blob — the widget's payload crosses the wire unchanged. The DB never parses it; anchoring stays entirely client-side.
- **`author_login` / `author_name`** are stamped server-side from the session (see *Capturing reviewer identity*). `author_name` is nullable because older sessions may lack a display name; `author_login` is always present.
- **`resolved_at`** is reserved now so that adding a soft-resolve workflow later needs *no migration* — the column already exists, `NULL` = open, timestamp = resolved.
- **No `schema_version` column on rows.** The version lives with the migration set (see below), not per-row; a single tiny table doesn't need per-row versioning.

## 3. Migrations

We adopt **Wrangler's built-in D1 migration system** from day one, so every schema change is a version-controlled, replayable SQL file rather than an ad-hoc `wrangler d1 execute`. This is the piece Deliverable 1 never needed (KV has no schema); it's new operational surface, so we set it up deliberately.

**Mechanism.** A `migrations/` directory of sequentially numbered `.sql` files (`0001_create_comments.sql`, …). Wrangler tracks which have run in a `d1_migrations` table inside the database, so each file applies exactly once, in order.

**Workflow** (verify exact syntax against `developers.cloudflare.com` for the pinned Wrangler version before locking):

```bash
# scaffold a new numbered, empty migration file
wrangler d1 migrations create <db-name> "create comments table"

# ...edit the generated .sql...

# apply pending migrations locally first, then to production
wrangler d1 migrations apply <db-name> --local
wrangler d1 migrations apply <db-name> --remote
```

The v1 table above lands as `0001_create_comments.sql`. The deploy script (already responsible for wiring the D1 binding into `wrangler.toml`) runs `migrations apply --remote` as part of deploy so a fresh environment provisions its schema automatically.

**Adding a column safely** — the common future case (e.g. an `agent_authored` flag, a `severity`):

1. New migration: `ALTER TABLE comments ADD COLUMN <name> <type>` **as nullable** (or with a default) so existing rows stay valid. This is the whole change for a plain additive column.
2. Apply `--local`, confirm, then `--remote`.

**Anything harder than an additive column** — changing a type, adding `NOT NULL` to an existing column — is constrained by SQLite's limited `ALTER TABLE`. Use the **expand → backfill → contract** pattern: add the new nullable column; dual-write and backfill existing rows in batches (one-off script or Worker); switch reads to the new column; optionally drop the old column in a later migration. We don't need this for v1; it's documented so the first person who does isn't surprised.

## Aging out (D1 has no TTL)

Cloudflare D1 has **no built-in row TTL or auto-expiry** — there is no analog to Workers KV's per-key `expirationTtl`. Any expiry is manual: a Worker on a **Cron Trigger** running a scheduled `DELETE FROM comments WHERE created_at < ?` (with `created_at` indexed to keep the scan cheap; each deleted row bills as one row-written).

**Decision: skip it for now.** Comments are tiny text rows and the free tier's storage / row-read / row-write allowances are effectively unlimited for a small team, so aging-out is a data-hygiene choice, not a cost necessity. We defer building cron cleanup until volume actually warrants it. (One caveat to keep on file: a D1 database *at* its storage cap can reject writes — including the `DELETE`s you'd use to clean up — so if we ever approach real scale we'd want a cleanup strategy in place *before* getting large, not after.)

## Decisions needed

Surfacing what a reviewer of this section actually has to sign off on:

| Decision | Proposed call | Status |
|----------|---------------|--------|
| **`ref` sentinel** — how to store "no ref requested" | Literal `'default'` (not `''`, not `NULL`); Deliverable 1's doc route must normalize a missing `?ref=` to the same sentinel so store and route agree. | **Decided** (confirm the route/store share the sentinel). |
| **Adopt the `migrations/` directory now** | Yes — set up Wrangler migrations with `0001_create_comments.sql` in the D1-binding phase, rather than a one-shot `execute`. | **Decided** (proposed). |
| **Aging-out / TTL** | Don't build it. D1 has no TTL; free tier covers the volume; add cron cleanup later only if data grows. | **Decided** (defer). |
| **`resolved_at` — reserve vs use** | Reserve the column in v1 (no migration needed later); ship delete-only. Whether the agent soft-resolves vs hard-deletes stays an open question in *Open questions*. | Reserved; behavior open. |
| Pricing / syntax to re-verify before locking | Current D1 free-tier numbers, exact `wrangler d1 migrations` syntax, `wrangler.toml` vs `.jsonc` for our Wrangler version, and current `DROP COLUMN` support. | Verify. |

**Open for human.** Three judgment calls to confirm: (1) I renamed the store seam to
`ICommentsStore` with `D1CommentsStore` (hosted) / `SidecarCommentsStore` (local) adapters
per c-f42dd993 — the rest of the doc still says `ReviewStore` (line 436) and
`persistence.ts` store object (line 388), so those references should be reconciled to one
name when this is ported. (2) The current schema DDL uses `ref TEXT NOT NULL DEFAULT ''`
with `'' == default branch`; c-fc693430 changes this to the literal `'default'`. I switched
the DDL default and normalization rule accordingly, but this is a behavioral change from
Deliverable 1's doc-route handling of a missing `?ref=` (line 275/276 says D1 normalizes
missing ref to the default branch) — confirm the doc route and the store agree on the same
`'default'` sentinel, or the normalization must happen in one agreed place. (3) I list the
migrations-adoption and aging-out-deferral as *decided* (user gave a steer on both) but
surfaced the residual open decisions (whether to add the migrations/ dir now, whether to
ever build cron cleanup) as an explicit decision list per c-83ffbc44 — confirm framing.

---

## 5. Capturing reviewer identity (identity)

**Comments addressed:** `c-7eee453c`, `c-c9d4911e`, `c-b8990fd9`

**Summary.** Rewrites the "Capturing reviewer identity" section to close three comments. It
keeps the capture-at-login plan (login + name + id) but now adds: a snapshot-at-comment-time
note plus the name-change staleness limitation (c-c9d4911e); an explicit story for sessions
that already exist when we start requiring identity, recommending lazy on-read backfill of
{login,name,id} rather than forced re-login, with the KV schema-versioning mechanics and a
stated fallback to forced re-login if backfill isn't derivable (c-7eee453c + the migration
half of c-c9d4911e); and a reversed logging stance — we now deliberately LOG reviewer
login/name for auditability because public GitHub identity is not sensitive PII in an
org-scoped, operator-visible deployment (c-b8990fd9). The section also introduces a version
field on the KV session record so future evolutions are lazy-upgradeable, consistent with
the Deliverable 1 KV-only session store.

**Drafted prose:**

## Capturing reviewer identity

Comments need author names. Today the session record holds only tokens; Deliverable 1's `completeLogin` never asks GitHub who the user is. **Plan: after the token exchange, call `GET /user` once with the fresh token and store `{ login, name, id }` on the session KV record** alongside the tokens. When a comment is created, the API stamps `author_login` / `author_name` from the session — the browser never supplies its own identity, so it can't spoof another reviewer.

- One extra GitHub call per login only (never per request); identity is cached on the session for its lifetime.
- Keep it minimal — login, display name, numeric `id`. No email, no avatar in v1. The numeric `id` is the stable key: logins can be renamed on GitHub, so `id` is what we'd match on if we ever reconcile.
- The record carries a `version` field (see below) so this and any later identity fields can evolve without a flag day.

For the **agent**, identity comes from *its* GitHub token the same way — the access probe in [Authorization](#authz) already calls GitHub as the agent — so agent-authored actions are attributable too. Relevant if an agent ever creates comments; v1 grants it read + delete only.

### Names are a snapshot, not a live join

`author_login` / `author_name` are **copied onto the comment row at create time**, not looked up live when comments are rendered. That's deliberate — it keeps read/list a single indexed query with no fan-out to GitHub — but it has a known consequence, called out so it isn't a surprise:

> **Known limitation.** If a reviewer later changes their GitHub display name (or login), **already-stored comments keep the old name.** We snapshot identity as it was at comment time; we do not re-fetch or back-rewrite historical rows. The stable numeric `id` is stored on the *session*, not the comment row, so v1 has no mechanism to reconcile a renamed user's old comments — and by design won't. If accurate historical attribution ever matters, the fix is to also store `author_id` on the comment row and resolve the display name at render time; not planned for v1.

### Existing sessions when identity becomes required

Deliverable 1 shipped live, so **there are already valid session records in KV that predate this field.** They must not break, and we need a deliberate answer for them rather than discovering it in production.

KV values are opaque blobs with no enforced schema: adding `{ login, name, id }` to the record shape leaves every existing record physically unchanged, so a naive read of an old session simply finds those fields absent. Two ways to handle that:

| Approach | What happens to existing sessions | Cost |
| --- | --- | --- |
| **Lazy on-read upgrade** *(recommended)* | On the next authenticated request, if the record lacks identity, call `GET /user` with the session's stored token, write `{ login, name, id }` + bump `version` back to the same key. Old sessions silently self-heal; nobody is logged out. | One extra GitHub call the first time each stale session is used, then cached. |
| **Forced re-login** | Invalidate all pre-identity sessions so everyone re-authenticates and picks up identity through the normal `completeLogin` path. Mechanically: delete-on-read of unversioned records, bump the KV namespace, or rotate the session-signing secret. | Every current user is logged out once. |

**Decision: lazy on-read upgrade.** We already hold each session's token server-side, so identity *is* derivable for a live session without bothering the user — the on-read `GET /user` is the same call `completeLogin` will now make, just deferred. Forced re-login is the fallback **only** if a future required field can't be derived from what the session already holds (e.g. something the token can't fetch); for identity it can, so we take the graceful path.

To make this and future changes routine, the session record gains an explicit **`version` field now** (identity capture ships as `version: 2`; pre-identity records are treated as `version: 1`). Read logic branches on `version`, upgrades in place, and writes the record back — the standard KV schema-evolution pattern. That keeps every later session-shape change a lazy upgrade instead of a migration event. (There's no bulk backfill job: sessions are short-lived under their native TTL, so any record that's never read again simply ages out.)

> **Note — this is KV, not Cloudflare D1.** The versioning above is for the *session* records in KV. The *comments* live in Cloudflare D1, whose schema changes go through Wrangler's migrations directory (numbered `.sql` files, applied `--local` then `--remote`, tracked in `d1_migrations`); additive columns are added nullable. The two stores evolve by different mechanisms — don't conflate them.

### We log reviewer identity, on purpose

**Reviewer login and display name are logged with comment operations, for auditability.** This reverses the earlier draft's "logging never includes identity beyond `sessionId`" note.

The reasoning: this Worker is installed **into a single org and is operated by someone who can already see the org's members and everything they can read.** A public GitHub login and display name are not sensitive PII in that context — the operator can see them in GitHub directly. Suppressing them from logs buys no meaningful privacy while actively costing us the ability to answer "who left / deleted this comment, and when" from operational logs. Auditability wins.

Concretely:

- Comment `POST` / `DELETE` log lines include the acting `author_login` (and `name` where handy) alongside the existing `sessionId`, the doc `(repo, ref, path)`, and the outcome. Delete is the one worth auditing most — it's the agent's primary mutation and is destructive.
- Tokens, refresh tokens, and the raw session record are **still never logged.** "Log identity" means the public GitHub login/name, not the credential — the token-secrecy posture from Deliverable 1 is unchanged.
- Identity still lives only in the server-side session record and in D1, never in the cookie (cookie stays the opaque session id). Reversing the *logging* stance doesn't change *where identity is stored*.

**Open for human.** Three judgment calls to confirm: (1) I set the session-record schema
version to 2 for identity capture (pre-identity records = version 1) — fine as a convention,
but if you'd rather not introduce an explicit version field yet, the lazy on-read upgrade
still works by presence-check ("no login field → backfill"); the version field just makes
future changes cleaner. (2) The staleness fix I describe (store author_id on the comment row
+ resolve name at render) is stated as explicitly out of scope for v1 — flag if you actually
want it in scope. (3) I left the numeric id captured but noted it's stored on the session,
not the comment row; if you want future-proof reconciliation you may want it on the comment
row too, which slightly changes the D1 schema in the #store section (author_id column) —
that's a store-section change I did not make here. Also: the research's CAVEATS flag that
exact Wrangler migration syntax and current D1 pricing/DROP COLUMN support should be verified
against developers.cloudflare.com before locking; my prose stays at the mechanism level and
avoids quoting figures, so no verification is load-bearing for this section.

---

## 6. The comment API (human + agent) (api)

**Comments addressed:** `c-74733b36`, `c-b7cda7b1`

**Summary.** Revised the "comment API (human + agent)" section to (1) drop the reserved /__review/ path prefix in favor of a ?comments query-param action on the doc URL itself — this composes cleanly with the existing catch-all doc route and its ?ref=, and eliminates the file-named-__review collision worry the user raised; and (2) re-cast the verb set on GitHub's own comment vocabulary (list/create/reply/resolve/unresolve/edit/delete), adopting GitHub's thread-owns-resolution + one-level-reply model, while explaining — grounded in the research — why we run our own Cloudflare D1 store rather than posting natively. Batch and reply are deferred (with a forward-compatible thread shape); v1 ships list/create/resolve, with the agent surface being list + resolve.

**Drafted prose:**

## The comment API (human + agent)

*(Revised section — resolves c-74733b36 and c-b7cda7b1.)*

The local skill's "sidecar" is a JSON file the agent reads off disk. The hosted equivalent is a small HTTP surface on the same Worker. Two consumers share it: the injected **widget** (browser session cookie) and the **agent** (GitHub bearer token). Every operation enforces the [access probe](#authz).

Two questions decide the shape of that surface: **what URL do comment operations live at**, and **what verbs does the surface expose**. Both were raised in review; both are answered decisively below.

### Route shape — `?comments` on the doc URL, not a reserved prefix

The earlier draft put comments under a reserved `/__review/` path prefix. Review flagged two real problems: a repo could contain a doc literally named `__review` (or `__review/…`) and collide with the reserved namespace, and reserving a path prefix at all sits awkwardly next to Deliverable 1's **catch-all doc router**, where the *entire* request path *is* the doc path and `?ref=` selects the ref. The suggested alternative — **treat comments as a query-param action on the doc's own URL** (`GET …?comments` lists, `POST …?comments` writes) — is the better design. Adopting it.

**Decision: comment operations are a `?comments` action layered onto the existing doc route**, not a separate path namespace.

```
GET    /<doc-path>?ref=<ref>&comments          → list threads for this doc
POST   /<doc-path>?ref=<ref>&comments          → create a thread (widget)
POST   /<doc-path>?ref=<ref>&comments&thread=<id>   → reply / resolve / edit (see verbs)
```

Why this wins on every axis the review named:

- **Collision.** A query parameter lives in a namespace GitHub paths cannot reach — a repo file named `__review` is just another doc path and is served normally; `?comments` on it addresses *its* comments. There is no path prefix to collide with, so the worry disappears entirely rather than being mitigated. (Query-string keys are not part of the resource path, so no repo content can shadow them.)
- **Clarity.** The doc key *is* the request — `(repo, ref, path)` is exactly the tuple the doc router already parses. `?comments` reads as "the comments *of this doc*," which is what it is. No parallel `?repo=&ref=&path=` triple to keep in sync with the doc URL, and no risk of the two disagreeing.
- **Composition with `?ref=`.** `?comments` composes with the existing `?ref=` for free — same ref-resolution code path, same "empty ref == default branch" normalization the store already assumes. A comment action inherits the ref of the doc URL it is attached to, with zero new parsing.

The catch-all router gains one branch: if the query string carries `comments`, dispatch to the comment handler with the already-parsed `(repo, ref, path)`; otherwise serve the doc. The doc-serving path is unchanged, and — as with the doc route — a missing `?ref=` normalizes to the repo default branch.

> **One thing to verify, not assert:** the research provided covers GitHub's comment *model*, not Worker URL parsing. The claim that `?comments` cannot collide with repo content rests on standard URL semantics (query string is distinct from path), not on anything GitHub-specific, so treat it as a design property to confirm in the router spike, alongside deciding whether a bare valueless `?comments` or an explicit `?comments=1` reads best.

### Verb set — mirror GitHub's names, own the store

Review's second steer: **don't reinvent the wheel — mirror GitHub's comment verbs**, and it asked about **batch** and **reply**, preferred **resolve** over **delete**, and asked "why not both?" We take the naming guidance directly and answer the rest from the research.

**We borrow GitHub's verb *names* but run our own store (Cloudflare D1).** This is not a rejection of "don't reinvent the wheel" — it's the opposite. The research is decisive that native GitHub comment storage does not fit rendered-HTML review:

- **GitHub has no anchor primitive for a rendered-HTML text range.** Native anchors are diff line, commit position, or none — a W3C `TextQuoteSelector` (the widget's prefix/exact/suffix triple) maps to none of them. Stored natively, the anchor is an opaque blob we would have to re-anchor ourselves anyway, so "no store to run" is illusory the moment arbitrary-HTML anchoring is required.
- **The only native surface with *both* resolve *and* threaded reply is PR review threads, which require an open PR** (`{pull_number}` in every write path). Manufacturing a throwaway PR per doc/ref to host comments would be absurd. `resolveReviewThread`/`unresolveReviewThread` are **GraphQL-only** and **PR-bound**; commit comments are flat (no reply, no resolve); issue/PR-conversation comments are flat (hide/minimize, no resolve); discussions can thread but have no resolve. No native surface offers the combination review mode needs *without* a PR.
- Native storage would also mean **posting as the user**, dragging OAuth scopes and REST rate limits through every comment read, with state scattered and no clean per-`(repo, ref, path)` query.

So we **mirror GitHub's vocabulary and its data model** onto our own D1 store. What we borrow, per the research:

| GitHub verb name | v1? | Notes |
| --- | --- | --- |
| `list` | **v1** | List threads for a doc (the `GET …?comments` above). |
| `create` | **v1** | Create a new thread — a root comment plus its immutable anchor. |
| `resolve` / `unresolve` | **v1** | Soft-close / re-open a thread. **Locked: v1 does resolve, not hard delete.** |
| `reply` | **deferred** | One-level reply onto an existing thread. Shape reserved; see below. |
| `edit` | **deferred** | Edit a comment body. |
| `delete` | **deferred** | Deliberately *not* in v1 (resolve is the soft-close). |
| `batch` | **deferred** | See below. |

**Thread-owns-resolution, one-level replies.** We copy GitHub's structural model, not just its verb names. From the research: in GitHub a **thread is the resolvable container** and resolution lives on the thread, not the comment (`PullRequestReviewThread.isResolved`); replies are **one level only** ("replies to replies not supported"). We adopt both:

- A **thread** is the unit an anchor attaches to and the unit that resolves. The immutable `TextQuoteSelector` anchor lives on the **thread root**; `(repo, ref, path)` indexes the thread. Resolution is a property of the thread (`resolved_at` on the root), never of an individual reply.
- **Replies are flat within a thread** — one level, matching GitHub. This keeps rendering and anchoring trivial (there is exactly one anchored root per thread) and avoids a nesting model GitHub itself declined to build.

This means the schema evolves from "row = comment" toward "row = thread root, with replies referencing it." For v1, where reply/edit/delete are deferred, a single-comment thread and a bare comment are indistinguishable, so the [existing `comments` table](#store) stands; the forward-compatible move is to treat each existing row as a thread root and add a nullable `reply_to` (thread-root id) column when `reply` lands. `resolved_at` is already reserved on the row and now formally means *thread* resolution.

**"Why not both" (resolve *and* delete)?** A locked decision already answers this: **v1 does RESOLVE (soft-close), not hard delete.** Resolve keeps the audit trail, matches GitHub's own bias (PR threads resolve; they are not deleted in the review flow), and is reversible via `unresolve`. Hard `delete` stays a named-but-deferred verb we can add later if a genuine "purge" need appears — but it is not needed for the agent's cleanup role, because *resolve* is that role.

**Batch — deferred, shape noted.** The research is specific: GitHub batches comments only via `POST …/pulls/{pull_number}/reviews` with a `comments[]` array, and offers **no batch resolve at all**. There is no native "resolve many" verb to mirror. v1 therefore ships single-thread operations. If batch resolve becomes worthwhile (an agent closing many threads after a pass), it is a purely additive endpoint over our own store — e.g. a `POST …?comments&batch` taking a list of thread ids to resolve — with no native equivalent to conform to. Noting it as forward-compatible, not building it.

### The v1 surface

Concretely, v1 exposes:

| Route | Who | Verb | Purpose |
| --- | --- | --- | --- |
| `GET /<doc>?ref=&comments` | widget + agent | `list` | List threads for one doc. Widget calls on load (or reads the inline seed); agent calls to read feedback. |
| `POST /<doc>?ref=&comments` | widget | `create` | Create a thread. Body `{anchor, body}`; `(repo, ref, path)` comes from the URL, author is stamped from the session. |
| `POST /<doc>?ref=&comments&thread=<id>&op=resolve` | agent + widget | `resolve` / `unresolve` | Soft-close (or re-open) a thread. The agent's primary mutation. |

(`op=` selects among the thread-scoped verbs so that deferred `reply`/`edit` slot in as new `op` values without new routes — the forward-compatible seam.)

**Agent-facing surface: list + resolve.** Per the locked decisions, the agent gets **read + resolve, no create in v1**. Its flow mirrors local review: *list* the threads a human left, address each via HTML edits, then *resolve* the ones it has handled (the hosted analogue of the user clearing sidecar entries — but soft, auditable, and reversible). The agent authenticates with its own GitHub token as a bearer; the [access probe](#authz) authorizes every call, so an agent that cannot fetch the doc gets the same neutral `404` and never learns the doc or its comments exist. Comments are **scoped to `ref`** (locked), inherited from the `?ref=` on the doc URL the action is attached to. Whether the agent later gains `create` (to leave its own findings) remains the [open question](#questions) it already was; identity capture makes agent authorship attributable if it does.

> **Optional, much later — one-way export.** The research suggests a future feature *atop* the store, never in place of it: a one-way export from D1 into a real PR review or discussion *when one already exists* for the ref. That is strictly additive and out of scope for D2 — flagged here only so the store design stays compatible with it.

**Open for human.** Two calls in this draft want a human nod before it goes into the doc: (1) the exact `?comments` spelling — I proposed a bare valueless `?comments` (with `?comments=1` as the alternative) and used `&op=resolve` / `&thread=<id>` as the forward-compatible seam for thread-scoped verbs; if you prefer a cleaner REST-ish shape (e.g. a sub-resource) that reintroduces some path structure, say so. (2) I kept the v1 mutation set to create + resolve/unresolve and pushed reply/edit/delete/batch to "named but deferred," per the locked decisions — confirm that batch-resolve is genuinely out of v1 (the research says GitHub has no batch-resolve to mirror, so it would be our own additive endpoint). Also note: the collision claim for `?comments` rests on standard URL semantics, not anything in the GitHub research — I flagged it as a router-spike verification rather than an asserted GitHub behavior, since the research provided doesn't cover Worker URL parsing.

---

## 7. Authorization — the access probe (authz)

**Comments addressed:** `c-7d9fadb5`, `c-c0d57a07`

**Summary.** Revised the Authorization section to keep the probe-before-honor principle and the neutral-404 non-leak contract, while answering both review comments precisely: no documented HEAD on the Contents endpoint (c-7d9fadb5 — the byte win is a media-type swap to application/vnd.github.object+json, not HEAD), and the real quota lever is conditional requests (c-c0d57a07 — If-None-Match -> free 304, plus an optional short-TTL cache; changing method/Accept saves bytes and CPU but never quota, since every call is still 1 core request). 403 and 404 both map to deny. Grounded strictly in the provided research; flagged the one spot (files <=1MB may still inline content under 'object') the research itself qualifies.

**Drafted prose:**

## Authorization — the access probe

The linchpin from the user's steer: *"the agent needs to probe access to the file before it accepts the comment or changes."* Comments must never become a side channel that leaks a private doc's existence or content to someone who couldn't fetch the doc itself. So every comment operation reuses Deliverable 1's authorization model: **can this caller fetch this doc as themselves?**

1. Resolve the caller's GitHub token — from the **session cookie** (widget) or the **bearer header** (agent).
2. **Probe**: issue a GitHub Contents read for `(repo, ref, path)` with that token. We only need the *status line*, never the body.
3. If the probe is not `200` (or `304` on a re-probe — see below) → return the **same neutral `404`** the doc route returns. Comment endpoints are thus indistinguishable from "no such doc" for anyone lacking access — no existence leak, identical to Deliverable 1's contract.
4. If `200`/`304` → the caller can see the doc, so they may read/write its comments. Proceed.

### The probe request: metadata, not the file body

Deliverable 1's `fetchDoc` streams the whole file (`Accept: application/vnd.github.raw+json`) because it needs the bytes to serve the doc. A *probe* needs only the status line, so it should ask GitHub for the cheapest representation:

```
GET /repos/{owner}/{repo}/contents/{path}?ref={ref}
Accept: application/vnd.github.object+json
Authorization: Bearer {caller-token}
```

`object+json` returns a small metadata JSON (`name`/`path`/`sha`/`size`/`type`/`_links`) rather than the file body. Compared to the alternatives on the same endpoint:

- `raw+json` (what `fetchDoc` uses today) streams the full body.
- the default `vnd.github+json` returns the body base64-encoded in a `content` field (~1.33× the raw size).
- `object+json` is the fewest-bytes representation.

The byte win is largest on big files. Per the research, for files **≤1MB the `object` response may still inline `content`**, so the saving on small docs is modest — but it costs nothing to ask for `object`, and the probe **never reads `content` regardless**; it inspects only the HTTP status. Same endpoint, same token, same status semantics as `fetchDoc` — only the representation shrinks.

> **On HEAD (c-7d9fadb5):** there is *no documented `HEAD` on the Contents endpoint*, so we do **not** rely on it as an authz signal. The "transfer fewer bytes" win here is a **media-type swap** (`object+json`), not a method change.

### Bytes vs. quota — state it plainly (c-c0d57a07)

These are two different costs and only one of them is helped by the media type:

- **Bytes / CPU:** `object+json` reduces payload (and parse work) on every probe. Always a win.
- **Rate-limit quota:** method and `Accept` header do **not** change primary-quota cost. Every `GET`/`HEAD`/metadata call is **1 request against the 5,000/hr core pool**. Swapping to `object+json` saves bytes, not quota.

The **only documented way to make a repeat probe free against primary quota is a conditional request.** Persist the `ETag` returned by the first probe of a `path@ref`, keyed by **`(path@ref@token-identity)`**, and send `If-None-Match` on subsequent probes:

```
GET /repos/{owner}/{repo}/contents/{path}?ref={ref}
Accept: application/vnd.github.object+json
Authorization: Bearer {caller-token}
If-None-Match: "{stored-etag}"
```

A `304 Not Modified` (unchanged **and** still authorized) **does not count against the primary rate limit**. So a `304` is treated exactly like `200` for the visibility decision — access is confirmed, quota untouched. Note `GET /rate_limit` is also free against primary quota but **cannot substitute** for this check: it carries no per-path access signal.

### Deny semantics and non-leak

Both `403` **and** `404` occur for no-access, and **both map to deny** → we return the neutral `404`. Only `200` (or `304` on a re-probe) counts as access. Changing the `Accept` header or adding `If-None-Match` does **not** change who can read what — it is the same endpoint, token, and status semantics as `fetchDoc`. The non-leak contract is preserved unchanged.

### Cost & race notes

A probe adds one GitHub Contents call per comment op (unless it resolves to a free `304`). Comment ops are rare — human pace, agent in bursts — so the 5,000/hr core limit is not a concern in practice. Two levers keep it that way if it ever bites:

1. **Conditional re-probes** (above): free `304`s on unchanged `path@ref`.
2. **Optional short-TTL probe cache** keyed by `(session/token-identity, repo, ref, path)`: within the TTL, skip the network call entirely. Keep the TTL short so revoked access is re-checked promptly — the cache trades a small staleness window for zero calls.

The probe authorizes **visibility**, not **authorship**: deleting *someone else's* comment is a separate policy ([open](#questions) — likely "any viewer may delete in v1" to match the local model's looseness, or "author-or-agent only").

**Open for human.** One thing the research explicitly qualifies and I carried through rather than smoothing over: for files <=1MB, GitHub's object+json response *may still inline the content*, so the byte savings on small docs (most planning HTMLs) could be marginal. The change is still worth making (it's free to request object, and the probe never reads the body), but if you expected a big byte win on typical docs, the honest answer is "mostly on large files." Also flag: the ETag cache key must include token-identity, or one user's 304 could authorize another — I made that explicit in the draft.

---

## 8. Agent prompting — where it lives (prompting)

**Comments addressed:** `c-5fcc4d3f`, `c-1c47d1f0`

**Summary.** Reframes the "Agent prompting — where it lives" section (and its Decision 6
row) from a settled design into an explicit pass-1 placement call: we still pick a concrete
first-pass home for the agent reference doc so work can proceed, but we flag that the real
integration — how the agent discovers and is prompted into hosted review — is deliberately
deferred and revisited near the end of the build, once the API surface and widget behavior
are concrete. Wording, cross-links, and the SKILL.md pointer are preserved; only the framing
(provisional vs. locked) changes.

**Drafted prose:**

## Agent prompting — where it lives (pass 1)

> **Pass-1 decision, revisit at the end.** This is a quick call to unblock the build, not a settled integration design. We pick a concrete first-pass home for the agent-facing doc so Phase 6 has somewhere to write, but *how* an agent discovers hosted review and gets prompted into it is deliberately left open until the API surface and widget behavior are real. Expect to revisit this near the end of the work.

**Pass-1 placement (Decision 6):** a new reference doc lives in `apps/htmldoc-review/` (e.g. `docs/agent-review.md` or a `references/` file in the app), describing how an agent drives hosted review mode — the URL shape, how to authenticate with its GitHub token, and the list / delete recipe. A *pointer* is added from the htmldocs [`SKILL.md`](../../../plugins/useful-skills/skills/htmldocs/SKILL.md) so an agent already in review context can find it.

This much we can commit to now because it's cheap and reversible — it's a file location plus a one-line cross-link, not a contract. The reasoning that motivates it:

- **Why not fold into the htmldocs skill:** hosted review is a different operational surface (a deployed Worker + GitHub token + org URL) from the local file-based recipe. Co-locating the guidance with the code that serves it keeps each recipe honest about its own transport.
- **Still cross-linked:** the SKILL.md pointer means the agent isn't expected to know the hosted doc exists out of nowhere — it's discoverable from where it already looks for review guidance.

**Explicitly deferred to the end of the build.** The following are *not* decided here, and the pass-1 placement above should not be read as pre-answering them:

- The exact prose, altitude, and recipes in the reference doc — these depend on the final `/__review/comments` shape, the neutral-404 access behavior, and how delete-by-id actually reads once built.
- Whether the SKILL.md pointer is the right (or only) discovery path, versus a tighter integration into the skill's review flow, versus something in the post-install / hosted-doc surface itself.
- Whether "reference doc + pointer" survives as the shape at all, or collapses into the htmldocs skill once we see how much the two recipes really diverge in practice.

**Sequencing:** do the pass-1 placement as part of Phase 6 alongside the doc writing, then treat the prompting/discovery integration as a final revisit pass once the earlier phases have pinned down the real behavior. Fold the still-incomplete htmldoc-review skill documentation (flagged separately, post-Deliverable-1 merge) into that same phase.

---

### Companion edit — Decision 6 row (decisions table)

Replace the Decision 6 recommendation cell so the table matches the provisional framing:

| # | Recommendation | Why |
|---|---|---|
| 6 | **Pass 1: agent prompting lives in a new reference doc inside `apps/htmldoc-review/`**, with a pointer from the htmldocs `SKILL.md`. *The discovery/prompting integration is revisited near the end of the build.* | Hosted-review guidance sits next to the code that serves it, distinct from the local file-based recipe — a cheap first-pass placement. The real integration is deferred until the API and widget are concrete. See [prompting](#prompting). |

**Open for human.** Two judgment calls to confirm: (1) I kept the concrete file suggestion
(`docs/agent-review.md` or a `references/` file) as pass-1 rather than dropping to a fully
abstract "somewhere in the app" — that seemed truest to "make a quick decision to move
forward now." If you'd rather the placement be even lighter, say so. (2) I moved the
"remember: htmldoc-review skill docs still incomplete" note out of the bullet list and into
the sequencing paragraph so it reads as scheduling rather than a standalone warn-badge; if
you want to preserve the `badge warn` styling as a distinct callout, the porter should keep
it as-is. Also note the ported HTML will need the article's `data-kind` and the intro `<p>`
reworded to lead with the pass-1 banner.

---

## 9. Decisions settled + Open questions + Implementation phases (questions-and-phases)

**Comments addressed:** `c-e42e36f2`, `c-1436e601`, `c-fc693430`, `c-62771773`, `c-e68f6069`, `c-97e3f67e`

**Summary.** Settled five of the doc's five open questions into decisions and rewrote the
two dependent sections to match. Resolve (soft-close, not hard delete) is now the verb the
agent uses, so "delete" language throughout the doc becomes "resolve"; any viewer of a doc
may resolve; comments are scoped to the ref they were written against (a branch ref moves
with the branch, a missing ref stores as 'default'); agent-create is explicitly out of v1;
and two-tab concurrency is settled by noting the per-comment ops on a strongly-consistent
store already sidestep the whole-file last-writer-wins problem. The Open Questions list is
trimmed to the two genuinely-open items (delete-vs-resolve as a later hardening question is
gone; residual concurrency is stated as accepted, not open). The Implementation Phases are
re-ordered and rewritten so each phase is independently shippable and reflects the
reorganized DB/one-runtime/ICommentsStore/probe/route sections.

**Drafted prose:**

## (A) Decisions settled this round

Moving these out of Open Questions and into the Locked-decisions table (each keeps a one-line pointer to its section, matching the existing decision rows). Suggested new rows 7–11:

| # | Decision | Rationale |
|---|----------|-----------|
| 7 | **Resolve, not delete.** The agent (and the widget) *resolve* a comment — a soft-close that stamps `resolved_at` and keeps the row — rather than hard-deleting it. There is no destructive delete verb in v1. | Keeps an audit trail of what was raised and addressed; the local "user clears the JSON" model loses that history, and a hosted store is exactly where keeping it is cheap. The `resolved_at` column already exists for this. See the [comment API](#api). |
| 8 | **Anyone who can see the doc may resolve.** Resolve authority is the same as read/write authority: pass the access probe and you may resolve any comment on that doc, regardless of who authored it. | Matches the local model's looseness and the agent's cleanup role; the access probe already gates *visibility*, and resolve is non-destructive, so per-author ACLs would be friction with no real payoff at team scale. See [Authorization](#authz). |
| 9 | **Comments are scoped to the `ref` they were written against.** The store keys every comment by the literal `(repo, ref, path)` the reviewer was viewing. If the `ref` is a branch, comments implicitly *move with the branch* — a comment on `main` shows against `main` as it advances, because the key is the branch name, not the commit. If no `ref` is supplied, it is stored as `'default'` and shown on the default-branch view. | This is the cheap, intuitive default: reviewers comment on "the doc on this branch," and the comment stays attached as the branch moves — no `resolveCommit` machinery, no SHA-pinning policy to maintain in v1. Pinning a comment to an exact commit is not a v1 behavior. See the [schema](#store-schema). |
| 10 | **No agent-create in v1.** The agent gets *list* and *resolve* only. It reads what a human left and closes out what it has addressed; it does not author new comments. | The concrete need (an agent leaving findings for a human) hasn't landed, and identity capture already makes it a small later addition if it does. Keeping the agent's surface to list + resolve keeps the v1 write path single-author (the human widget). |
| 11 | **Two-tab concurrency is a non-problem, by construction.** The store is Cloudflare D1 (strongly consistent) and every mutation is a *per-comment* create or resolve — never a whole-file rewrite. Two tabs open on the same doc cannot clobber each other's comments the way the local sidecar's last-writer-wins whole-file `PUT` could, because there is no shared blob to overwrite; each op targets one row. | This is the easiest, least-risky path: we get concurrency-safety for free from the store choice and the API shape, with no locking, no ETags, no merge logic. See [store tradeoffs](#store) and the [comment API](#api). |

> Note for the porter: settling #7 means the doc's "delete" language should become "resolve" wherever it describes the verb — the API table row, the `DELETE /__review/comments/<id>` route (now `POST /__review/comments/<id>/resolve` or equivalent), the agent-ergonomics aside, the exit criteria, and the overview's "read and delete." The route-shape section already reorganized should carry the resolve verb; this draft assumes that rename lands with it.

### Rewritten "Open questions" section (what genuinely remains)

Only two items survive as open. Everything else above is decided.

**Open questions**

- **open — Resolve UX: reopen and visibility.** Resolve keeps the row, so we can *show* resolved comments (greyed, collapsed) or hide them behind a toggle, and we can allow *reopen* (clear `resolved_at`). v1 needs a minimal call here: default to hiding resolved comments with a "show resolved" toggle, and allow reopen since it's free once the column is mutable. Confirm the widget affordance; no schema impact.
- **open — Probe caching.** The access probe adds one GitHub Contents call per comment op. Comment ops are rare, so the 5,000/hr limit isn't a concern, but if bursty agent runs ever bite, add a short-TTL per-`(caller, repo, ref, path)` probe cache. Left as a documented lever, not built in v1.

*(Removed: resolve-vs-delete — decided (#7); who-may-delete — decided (#8); comment-identity-vs-ref — decided (#9); agent-create — decided (#10); two-tab concurrency — decided (#11), residual is accepted, not open.)*

---

## (B) Rewritten Implementation phases

Consistent with the reorganized sections: one runtime with an `ICommentsStore` seam, identity capture + migration, the resolve verb, the cheaper probe, the reserved route shape, and pass-1 prompting. Ordered so each phase is independently shippable and de-risks the next; Phase 1 is pure plumbing with no user-visible change.

**Implementation phases**

1. **Cloudflare D1 binding + `ICommentsStore`.** Provision one D1 database, wire it into `wrangler.toml` and the deploy script, and add the migration for the `comments` table (`resolved_at` included from day one). Define the portable `ICommentsStore` seam in `core/` — `list(repo, ref, path)`, `create(comment)`, `resolve(id)` — with the D1 implementation behind it and empty `ref` normalized to `'default'` on write. Unit-tested against the existing fetch-mock patterns. No routes yet.

2. **One runtime: fold the store into the existing Worker.** Consume `ICommentsStore` from the single Worker runtime alongside the D1-era session/doc code — no second service, no separate deploy. This phase just proves the binding is reachable and the store round-trips from within the deployed Worker (a throwaway debug route or a test is fine); it exists to isolate the "does the binding work in prod" risk from the API work.

3. **Identity capture + session migration.** Extend `completeLogin` to call `GET /user` once and persist `{login, name, id}` in the session KV record; extend the session type. Backward-compatible: older sessions lack the identity block, so reads fall back to login-only and the field is populated on next login. No forced re-auth.

4. **Comment API + access probe.** Add the reserved-prefix `/__review/comments` routes with the query-param doc key (`?repo=&ref=&path=`): `GET` (list), `POST` (create, author stamped from session), and the **resolve** op by id. Implement the probe by reusing `fetchDoc` and mapping any non-200 (including 403) to the neutral 404. This is the agent-facing surface — list + resolve are testable with curl and a token before any UI exists. Agent scope is list + resolve only (no create).

5. **Widget extraction (shared, one runtime for the client too).** Move `src/comments/` to a shared location that both the skill build and the Worker build consume; add the `/__review` transport implementation behind the existing store seam; **remove the article-only gate**; wire the resolve action (and hide-resolved toggle) into the UI. Rebuild both bundles and regression-test local review mode — the gate removal and resolve UI land there too.

6. **Injection.** Add the `HTMLRewriter` step on 200 HTML doc responses, appending the widget script and an inline JSON seed of the doc's (unresolved) comments. The neutral-404 path stays untouched. End-to-end: open a hosted doc, comment anywhere, reload, see it persist; resolve it, see it drop from the default view.

7. **Prompting + docs.** Write the pass-1 agent reference doc in `apps/htmldoc-review/` — URL shape, GitHub-token auth, and the **list → address via HTML edits → resolve** recipe (no create). Add the pointer from the htmldocs `SKILL.md`, and fold in the still-missing htmldoc-review skill documentation flagged post-Deliverable-1.

**Deliverable 2 done when:** a reviewer on a hosted doc can comment on any DOM region and it persists across reloads and users; an agent with a GitHub token can list a doc's comments and resolve one by id, and is refused with a neutral 404 on a doc it can't see; comments display real author names; resolved comments are retained (auditable) and hidden from the default view; and local review mode still works via the shared widget with no regression.

**Open for human.** Two judgment calls to confirm: (1) I settled #7 as "resolve replaces
delete entirely — no destructive delete verb in v1." Your steer was "resolve, not hard
delete," which I read as removing hard-delete; if you actually want *both* verbs (resolve as
the default, delete still available), say so and I'll re-add a delete route. (2) The route
rename (`DELETE /__review/comments/<id>` → a resolve op like
`POST /__review/comments/<id>/resolve`) is implied by #7 but lives in the "route shape"
section you reorganized separately — I assumed that section carries the resolve verb. If the
reorganized route shape kept `DELETE`, flag it so the verb stays consistent across sections.
Also minor: I left "resolve UX (reopen/visibility)" as genuinely open with a recommended
default — tell me if you'd rather lock the default (hide + allow reopen) as a decision too.

---

## Coverage matrix

Every one of the 26 review comment ids, mapped to the unit(s) that address it. All 26 are
covered; no gaps.

| Comment id | Addressed by unit(s) |
|---|---|
| `c-fefe9bb4` | overview |
| `c-b7cda7b1` | api |
| `c-64b37b31` | starting-point |
| `c-8d7356d2` | unification |
| `c-7eee453c` | identity |
| `c-83ffbc44` | db-design |
| `c-102be5b9` | unification |
| `c-5fcc4d3f` | prompting |
| `c-c31e3d00` | db-design |
| `c-9c954d4e` | db-design |
| `c-f42dd993` | unification, db-design |
| `c-38f8542f` | unification |
| `c-c9d4911e` | identity |
| `c-b8990fd9` | identity |
| `c-74733b36` | api |
| `c-5cbec2b0` | unification |
| `c-7d9fadb5` | authz |
| `c-c0d57a07` | authz |
| `c-3ae8f6c2` | unification |
| `c-1c47d1f0` | prompting |
| `c-97e3f67e` | questions-and-phases |
| `c-e42e36f2` | questions-and-phases |
| `c-1436e601` | questions-and-phases |
| `c-fc693430` | db-design, questions-and-phases |
| `c-62771773` | questions-and-phases |
| `c-e68f6069` | questions-and-phases |
