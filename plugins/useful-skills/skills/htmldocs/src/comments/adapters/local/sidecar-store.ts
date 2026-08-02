// SidecarStore — a Node fs-backed ICommentsStore for the LOCAL server route.
//
// The one place the legacy conversion runs at runtime: it loads/saves the legacy
// `*.comments.json` disk shape (via ./legacy-format) but exposes the internal
// Thread[] the shared API works in, so on-disk files stay byte-unchanged while
// the wire is the op-envelope ?comments API. Each verb does a read-modify-write
// against a persistence port, delegating the actual op semantics to
// api/thread-ops.* so it shares one source of truth with the browser client.
//
// Because every op is an independent load→apply→save, a batch (a loop of single
// ops in the handler) is naturally best-effort with no rollback needed: a
// failing op simply doesn't save. There is no long-lived in-memory state and no
// cross-request locking — fine for single-user localhost review.

import { randomUUID } from 'node:crypto';
import type { ICommentsStore } from '../../review-ux/store';
import type {
  Thread, ThreadId, Comment, DocKey, Author,
  CreateOp, ReplyOp, ResolveOp, ReopenOp, DeleteOp, EditOp, Op, OpResult, OpError,
} from '../../review-ux/types';
import { asTimestamp } from '../../review-ux/types';
import type { CommentsModel } from './legacy-format';
import { threadToLegacy, legacyToThread } from './legacy-format';
import {
  createThread, resolveThread, reopenThread, deleteThread, isNotFoundError,
  NotImplementedError,
} from '../../api/thread-ops';
import { applyOp } from '../../api/handlers';

/**
 * The seam SidecarStore persists through — one bound sidecar file. The local
 * server wires this to its existing readSidecar/writeSidecarAtomic helpers.
 * Keyed by the bound file, so the DocKey tuple is ignored (one sidecar per
 * page).
 */
export interface SidecarPersistence {
  load(): Promise<CommentsModel>;
  save(model: CommentsModel): Promise<void>;
}

/** Wrap a not_found from thread-ops as the tagged error the handler maps. */
function tagNotFound(err: unknown): never {
  if (isNotFoundError(err)) {
    throw Object.assign(new Error(err.message), { opError: { code: 'not_found', threadId: err.threadId, message: err.message } as OpError });
  }
  throw err;
}

export class SidecarStore implements ICommentsStore {
  constructor(
    private readonly persistence: SidecarPersistence,
    private readonly docLabel: string,
    private readonly mint: () => string = randomUUID,
  ) {}

  private async loadThreads(): Promise<Thread[]> {
    const model = await this.persistence.load();
    return model.comments.map(legacyToThread);
  }

  private async saveThreads(threads: Thread[]): Promise<void> {
    const model: CommentsModel = {
      doc: this.docLabel,
      schema: 1,
      comments: threads.flatMap(threadToLegacy),
    };
    await this.persistence.save(model);
  }

  async list(_doc: DocKey): Promise<Thread[]> {
    return this.loadThreads();
  }

  async create(_doc: DocKey, op: CreateOp, author: Author): Promise<Thread> {
    const threads = await this.loadThreads();
    const { threads: next, thread } = createThread(
      threads, op, author, this.mint, asTimestamp(Date.now()),
    );
    await this.saveThreads(next);
    return thread;
  }

  async reply(_doc: DocKey, _op: ReplyOp, _author: Author): Promise<Comment> {
    throw new NotImplementedError();
  }

  async resolve(_doc: DocKey, op: ResolveOp, _author: Author): Promise<Thread> {
    const threads = await this.loadThreads();
    let result;
    try {
      result = resolveThread(threads, op, asTimestamp(Date.now()));
    } catch (err) { tagNotFound(err); }
    await this.saveThreads(result.threads);
    return result.thread;
  }

  async reopen(_doc: DocKey, op: ReopenOp, _author: Author): Promise<Thread> {
    const threads = await this.loadThreads();
    let result;
    try {
      result = reopenThread(threads, op);
    } catch (err) { tagNotFound(err); }
    await this.saveThreads(result.threads);
    return result.thread;
  }

  async delete(_doc: DocKey, op: DeleteOp, _author: Author): Promise<ThreadId> {
    const threads = await this.loadThreads();
    let result;
    try {
      result = deleteThread(threads, op);
    } catch (err) { tagNotFound(err); }
    await this.saveThreads(result.threads);
    return result.threadId;
  }

  async edit(_doc: DocKey, _op: EditOp, _author: Author): Promise<Comment> {
    throw new NotImplementedError();
  }

  async batch(doc: DocKey, ops: Op[], author: Author): Promise<OpResult[]> {
    // Best-effort loop over the single-op dispatch — one place owns the
    // OpResult-arm mapping and reserved-op handling.
    const results: OpResult[] = [];
    for (const op of ops) {
      results.push(await applyOp(this, doc, op, author));
    }
    return results;
  }
}
