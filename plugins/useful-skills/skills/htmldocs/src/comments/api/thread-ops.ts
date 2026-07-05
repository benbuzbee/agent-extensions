// Pure, immutable, zod-free thread mutations — the single source of truth for
// op semantics (create/resolve/reopen/delete, idempotency, purge). BOTH stores
// delegate here so the local sidecar store and the hosted D1 store can never
// drift. Every function takes the current Thread[] and returns a NEW array
// plus the result value; nothing is mutated in place, so a caller gets rollback
// for free by simply not assigning the returned array on a persist failure.

import type {
  Thread, ThreadId, Author, Anchor,
  CreateOp, ResolveOp, ReopenOp, DeleteOp, Timestamp,
} from '../review-ux/types';
import { asThreadId, asCommentId, asTimestamp } from '../review-ux/types';

/** Thrown when a threadId names no thread on the doc. Stores map this to a
 *  not_found OpError. Tagged so a catch can distinguish it from a bug. */
export class NotFoundError extends Error {
  readonly notFound = true as const;
  constructor(public readonly threadId: ThreadId) {
    super('thread not found');
    this.name = 'NotFoundError';
  }
}

export function isNotFoundError(err: unknown): err is NotFoundError {
  return !!err && typeof err === 'object' && (err as { notFound?: unknown }).notFound === true;
}

/** Produces a fresh unique id. Callers inject this so tests can seed
 *  deterministic ids; the runtimes pass crypto.randomUUID. */
export type IdFactory = () => string;

/**
 * Create a new thread (server mints id, stamps author + createdAt). Returns the
 * new array with the thread appended and the created Thread.
 */
export function createThread(
  threads: Thread[],
  op: CreateOp,
  author: Author,
  newId: IdFactory,
  now: Timestamp,
): { threads: Thread[]; thread: Thread } {
  const id = asThreadId(newId());
  const thread: Thread = {
    id,
    anchor: op.anchor as Anchor,
    root: {
      id: asCommentId(id as string),
      author,
      body: op.text,
      createdAt: now,
    },
    replies: [],
    resolvedAt: null,
  };
  return { threads: [...threads, thread], thread };
}

/**
 * Soft-close a thread. Idempotent: if already resolved, the existing
 * resolvedAt is returned unchanged (no second timestamp overwrite).
 */
export function resolveThread(
  threads: Thread[],
  op: ResolveOp,
  now: Timestamp,
): { threads: Thread[]; thread: Thread } {
  const idx = threads.findIndex((t) => t.id === op.threadId);
  if (idx === -1) throw new NotFoundError(op.threadId);
  const current = threads[idx]!;
  // Idempotent — keep the original resolvedAt if already resolved.
  const next: Thread = current.resolvedAt === null
    ? { ...current, resolvedAt: now }
    : current;
  if (next === current) return { threads, thread: current };
  const out = threads.slice();
  out[idx] = next;
  return { threads: out, thread: next };
}

/**
 * Re-open a thread — clears resolvedAt back to null. Idempotent on an
 * already-open thread.
 */
export function reopenThread(
  threads: Thread[],
  op: ReopenOp,
): { threads: Thread[]; thread: Thread } {
  const idx = threads.findIndex((t) => t.id === op.threadId);
  if (idx === -1) throw new NotFoundError(op.threadId);
  const current = threads[idx]!;
  if (current.resolvedAt === null) return { threads, thread: current };
  const next: Thread = { ...current, resolvedAt: null };
  const out = threads.slice();
  out[idx] = next;
  return { threads: out, thread: next };
}

/**
 * Hard purge a thread by id. Returns the new array (thread removed) and the
 * purged threadId.
 */
export function deleteThread(
  threads: Thread[],
  op: DeleteOp,
): { threads: Thread[]; threadId: ThreadId } {
  const idx = threads.findIndex((t) => t.id === op.threadId);
  if (idx === -1) throw new NotFoundError(op.threadId);
  const out = threads.slice();
  out.splice(idx, 1);
  return { threads: out, threadId: op.threadId };
}

// Re-export for stores that need to stamp their own timestamps.
export { asTimestamp };
