// Full type layer for the comments widget. Cross-cuts all modules:
// review-ux/ (shared UX), adapters/ (store impls), and test specs.
//
// Branded ids extend the SessionId brand pattern from apps/htmldoc-review/src/core/store.ts.
// Timestamps are numeric epoch-milliseconds end to end.

// --- Branded primitives ---

export type ThreadId = string & { readonly __brand: "ThreadId" };
export type CommentId = string & { readonly __brand: "CommentId" };
export type Timestamp = number & { readonly __brand: "Timestamp" };

export const asThreadId = (raw: string): ThreadId => raw as ThreadId;
export const asCommentId = (raw: string): CommentId => raw as CommentId;
export const asTimestamp = (ms: number): Timestamp => ms as Timestamp;

// --- Core domain types ---

/**
 * Pins a comment to a span of prose via a W3C TextQuoteSelector triple.
 * `exact` is required; `prefix`/`suffix` are optional disambiguators;
 * `sections` is pure metadata (empty when no article was touched).
 */
export interface Anchor {
  exact: string;
  prefix?: string;
  suffix?: string;
  sections?: string[];
}

/**
 * Reviewer identity, stamped server-side from the session. `id` is the OPTIONAL
 * stable GitHub numeric id — supplied only on the hosted Worker path (from the
 * captured session identity); the local path (adapter/LocalFileStore/playwright)
 * never sets or reads it, so the local JSON carries no id.
 */
export type Author = { login: string; name: string | null; id?: number };

/**
 * Parse-don't-cast constructor for an Author arriving as DATA (the injected
 * DOM seed) rather than from code. Unlike the `as*` brand casts above — which
 * assert a value already known to be right — this validates the full shape and
 * builds a fresh Author, so a partial object can never leak an `undefined`
 * name (or a non-numeric id) past the type. Absent `name` normalizes to null;
 * any other shape violation rejects the whole value.
 */
export function parseAuthor(raw: unknown): Author | null {
  if (raw === null || typeof raw !== "object") return null;
  const a = raw as { login?: unknown; name?: unknown; id?: unknown };
  if (typeof a.login !== "string" || a.login.length === 0) return null;
  if (a.name !== undefined && a.name !== null && typeof a.name !== "string") return null;
  if (a.id !== undefined && typeof a.id !== "number") return null;
  return {
    login: a.login,
    name: a.name ?? null,
    ...(a.id !== undefined ? { id: a.id } : {}),
  };
}

/** One comment within a thread. */
export interface Comment {
  id: CommentId;
  author: Author;
  body: string;
  createdAt: Timestamp;
  editedAt?: Timestamp;
}

/** A thread: anchored root comment + flat replies + resolve state. */
export interface Thread {
  id: ThreadId;
  anchor: Anchor;
  root: Comment;
  replies: Comment[];
  resolvedAt: Timestamp | null;
}

/** Opaque document key the store uses to scope comments. */
export interface DocKey {
  repo: string;
  ref: string;
  path: string;
}

// --- Op envelope types ---

export interface CreateOp {
  op: "create";
  anchor: Anchor;
  text: string;
  clientOpId?: string;
}

export interface ResolveOp {
  op: "resolve";
  threadId: ThreadId;
}

export interface ReopenOp {
  op: "reopen";
  threadId: ThreadId;
}

export interface DeleteOp {
  op: "delete";
  threadId: ThreadId;
}

/** Reserved — envelope-parsed, rejected with 400 in v1. */
export interface ReplyOp {
  op: "reply";
  threadId: ThreadId;
  text: string;
  clientOpId?: string;
}

/** Reserved — envelope-parsed, rejected with 400 in v1. */
export interface EditOp {
  op: "edit";
  commentId: CommentId;
  patch: { body: string };
}

export type Op = CreateOp | ResolveOp | ReopenOp | DeleteOp | ReplyOp | EditOp;

// --- OpResult discriminated union ---

export type OpError = { code: "no_access" | "transient" | "not_found"; message?: string; threadId?: ThreadId };

