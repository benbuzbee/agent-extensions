import { describe, it, expect } from 'vitest';
import { handleCommentsRequest } from '../../src/comments/api/handlers';
import { MemoryStore, SpyStore, TEST_DOC, TEST_AUTHOR } from './helpers';

describe('handleCommentsRequest', () => {
  it('a malformed POST body → 400 with ZERO store calls', async () => {
    const spy = new SpyStore();
    const res = await handleCommentsRequest({
      method: 'POST', body: { op: 'frobnicate' }, store: spy, doc: TEST_DOC, author: TEST_AUTHOR,
    });
    expect(res.status).toBe(400);
    expect(spy.calls).toEqual([]);
  });

  it('a create missing text → 400, no store call', async () => {
    const spy = new SpyStore();
    const res = await handleCommentsRequest({
      method: 'POST', body: { op: 'create', anchor: { exact: 'x' } }, store: spy, doc: TEST_DOC, author: TEST_AUTHOR,
    });
    expect(res.status).toBe(400);
    expect(spy.calls).toEqual([]);
  });

  it('a single reserved reply → 400 "op not yet supported", no store mutation', async () => {
    const spy = new SpyStore();
    const res = await handleCommentsRequest({
      method: 'POST', body: { op: 'reply', threadId: 't', text: 'x' }, store: spy, doc: TEST_DOC, author: TEST_AUTHOR,
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'op not yet supported' });
    expect(spy.calls).toEqual([]);
  });

  it('a single reserved edit → 400 "op not yet supported"', async () => {
    const spy = new SpyStore();
    const res = await handleCommentsRequest({
      method: 'POST', body: { op: 'edit', commentId: 'c', patch: { body: 'x' } }, store: spy, doc: TEST_DOC, author: TEST_AUTHOR,
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'op not yet supported' });
    expect(spy.calls).toEqual([]);
  });

  it('GET → 200 {threads} from store.list', async () => {
    const store = new MemoryStore();
    await handleCommentsRequest({
      method: 'POST', body: { op: 'create', anchor: { exact: 'x' }, text: 'hi' }, store, doc: TEST_DOC, author: TEST_AUTHOR,
    });
    const res = await handleCommentsRequest({ method: 'GET', store, doc: TEST_DOC, author: TEST_AUTHOR });
    expect(res.status).toBe(200);
    const { threads } = res.json as { threads: unknown[] };
    expect(threads).toHaveLength(1);
  });

  it('a single not_found op → 404 with the OpResult as the body', async () => {
    const store = new MemoryStore();
    const res = await handleCommentsRequest({
      method: 'POST', body: { op: 'resolve', threadId: 'ghost' }, store, doc: TEST_DOC, author: TEST_AUTHOR,
    });
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ ok: false, op: 'resolve', error: { code: 'not_found' } });
  });
});
