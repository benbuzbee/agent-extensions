import { describe, it, expect } from 'vitest';
import { applyOp } from '../../src/comments/api/handlers';
import type { CreateOp, ThreadId } from '../../src/comments/review-ux/types';
import { asThreadId } from '../../src/comments/review-ux/types';
import { MemoryStore, TEST_DOC, TEST_AUTHOR } from './helpers';

async function seedResolved(store: MemoryStore): Promise<ThreadId> {
  const op: CreateOp = { op: 'create', anchor: { exact: 'x' }, text: 'hi' };
  const c = await applyOp(store, TEST_DOC, op, TEST_AUTHOR);
  if (!c.ok || c.op !== 'create') throw new Error('seed failed');
  await applyOp(store, TEST_DOC, { op: 'resolve', threadId: c.thread.id }, TEST_AUTHOR);
  return c.thread.id;
}

describe('applyOp reopen', () => {
  it('clears resolvedAt to null', async () => {
    const store = new MemoryStore();
    const id = await seedResolved(store);
    const r = await applyOp(store, TEST_DOC, { op: 'reopen', threadId: id }, TEST_AUTHOR);
    expect(r.ok).toBe(true);
    if (r.ok && r.op === 'reopen') expect(r.thread.resolvedAt).toBeNull();
  });

  it('unknown threadId → not_found', async () => {
    const store = new MemoryStore();
    const r = await applyOp(store, TEST_DOC, { op: 'reopen', threadId: asThreadId('nope') }, TEST_AUTHOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
  });
});