export type OpResult =
  | { ok: true; op: "create"; thread: Thread }
  | { ok: true; op: "reply"; comment: Comment }
  | { ok: true; op: "edit"; comment: Comment }
  | { ok: true; op: "resolve" | "reopen"; thread: Thread }
  | { ok: true; op: "delete"; threadId: ThreadId }
  | { ok: false; op: Op["op"]; error: OpError };

// --- Legacy sidecar wire format (backward-compatible) ---

/**
 * One comment in the legacy sidecar JSON shape. This is the wire format
 * `isWellShapedModel` in serve.ts validates; it is NOT the internal
 * Thread/Comment shape.
 */
export interface LegacyComment {
  id: string;
  anchor: { sections: string[]; prefix: string; exact: string; suffix: string };
  body: string;
  author: string;
  created_at: string;
  /**
   * Optional soft-close timestamp (ISO string, mirroring `created_at`).
   * Absent/omitted == open. Added backward-compatibly: serve.ts's
   * `isWellShapedModel` tolerates extra fields, and older sidecars simply
   * lack it (they load as open), so Deliverable 1 sidecars still validate.
   */
  resolved_at?: string;
}

/**
 * Top-level shape of the JSON sidecar and the inline seed. One definition
 * serves the widget, the server, and the agent — single source of truth.
 */
export interface CommentsModel {
  doc: string;
  schema: 1;
  comments: LegacyComment[];
}

// --- Conversion helpers (bridge legacy <-> internal) ---

/**
 * Flatten a Thread back to the legacy wire array of LegacyComment objects.
 * Each thread becomes one root entry (replies are appended after root).
 */
export function threadToLegacy(thread: Thread): LegacyComment[] {
  const out: LegacyComment[] = [];
  const toLegacy = (c: Comment, anchor: Anchor): LegacyComment => {
    const legacy: LegacyComment = {
      id: c.id,
      anchor: {
        sections: anchor.sections ?? [],
        prefix: anchor.prefix ?? '',
        exact: anchor.exact,
        suffix: anchor.suffix ?? '',
      },
      body: c.body,
      author: c.author.login,
      created_at: new Date(c.createdAt).toISOString(),
    };
    // Carry resolve state on the wire so a soft-close survives persist/reload.
    if (thread.resolvedAt !== null) {
      legacy.resolved_at = new Date(thread.resolvedAt).toISOString();
    }
    return legacy;
  };
  out.push(toLegacy(thread.root, thread.anchor));
  for (const reply of thread.replies) {
    out.push(toLegacy(reply, thread.anchor));
  }
  return out;
}

/**
 * Convert a single legacy comment (treated as a thread root with no replies)
 * into the internal Thread shape. For v1 single-comment threads: replies=[]
 * and resolvedAt=null; ThreadId === the legacy comment's id.
 */
export function legacyToThread(comment: LegacyComment): Thread {
  return {
    id: asThreadId(comment.id),
    anchor: {
      exact: comment.anchor.exact,
      prefix: comment.anchor.prefix || undefined,
      suffix: comment.anchor.suffix || undefined,
      sections: comment.anchor.sections.length > 0 ? comment.anchor.sections : undefined,
    },
    root: {
      id: asCommentId(comment.id),
      author: { login: comment.author, name: null },
      body: comment.body,
      createdAt: asTimestamp(new Date(comment.created_at).getTime()),
    },
    replies: [],
    resolvedAt: comment.resolved_at
      ? asTimestamp(new Date(comment.resolved_at).getTime())
      : null,
  };
}

// NOTE: `AnchorAPI` (the Range<->Anchor encode/decode surface) lives in
// review-ux/anchor.ts, NOT here — its `Range` references are DOM globals, and
// keeping types.ts DOM-free lets non-DOM importers (the hosted Worker's
// D1Store seam) pull these domain types under an es2022-only lib.

// NOTE: the TestHandle interface and its `Window` global live in the entry
// point (main.ts), NOT here. TestHandle names the concrete LocalFileStore
// (a transport adapter), and this shared layer must never reference an
// adapter — see review-ux/CLAUDE.md.
