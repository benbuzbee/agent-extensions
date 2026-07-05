// Seam shim — the ONE place the Worker reaches into the shared comment code for
// the store contract (ICommentsStore + domain/op types), the pure op semantics
// (thread-ops), and the runtime-agnostic API surface (envelope parse + handler).
// d1-store.ts and worker/comments.ts import ONLY from here, so the app has a
// single, stable boundary onto the vendored comment tree.
//
// GENERATED SOURCES — the imports below resolve to src/comments/, a VENDORED copy
// of the six DOM-free shared files (review-ux/{types,store}, api/{thread-ops,
// schemas,handlers,index}). That copy is produced by `npm run sync:comments` from
// the editable upstream in the htmldocs skill
// (plugins/useful-skills/skills/htmldocs/src/comments). The skill remains the
// single source of truth: edit UPSTREAM, then re-run the sync — do NOT hand-edit
// src/comments/ (the gate's `git diff --exit-code -- src/comments` catches drift).
//
// Why vendored (not an escaping ../../../../plugins import): the Worker bundles
// from src/worker/index.ts, which pulls this module (via D1Store and the
// comment handler) into wrangler's graph. Every import here must stay INSIDE the
// app root so `wrangler deploy` works from a vendored copy — vendor.sh rsyncs
// only apps/htmldoc-review and cannot carry a source that lives above it.

// --- Store seam ---
export type { ICommentsStore } from "../comments/review-ux/store";

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
} from "../comments/review-ux/types";

// Branded-id constructors (value exports).
export { asThreadId, asCommentId } from "../comments/review-ux/types";

// --- Pure op semantics — the single source of truth BOTH stores delegate to. ---
export {
  createThread,
  resolveThread,
  reopenThread,
  deleteThread,
  NotFoundError,
  isNotFoundError,
  asTimestamp,
} from "../comments/api/thread-ops";
export type { Mint } from "../comments/api/thread-ops";

// --- Runtime-agnostic API surface (envelope validation + op dispatch). The
// Worker's HTTP adapter (worker/comments.ts) drives handleCommentsRequest; the
// rest is re-exported so the seam stays the single import boundary. ---
export {
  parseEnvelope,
  applyOp,
  statusForError,
  handleCommentsRequest,
} from "../comments/api";
export type {
  ParseResult,
  CommentsRequest,
  CommentsResponse,
} from "../comments/api";
