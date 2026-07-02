import { describe, it, expect } from 'vitest';
import { applyOp } from '../../src/comments/api/handlers';
import type { CreateOp } from '../../src/comments/review-ux/types';
import { asThreadId } from '../../src/comments/review-ux/types';
import { MemoryStore, TEST_DOC, TEST_AUTHOR } from './helpers';

describe('applyOp delete', () => {
  it('returns ok delete {threadId} and purges the thread from a subsequent list', async () => {
    const store = new MemoryStore();
    const op: CreateOp = { op: 'create', anchor: { exact: 'x' }, text: 'hi' };
    const c = await applyOp(store, TEST_DOC, op, TEST_AUTHOR);
    if (!c.ok || c.op !== 'create') throw new Error('seed failed');
    const id = c.thread.id;

    const r = await applyOp(store, TEST_DOC, { op: 'delete', threadId: id }, TEST_AUTHOR);
    expect(r.ok).toBe(true);
    if (r.ok && r.op === 'delete') expect(r.threadId).toBe(id);

    const remaining = await store.list(TEST_DOC);
    expect(remaining.find((t) => t.id === id)).toBeUndefined();
  });

  it('unknown threadId → not_found', async () => {
    const store = new MemoryStore();
    const r = await applyOp(store, TEST_DOC, { op: 'delete', threadId: asThreadId('nope') }, TEST_AUTHOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
  });
});
