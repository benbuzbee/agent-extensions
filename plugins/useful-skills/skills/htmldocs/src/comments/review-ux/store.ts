// ICommentsStore interface + MountDeps — the seam between shared UX and adapters.

import type {
  Thread, ThreadId, Comment, DocKey, Author,
  CreateOp, ReplyOp, ResolveOp, ReopenOp, DeleteOp, EditOp, Op, OpResult,
} from './types';

/**
 * Granular comment store interface. Each write method maps 1:1 to the op
 * envelope. `batch` loops the single-op methods — best-effort per-op, results
 * in request order.
 */
export interface ICommentsStore {
  list(doc: DocKey): Promise<Thread[]>;
  create(doc: DocKey, op: CreateOp, author: Author): Promise<Thread>;
  reply(doc: DocKey, op: ReplyOp, author: Author): Promise<Comment>;
  resolve(doc: DocKey, op: ResolveOp, author: Author): Promise<Thread>;
  reopen(doc: DocKey, op: ReopenOp, author: Author): Promise<Thread>;
  delete(doc: DocKey, op: DeleteOp, author: Author): Promise<ThreadId>;
  edit(doc: DocKey, op: EditOp, author: Author): Promise<Comment>;
  batch(doc: DocKey, ops: Op[], author: Author): Promise<OpResult[]>;
}

/**
 * The seam mount.ts receives — store + author. Each runtime's deps.ts builds
 * this: BOTH build the shared HttpCommentsStore (browser HTTP client over the
 * ?comments API) and differ only in author — local supplies a fixed "user",
 * hosted supplies the real GitHub identity. Server-side, the local route is
 * backed by SidecarStore and the hosted route by D1Store.
 */
export interface MountDeps {
  store: ICommentsStore;
  author: Author;
}
