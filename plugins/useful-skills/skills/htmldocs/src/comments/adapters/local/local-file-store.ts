// LocalFileStore — ICommentsStore implementation over the local server's
// JSON sidecar (read-modify-write via HTTP PUT).
//
// Internally the widget works with Thread[] (the internal model). For
// persistence, LocalFileStore SERIALIZES back to the legacy CommentsModel
// wire shape (author: string, created_at: ISO string) when PUTting to the
// sidecar endpoint, and DESERIALIZES from that shape when reading the
// inline seed.

import type { ICommentsStore } from '../../review-ux/store';
import type {
  Thread, ThreadId, Comment, DocKey, Author,
  CreateOp, ReplyOp, ResolveOp, ReopenOp, DeleteOp, EditOp, Op, OpResult,
  CommentsModel, OpError,
} from '../../review-ux/types';
import {
  asTimestamp, threadToLegacy, legacyToThread,
} from '../../review-ux/types';
import {
  createThread, resolveThread, reopenThread, deleteThread, isNotFoundError,
} from '../../api/thread-ops';

const SCHEMA_VERSION = 1 as const;
const SIDECAR_URL_PREFIX = '/__htmldocs/sidecar';
const SEED_ELEMENT_ID = '__htmldocs_comments';

// Build the PUT URL for the page hosting the widget.
function sidecarUrlForCurrentDoc(): string {
  let pathname = location.pathname;
  if (pathname.endsWith('/')) {
    const trimmed = pathname.slice(0, -1);
    const lastSeg = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    pathname = /\.html?$/i.test(lastSeg) ? trimmed : pathname + 'index.html';
  }
  return SIDECAR_URL_PREFIX + pathname;
}

function currentBasename(): string {
  return location.pathname.split('/').pop() || 'index.html';
}

// Shape check matching serve.ts's isWellShapedModel.
function isWellShapedComment(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  if (typeof x.id !== 'string' || typeof x.body !== 'string') return false;
  if (typeof x.author !== 'string' || typeof x.created_at !== 'string') return false;
  if (!x.anchor || typeof x.anchor !== 'object') return false;
  const a = x.anchor as Record<string, unknown>;
  if (!Array.isArray(a.sections) || !a.sections.every((s: unknown) => typeof s === 'string')) return false;
  return typeof a.prefix === 'string'
    && typeof a.exact === 'string' && typeof a.suffix === 'string';
}

function isWellShaped(parsed: unknown): parsed is CommentsModel {
  if (!parsed || typeof parsed !== 'object') return false;
  const m = parsed as Partial<CommentsModel>;
  if (typeof m.doc !== 'string' || m.schema !== 1 || !Array.isArray(m.comments)) return false;
  return m.comments.every(isWellShapedComment);
}

export class LocalFileStore implements ICommentsStore {
  private threads: Thread[] = [];

  constructor() {
    // Load from inline seed on construction
    this.loadFromSeed();
  }

