import { describe, it, expect } from 'vitest';
import { applyOp } from '../../src/comments/api/handlers';
import type { CreateOp } from '../../src/comments/review-ux/types';
import { MemoryStore, TEST_DOC, TEST_AUTHOR } from './helpers';

describe('applyOp create', () => {
  it('returns ok create with a server-minted id, param author, numeric createdAt, resolvedAt=null', async () => {
    const store = new MemoryStore();
    const op: CreateOp = { op: 'create', anchor: { exact: 'x' }, text: 'hi' };
    const r = await applyOp(store, TEST_DOC, op, TEST_AUTHOR);
    expect(r.ok).toBe(true);
    if (r.ok && r.op === 'create') {
      expect(typeof r.thread.id).toBe('string');
      expect(r.thread.id.length).toBeGreaterThan(0);
      expect(r.thread.root.author).toEqual(TEST_AUTHOR);
      expect(typeof r.thread.root.createdAt).toBe('number');
      expect(r.thread.resolvedAt).toBeNull();
      expect(r.thread.root.body).toBe('hi');
    }
  });

  it('ignores any author-like field on the op — author comes from the param only', async () => {
    const store = new MemoryStore();
    // Even if a bogus author leaks onto the op object, applyOp passes the param.
    const op = { op: 'create', anchor: { exact: 'x' }, text: 'hi', author: 'evil' } as unknown as CreateOp;
    const r = await applyOp(store, TEST_DOC, op, TEST_AUTHOR);
    if (r.ok && r.op === 'create') expect(r.thread.root.author).toEqual(TEST_AUTHOR);
  });
});
