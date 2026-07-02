import { describe, it, expect } from 'vitest';
import { applyOp } from '../../src/comments/api/handlers';
import type { CreateOp } from '../../src/comments/review-ux/types';
import { asThreadId } from '../../src/comments/review-ux/types';
import { MemoryStore, TEST_DOC, TEST_AUTHOR } from './helpers';

async function seed(store: MemoryStore) {
  const op: CreateOp = { op: 'create', anchor: { exact: 'x' }, text: 'hi' };
  const r = await applyOp(store, TEST_DOC, op, TEST_AUTHOR);
  if (!r.ok || r.op !== 'create') throw new Error('seed failed');
  return r.thread.id;
}

describe('applyOp resolve', () => {
  it('stamps resolvedAt', async () => {
    const store = new MemoryStore();
    const id = await seed(store);
    const r = await applyOp(store, TEST_DOC, { op: 'resolve', threadId: id }, TEST_AUTHOR);
    expect(r.ok).toBe(true);
    if (r.ok && r.op === 'resolve') expect(typeof r.thread.resolvedAt).toBe('number');
  });

  it('is idempotent — a second resolve returns the SAME resolvedAt', async () => {
    const store = new MemoryStore();
    const id = await seed(store);
    const first = await applyOp(store, TEST_DOC, { op: 'resolve', threadId: id }, TEST_AUTHOR);
    const second = await applyOp(store, TEST_DOC, { op: 'resolve', threadId: id }, TEST_AUTHOR);
    if (first.ok && first.op === 'resolve' && second.ok && second.op === 'resolve') {
      expect(second.thread.resolvedAt).toBe(first.thread.resolvedAt);
    }
  });

  it('unknown threadId → not_found (single-op handler maps to 404)', async () => {
    const store = new MemoryStore();
    const r = await applyOp(store, TEST_DOC, { op: 'resolve', threadId: asThreadId('nope') }, TEST_AUTHOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
  });
});