  private loadFromSeed(): void {
    const node = document.getElementById(SEED_ELEMENT_ID);
    if (!node) { this.threads = []; return; }
    const text = node.textContent || '';
    if (!text.trim()) { this.threads = []; return; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { this.threads = []; return; }
    if (!isWellShaped(parsed)) { this.threads = []; return; }
    this.threads = parsed.comments.map(legacyToThread);
  }

  async list(_doc: DocKey): Promise<Thread[]> {
    return this.threads.slice();
  }

  // Each mutation delegates op semantics to the shared api/thread-ops.* (the
  // single source of truth for create/resolve/reopen/delete + idempotency),
  // then persists the NEW array. Rollback is free: this.threads is only
  // reassigned AFTER a successful PUT, so a failed persist leaves state
  // untouched.
  private async applyAndPersist<T>(
    apply: (threads: Thread[]) => { threads: Thread[]; value: T },
  ): Promise<T> {
    let next: Thread[];
    let value: T;
    try {
      const out = apply(this.threads);
      next = out.threads;
      value = out.value;
    } catch (err) {
      // Map a thread-ops NotFoundError to the tagged not_found OpError the
      // batch loop / caller expects.
      if (isNotFoundError(err)) {
        throw Object.assign(new Error('thread not found'), { opError: { code: 'not_found' as const, threadId: err.threadId } });
      }
      throw err;
    }
    const prev = this.threads;
    this.threads = next;
    try {
      await this.persist();
    } catch (err) {
      this.threads = prev;
      throw err;
    }
    return value;
  }

  async create(_doc: DocKey, op: CreateOp, author: Author): Promise<Thread> {
    return this.applyAndPersist((threads) => {
      const { threads: next, thread } = createThread(
        threads, op, author, () => crypto.randomUUID(), asTimestamp(Date.now()),
      );
      return { threads: next, value: thread };
    });
  }

  async reply(_doc: DocKey, _op: ReplyOp, _author: Author): Promise<Comment> {
    throw new Error('op not yet supported');
  }

  async resolve(_doc: DocKey, op: ResolveOp, _author: Author): Promise<Thread> {
    return this.applyAndPersist((threads) => {
      const { threads: next, thread } = resolveThread(threads, op, asTimestamp(Date.now()));
      return { threads: next, value: thread };
    });
  }

  async reopen(_doc: DocKey, op: ReopenOp, _author: Author): Promise<Thread> {
    return this.applyAndPersist((threads) => {
      const { threads: next, thread } = reopenThread(threads, op);
      return { threads: next, value: thread };
    });
  }

  async delete(_doc: DocKey, op: DeleteOp, _author: Author): Promise<ThreadId> {
    return this.applyAndPersist((threads) => {
      const { threads: next, threadId } = deleteThread(threads, op);
      return { threads: next, value: threadId };
    });
  }

  async edit(_doc: DocKey, _op: EditOp, _author: Author): Promise<Comment> {
    throw new Error('op not yet supported');
  }

  async batch(doc: DocKey, ops: Op[], author: Author): Promise<OpResult[]> {
    const results: OpResult[] = [];
    for (const op of ops) {
      try {
        switch (op.op) {
          case 'create': {
            const thread = await this.create(doc, op, author);
            results.push({ ok: true, op: 'create', thread });
            break;
          }
          case 'resolve': {
            const thread = await this.resolve(doc, op, author);
            results.push({ ok: true, op: 'resolve', thread });
            break;
          }
          case 'reopen': {
            const thread = await this.reopen(doc, op, author);
            results.push({ ok: true, op: 'reopen', thread });
            break;
          }
          case 'delete': {
            const threadId = await this.delete(doc, op, author);
            results.push({ ok: true, op: 'delete', threadId });
            break;
          }
          case 'reply': {
            await this.reply(doc, op, author);
            // Won't reach here — reply throws
            break;
          }
          case 'edit': {
            await this.edit(doc, op, author);
            // Won't reach here — edit throws
            break;
          }
        }
      } catch (err: unknown) {
        const opError = (err as { opError?: OpError }).opError;
        if (opError) {
          results.push({ ok: false, op: op.op, error: opError });
        } else {
          // Reserved ops (reply/edit) throw plain Error
          results.push({ ok: false, op: op.op, error: { code: 'transient', message: 'op not yet supported' } });
        }
      }
    }
    return results;
  }

  private async persist(): Promise<void> {
    // Serialize threads to legacy CommentsModel wire shape
    const comments = this.threads.flatMap(threadToLegacy);
    const model: CommentsModel = {
      doc: currentBasename(),
      schema: SCHEMA_VERSION,
      comments,
    };
    const url = sidecarUrlForCurrentDoc();
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(model, null, 2) + '\n',
    });
    if (!res.ok) {
      throw new Error(`LocalFileStore: PUT ${url} → ${res.status}`);
    }
  }

  /** `foo.html` -> `foo.comments.json`. Static helper for sidecar path derivation. */
  static filename(basename: string): string {
    return basename.replace(/\.html?$/i, '') + '.comments.json';
  }
}
