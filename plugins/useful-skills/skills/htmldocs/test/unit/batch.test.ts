import { describe, it, expect } from 'vitest';
import { handleCommentsRequest } from '../../src/comments/api/handlers';
import type { CreateOp, OpResult } from '../../src/comments/review-ux/types';
import { MemoryStore, TEST_DOC, TEST_AUTHOR } from './helpers';

async function seed(store: MemoryStore): Promise<string> {
  const res = await handleCommentsRequest({
    method: 'POST', body: { op: 'create', anchor: { exact: 'x' }, text: 'hi' } as CreateOp,
    store, doc: TEST_DOC, author: TEST_AUTHOR,
  });
  const r = res.json as OpResult;
  if (!r.ok || r.op !== 'create') throw new Error('seed failed');
  return r.thread.id;
}

describe('batch via handleCommentsRequest', () => {
  it('returns 207 with one result per input op in request order', async () => {
    const store = new MemoryStore();
    const id1 = await seed(store);
    const id2 = await seed(store);
    const res = await handleCommentsRequest({
      method: 'POST',
      body: [
        { op: 'resolve', threadId: id1 },
        { op: 'delete', threadId: id2 },
      ],
      store, doc: TEST_DOC, author: TEST_AUTHOR,
    });
    expect(res.status).toBe(207);
    const { results } = res.json as { results: OpResult[] };
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ok: true, op: 'resolve' });
    expect(results[1]).toMatchObject({ ok: true, op: 'delete' });
  });

  it('partial failure — a not_found op reports ok:false while siblings still persist', async () => {
    const store = new MemoryStore();
    const id1 = await seed(store);
    const id2 = await seed(store);
    const res = await handleCommentsRequest({
      method: 'POST',
      body: [
        { op: 'resolve', threadId: id1 },
        { op: 'resolve', threadId: 'ghost' },
        { op: 'delete', threadId: id2 },
      ],
      store, doc: TEST_DOC, author: TEST_AUTHOR,
    });
    expect(res.status).toBe(207);
    const { results } = res.json as { results: OpResult[] };
    expect(results[0]).toMatchObject({ ok: true, op: 'resolve' });
    expect(results[1]).toMatchObject({ ok: false, op: 'resolve', error: { code: 'not_found', threadId: 'ghost' } });
    expect(results[2]).toMatchObject({ ok: true, op: 'delete' });

    // Sibling ops persisted despite the failure (no rollback).
    const threads = await store.list(TEST_DOC);
    expect(threads.find((t) => t.id === id1)?.resolvedAt).not.toBeNull();
    expect(threads.find((t) => t.id === id2)).toBeUndefined();
  });

  it('a reserved reply/edit element → per-op {ok:false, transient, "op not yet supported"}', async () => {
    const store = new MemoryStore();
    const id1 = await seed(store);
    const res = await handleCommentsRequest({
      method: 'POST',
      body: [
        { op: 'resolve', threadId: id1 },
        { op: 'reply', threadId: id1, text: 'later' },
      ],
      store, doc: TEST_DOC, author: TEST_AUTHOR,
    });
    expect(res.status).toBe(207);
    const { results } = res.json as { results: OpResult[] };
    expect(results[0]).toMatchObject({ ok: true, op: 'resolve' });
    expect(results[1]).toMatchObject({ ok: false, op: 'reply', error: { code: 'transient', message: 'op not yet supported' } });
  });
});
