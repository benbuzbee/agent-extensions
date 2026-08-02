# D2 build — resume handoff

The D2 stacked-PR build (workflow `docs/plans/worker/d2-build-workflow.js`, name
`d2-build-stack`) cleanly finished **through PR2** and was paused on 2026-07-02
so the build laptop could be reset.

## What's on origin (safe)

Three stacked branches, pushed to `origin`, stacked on `main` in this order:

```
main
 └─ d2/pr0-plan-docs            (plan, revisions, this workflow)
     └─ d2/pr1-extraction-store-seam
         └─ d2/pr2-comment-api-logic   ← tip; resume builds on top of this
```

PR3–PR6 are NOT built yet. Remaining: PR3 (Worker + Cloudflare D1), PR4 (API on
Worker + checkAccess), PR5 (identity capture), PR6 (injection + docs), then the
wrap-up (full-stack gate, exit-criteria audit, submit the draft stack).

## Resume on a fresh machine

1. Clone the repo, `git fetch origin`, and check out the three `d2/*` branches so
   they exist locally.
2. **Re-track the Graphite stack** — Graphite's parent/child metadata is stored in
   local `.git` config, NOT in git, so a fresh clone won't know the stack shape.
   If `gt log short` doesn't show pr0→pr1→pr2 on main, `gt track` each branch onto
   its parent (or `gt track --parent`). The workflow's preflight will refuse to run
   if the stack isn't recognized, so you'll know immediately.
3. Verify tooling: `gt` installed, `gh auth status` green (the wrap-up submits
   draft PRs).
4. Check out **`d2/pr2-comment-api-logic`** with a **clean working tree** — the
   resume preflight (RESUME MODE) requires the base branch current + clean + the
   stack present on top of main.
5. Launch a **fresh run** (do NOT use `resumeFromRunId` — that cache is bound to the
   old session and is gone):

   ```
   Workflow({scriptPath: "docs/plans/worker/d2-build-workflow.js", args: {startAt: "pr3"}})
   ```

## Workflow gotchas already fixed in the committed script

- **Resume-aware preflight**: `startAt:"prN"` expects to be ON the previous layer's
  committed branch with a clean tree, instead of demanding clean `main`.
- **`args` normalization**: the harness sometimes delivers `args` as a JSON *string*;
  the script parses either an object or a string, so `startAt`/`submit` always read.
- **`stallMs: 600000` on every `effort:'high'` call**: the workflow harness has a
  180s "no progress" watchdog (verified in the cli.js binary — `agent()` reads a
  per-call `stallMs`, default `F0m = 180000`, 5 retries → 6 attempts). Slow/throttled
  Opus time-to-first-token was tripping it and burning all retries. Raising the
  ceiling to 10 min lets a slow response ride out. NOTE: `stallMs` is read by the
  binary but is undocumented in the `agent()` options — if a future Claude Code
  release stops honoring it, this reverts to the 180s default.

## Related

- `docs/plans/worker/d2-review-mode-plan.html` — the plan (source of truth); each
  PR card gets a "Validation evidence" block appended as its layer lands.
- `docs/plans/worker/d1-handoff.md` — Deliverable 1 shipped state + gotchas.
