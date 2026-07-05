// D1Store — the hosted ICommentsStore, backed by one Cloudflare D1 (SQLite)
// table. Lives in worker/ (not core/) because it depends on the Cloudflare
// `D1Database` global — the same boundary that puts kv-store.ts here and keeps
// core/ portable.
//
// It owns ONLY persistence (SELECT/INSERT/UPDATE/DELETE) and the ref sentinel.
// Op semantics — id minting, author/createdAt stamping, resolve/reopen
// idempotency, not_found — are delegated to the shared api/thread-ops so this
// store and the local sidecar store can never drift. Timestamps are epoch-ms
// INTEGERs; the anchor triple is stored as an opaque JSON blob (the DB never
// parses it — anchoring stays client-side).
//
// The Worker mounts the comment API: index.ts -> handleComments ->
// handleCommentsRequest drives this store's list/create/resolve/reopen/delete.
// Its round-trips are also validated directly against a migrated D1 inside
// Miniflare (see d1-store.workers.test.ts).

import {
  createThread,
  resolveThread,
  reopenThread,
  NotFoundError,
  isNotFoundError,
  asTimestamp,
  asThreadId,
  asCommentId,
} from "../core/comments-seam";
import type {
  ICommentsStore,
  Thread,
  ThreadId,
  Comment,
  DocKey,
  Author,
  Anchor,
  CreateOp,
  ReplyOp,
  ResolveOp,
  ReopenOp,
  DeleteOp,
  EditOp,
  Op,
  OpResult,
  OpError,
} from "../core/comments-seam";

// The literal `?ref=` sentinel: a missing/empty ref is stored AND queried as
// this exact string so route and store agree (never '' or NULL).
const REF_DEFAULT = "default";

// Thrown by the reserved (v1-unsupported) reply/edit ops. Matches the message
// the shared api/handlers reserves so a batch surfaces it as a per-op transient.
const RESERVED_MESSAGE = "op not yet supported";

// PR3 has no captured numeric identity (the shared Author type is {login, name}
// only). author_id is NOT NULL, so we stamp a placeholder; PR4/PR5 supply the
// real GitHub numeric id when the Author type gains one.
const AUTHOR_ID_PLACEHOLDER = 0;

// One persisted row. `author_name` and `resolved_at` are the only nullable
// columns; timestamps are epoch-ms integers.
interface CommentRow {
  id: string;
  repo: string;
  ref: string;
  path: string;
  anchor: string;
  body: string;
  author_login: string;
  author_name: string | null;
  author_id: number;
  created_at: number;
  resolved_at: number | null;
}

export class D1Store implements ICommentsStore {
  constructor(private readonly db: D1Database) {}

  // Missing/empty ref -> the literal 'default'. Applied on BOTH write and query.
  private normalizeRef(ref: string): string {
    return ref && ref.length > 0 ? ref : REF_DEFAULT;
  }

  private rowToThread(row: CommentRow): Thread {
    return {
      id: asThreadId(row.id),
      anchor: JSON.parse(row.anchor) as Anchor,
      root: {
        id: asCommentId(row.id),
        author: { login: row.author_login, name: row.author_name },
        body: row.body,
        createdAt: asTimestamp(row.created_at),
      },
      replies: [],
      resolvedAt: row.resolved_at === null ? null : asTimestamp(row.resolved_at),
    };
  }

  // Every mutation is scoped to the doc the URL named (the doc the request's
  // access check authorized), NOT to the threadId alone. The comments table is shared
  // across all docs, so `WHERE id = ?` would let a caller with access to doc A
  // resolve/reopen/purge a thread on any other doc B given its id — and threadIds
  // are not capability secrets (they appear in list responses, seeds, DOM, shared
  // links). Adding the (repo, ref, path) predicate makes a foreign-doc id behave
  // exactly like a missing id: zero rows -> not_found, no existence leak, and the
  // same semantics LocalFileStore has (its backing collection IS one doc).
  private getRow(doc: DocKey, id: ThreadId): Promise<CommentRow | null> {
    return this.db
      .prepare(
        "SELECT * FROM comments WHERE id = ? AND repo = ? AND ref = ? AND path = ?",
      )
      .bind(id, doc.repo, this.normalizeRef(doc.ref), doc.path)
      .first<CommentRow>();
  }

  // Q1 — the hot path: list a doc's threads in created order.
  async list(doc: DocKey): Promise<Thread[]> {
    const ref = this.normalizeRef(doc.ref);
    const { results } = await this.db
      .prepare(
        "SELECT * FROM comments WHERE repo = ? AND ref = ? AND path = ? ORDER BY created_at",
      )
      .bind(doc.repo, ref, doc.path)
      .all<CommentRow>();
    return results.map((r) => this.rowToThread(r));
  }

