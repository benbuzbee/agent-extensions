// Test helpers: an in-memory ICommentsStore backed by api/thread-ops (mirrors
// SidecarStore's semantics without fs), and a spy store that records calls.
import type { ICommentsStore } from '../../src/comments/review-ux/store';
import type {
  Thread, ThreadId, Comment, DocKey, Author,
  CreateOp, ReplyOp, ResolveOp, ReopenOp, DeleteOp, EditOp, Op, OpResult, OpError,
} from '../../src/comments/review-ux/types';
import { asTimestamp } from '../../src/comments/review-ux/types';
import {
  createThread, resolveThread, reopenThread, deleteThread, isNotFoundError,
} from '../../src/comments/api/thread-ops';
import { applyOp } from '../../src/comments/api/handlers';

export const TEST_DOC: DocKey = { repo: '', ref: 'default', path: '/doc.html' };
export const TEST_AUTHOR: Author = { login: 'user', name: null };

function tagNotFound(err: unknown): never {
  if (isNotFoundError(err)) {
    throw Object.assign(new Error('thread not found'), { opError: { code: 'not_found', threadId: err.threadId } as OpError });
  }
  throw err;
}

/** In-memory store sharing thread-ops semantics. A monotonic mint so ids are
 *  deterministic within a test. */
export class MemoryStore implements ICommentsStore {
  private threads: Thread[] = [];
  private seq = 0;
  private mint = () => `t-${++this.seq}`;

  async list(_doc: DocKey): Promise<Thread[]> {
    return this.threads.slice();
  }
  async create(_doc: DocKey, op: CreateOp, author: Author): Promise<Thread> {
    const { threads, thread } = createThread(this.threads, op, author, this.mint, asTimestamp(Date.now()));
    this.threads = threads;
    return thread;
  }
  async reply(_doc: DocKey, _op: ReplyOp, _author: Author): Promise<Comment> {
    throw new Error('op not yet supported');
  }
  async resolve(_doc: DocKey, op: ResolveOp, _author: Author): Promise<Thread> {
    try {
      const { threads, thread } = resolveThread(this.threads, op, asTimestamp(Date.now()));
      this.threads = threads;
      return thread;
    } catch (err) { tagNotFound(err); }
  }
  async reopen(_doc: DocKey, op: ReopenOp, _author: Author): Promise<Thread> {
    try {
      const { threads, thread } = reopenThread(this.threads, op);
      this.threads = threads;
      return thread;
    } catch (err) { tagNotFound(err); }
  }
  async delete(_doc: DocKey, op: DeleteOp, _author: Author): Promise<ThreadId> {
    try {
      const { threads, threadId } = deleteThread(this.threads, op);
      this.threads = threads;
      return threadId;
    } catch (err) { tagNotFound(err); }
  }
  async edit(_doc: DocKey, _op: EditOp, _author: Author): Promise<Comment> {
    throw new Error('op not yet supported');
  }
  async batch(doc: DocKey, ops: Op[], author: Author): Promise<OpResult[]> {
    const out: OpResult[] = [];
    for (const op of ops) out.push(await applyOp(this, doc, op, author));
    return out;
  }
}

/** Records every method call — used to assert the before-any-store-call
 *  contract on a malformed envelope. */
export class SpyStore implements ICommentsStore {
  calls: string[] = [];
  async list(_doc: DocKey): Promise<Thread[]> { this.calls.push('list'); return []; }
  async create(_doc: DocKey, _op: CreateOp, _author: Author): Promise<Thread> { this.calls.push('create'); throw new Error('unexpected'); }
  async reply(_doc: DocKey, _op: ReplyOp, _author: Author): Promise<Comment> { this.calls.push('reply'); throw new Error('unexpected'); }
  async resolve(_doc: DocKey, _op: ResolveOp, _author: Author): Promise<Thread> { this.calls.push('resolve'); throw new Error('unexpected'); }
  async reopen(_doc: DocKey, _op: ReopenOp, _author: Author): Promise<Thread> { this.calls.push('reopen'); throw new Error('unexpected'); }
  async delete(_doc: DocKey, _op: DeleteOp, _author: Author): Promise<ThreadId> { this.calls.push('delete'); throw new Error('unexpected'); }
  async edit(_doc: DocKey, _op: EditOp, _author: Author): Promise<Comment> { this.calls.push('edit'); throw new Error('unexpected'); }
  async batch(_doc: DocKey, _ops: Op[], _author: Author): Promise<OpResult[]> { this.calls.push('batch'); return []; }
}
