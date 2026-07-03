// Seam shim — the ONE place the Worker reaches into the htmldocs skill for the
// shared comment contract (ICommentsStore + domain/op types) and the pure op
// semantics (thread-ops). d1-store.ts imports ONLY from here, so the single
// fragile cross-package path lives in exactly one file.
//
// ⚠️ ESCAPING IMPORT — READ BEFORE WIRING D1Store INTO THE WORKER.
// The relative paths below climb ABOVE the app root
// (../../../../plugins/useful-skills/skills/htmldocs/src/comments/...). vendor.sh
// copies ONLY apps/htmldoc-review, so in an operator's vendored copy these paths
// do NOT resolve — the shared sources live above the copy's root and cannot be
// carried by rsyncing the app directory.
//
// PR3 stays green anyway because:
//   • d1-store.ts is UNREACHABLE from src/worker/index.ts — wrangler bundles from
//     the index entry only, so this module never enters the deploy bundle.
//   • deploy.sh runs no tsc against the app; the typecheck that resolves these
//     paths only ever runs in-repo (where plugins/ exists).
//
// HARD PRECONDITION ON PR4: PR4 mounts D1Store into index.ts, which pulls this
// module into wrangler's bundle. Before that happens, the plan's deferred
// "physical-home" phase MUST relocate/vendor these shared comments sources to a
// path INSIDE the app (a non-escaping import). At that point the import lines
// below — or this whole shim — are updated. Mounting D1Store before that would
// break `wrangler deploy` from a vendored copy. See vendor.sh EXCLUDES notes and
// the PR3 handoff.

// --- Store seam ---
export type { ICommentsStore } from "../../../../plugins/useful-skills/skills/htmldocs/src/comments/review-ux/store";

// --- Domain / op / result types (branded ids, Thread, DocKey, Author, ...) ---
export type {
  Thread,
  ThreadId,
  CommentId,
  Comment,
  DocKey,
  Author,
  Anchor,
  Timestamp,
  CreateOp,
  ReplyOp,
  ResolveOp,
  ReopenOp,
  DeleteOp,
  EditOp,
  Op,
  OpResult,
  OpError,
} from "../../../../plugins/useful-skills/skills/htmldocs/src/comments/review-ux/types";

// Branded-id constructors (value exports).
export {
  asThreadId,
  asCommentId,
} from "../../../../plugins/useful-skills/skills/htmldocs/src/comments/review-ux/types";

// --- Pure op semantics — the single source of truth BOTH stores delegate to. ---
export {
  createThread,
  resolveThread,
  reopenThread,
  deleteThread,
  NotFoundError,
  isNotFoundError,
  asTimestamp,
} from "../../../../plugins/useful-skills/skills/htmldocs/src/comments/api/thread-ops";
export type { Mint } from "../../../../plugins/useful-skills/skills/htmldocs/src/comments/api/thread-ops";