  // Q3 — INSERT. Delegate id/author/createdAt stamping to thread-ops so the two
  // stores can't drift, then persist. author_name null -> SQL NULL.
  async create(doc: DocKey, op: CreateOp, author: Author): Promise<Thread> {
    const { thread } = createThread(
      [],
      op,
      author,
      () => crypto.randomUUID(),
      asTimestamp(Date.now()),
    );
    const ref = this.normalizeRef(doc.ref);
    await this.db
      .prepare(
        "INSERT INTO comments" +
          " (id, repo, ref, path, anchor, body, author_login, author_name, author_id, created_at, resolved_at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        thread.id,
        doc.repo,
        ref,
        doc.path,
        JSON.stringify(thread.anchor),
        thread.root.body,
        author.login,
        author.name,
        AUTHOR_ID_PLACEHOLDER,
        thread.root.createdAt,
        thread.resolvedAt,
      )
      .run();
    return thread;
  }

  // Q2 — soft-close. SELECT the target (zero rows -> not_found), let thread-ops
  // decide the transition (idempotent when already resolved), UPDATE only on a
  // real change so the original resolved_at is never overwritten.
  async resolve(doc: DocKey, op: ResolveOp, _author: Author): Promise<Thread> {
    const row = await this.getRow(doc, op.threadId);
    if (!row) throw new NotFoundError(op.threadId);
    const current = this.rowToThread(row);
    const { thread } = resolveThread([current], op, asTimestamp(Date.now()));
    if (thread.resolvedAt !== current.resolvedAt) {
      await this.db
        .prepare("UPDATE comments SET resolved_at = ? WHERE id = ?")
        .bind(thread.resolvedAt, op.threadId)
        .run();
    }
    return thread;
  }

  // Inverse of resolve — clear resolved_at back to NULL. Idempotent on an
  // already-open thread; a missing id is not_found.
  async reopen(doc: DocKey, op: ReopenOp, _author: Author): Promise<Thread> {
    const row = await this.getRow(doc, op.threadId);
    if (!row) throw new NotFoundError(op.threadId);
    const current = this.rowToThread(row);
    const { thread } = reopenThread([current], op);
    if (thread.resolvedAt !== current.resolvedAt) {
      await this.db
        .prepare("UPDATE comments SET resolved_at = ? WHERE id = ?")
        .bind(thread.resolvedAt, op.threadId)
        .run();
    }
    return thread;
  }

  // Q4 — hard purge. A single DELETE scoped to the doc (see getRow); zero rows
  // changed means the id named no thread IN THIS DOC -> not_found.
  async delete(doc: DocKey, op: DeleteOp, _author: Author): Promise<ThreadId> {
    const res = await this.db
      .prepare(
        "DELETE FROM comments WHERE id = ? AND repo = ? AND ref = ? AND path = ?",
      )
      .bind(op.threadId, doc.repo, this.normalizeRef(doc.ref), doc.path)
      .run();
    if (res.meta.changes === 0) throw new NotFoundError(op.threadId);
    return op.threadId;
  }

  // Reserved in v1 — envelope-parsed, then rejected. Throws a plain Error whose
  // message batch() maps to a per-op transient result.
  async reply(_doc: DocKey, _op: ReplyOp, _author: Author): Promise<Comment> {
    throw new Error(RESERVED_MESSAGE);
  }

  async edit(_doc: DocKey, _op: EditOp, _author: Author): Promise<Comment> {
    throw new Error(RESERVED_MESSAGE);
  }

  // Best-effort per-op: loop the single-op methods, build OpResult[] in request
  // order, and catch EVERY throw with the same mapping LocalFileStore.batch /
  // handlers.errorToOpError use — not_found for a NotFoundError, transient for
  // anything else (including the reserved reply/edit Error, whose message is
  // RESERVED_MESSAGE). There is no 'unsupported' OpError code, so a reserved op
  // inside a batch is a per-op transient, never a whole-batch reject.
  async batch(doc: DocKey, ops: Op[], author: Author): Promise<OpResult[]> {
    const results: OpResult[] = [];
    for (const op of ops) {
      try {
        switch (op.op) {
          case "create":
            results.push({ ok: true, op: "create", thread: await this.create(doc, op, author) });
            break;
          case "resolve":
            results.push({ ok: true, op: "resolve", thread: await this.resolve(doc, op, author) });
            break;
          case "reopen":
            results.push({ ok: true, op: "reopen", thread: await this.reopen(doc, op, author) });
            break;
          case "delete":
            results.push({ ok: true, op: "delete", threadId: await this.delete(doc, op, author) });
            break;
          case "reply":
            await this.reply(doc, op, author); // throws — falls to catch
            break;
          case "edit":
            await this.edit(doc, op, author); // throws — falls to catch
            break;
        }
      } catch (err) {
        results.push({ ok: false, op: op.op, error: toOpError(err) });
      }
    }
    return results;
  }
}

// Map a thrown value to an OpError arm, matching handlers.errorToOpError: a
// NotFoundError -> not_found (carrying threadId); anything else -> transient
// (carrying the message). D1Store throws NotFoundError directly, so there is no
// `.opError`-tagged form to unwrap here.
function toOpError(err: unknown): OpError {
  if (isNotFoundError(err)) return { code: "not_found", threadId: err.threadId };
  const message = err instanceof Error ? err.message : String(err);
  return { code: "transient", message };
}
