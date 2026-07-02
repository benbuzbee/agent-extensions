// Integration: boot the real Node review server against a temp root + fixture
// and drive the comment API over fetch — no Worker, no browser. Proves the
// ?comments HTTP mount end to end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { startReviewServer } from '../../src/comments/serve';
import type { ReviewServerHandle } from '../../src/comments/serve';

let handle: ReviewServerHandle;
let root: string;
const DOC = 'index.html';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-api-it.'));
  await fs.writeFile(path.join(root, DOC), '<!doctype html><html><body><p>hello world</p></body></html>');
  handle = await startReviewServer({ root });
});

afterAll(async () => {
  await handle?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const api = (query = 'comments') => `${handle.url}/${DOC}?${query}`;

describe('comment API over HTTP', () => {
  it('POST create → 200, then GET lists it with author stamped "user"', async () => {
    const create = await fetch(api(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'create', anchor: { exact: 'hello world' }, text: 'nice' }),
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.ok).toBe(true);
    expect(created.op).toBe('create');
    expect(created.thread.root.author.login).toBe('user');
    const threadId = created.thread.id;

    const get = await fetch(api());
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].id).toBe(threadId);
    expect(body.threads[0].root.author.login).toBe('user');
  });

  it('POST resolve → 200 with resolvedAt set, then POST delete → purged on re-GET', async () => {
    // Create a fresh thread on a second doc so tests don't interfere.
    const create = await fetch(api(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'create', anchor: { exact: 'hello world' }, text: 'to resolve' }),
    });
    const threadId = (await create.json()).thread.id;

    const resolve = await fetch(api(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'resolve', threadId }),
    });
    expect(resolve.status).toBe(200);
    const resolved = await resolve.json();
    expect(typeof resolved.thread.resolvedAt).toBe('number');

    const del = await fetch(api(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'delete', threadId }),
    });
    expect(del.status).toBe(200);

    const get = await fetch(api());
    const body = await get.json();
    expect(body.threads.find((t: { id: string }) => t.id === threadId)).toBeUndefined();
  });

  it('POST array → 207 with ordered per-op results', async () => {
    // Seed two threads.
    const mk = async () => {
      const r = await fetch(api(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'create', anchor: { exact: 'hello world' }, text: 'batch' }),
      });
      return (await r.json()).thread.id;
    };
    const id1 = await mk();
    const id2 = await mk();

    const res = await fetch(api(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { op: 'resolve', threadId: id1 },
        { op: 'resolve', threadId: 'ghost' },
        { op: 'delete', threadId: id2 },
      ]),
    });
    expect(res.status).toBe(207);
    const { results } = await res.json();
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ ok: true, op: 'resolve' });
    expect(results[1]).toMatchObject({ ok: false, op: 'resolve', error: { code: 'not_found' } });
    expect(results[2]).toMatchObject({ ok: true, op: 'delete' });
  });

  it('malformed envelope → 400', async () => {
    const res = await fetch(api(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'frobnicate' }),
    });
    expect(res.status).toBe(400);
  });

  it('a missing doc → neutral 404', async () => {
    const res = await fetch(`${handle.url}/does-not-exist.html?comments`);
    expect(res.status).toBe(404);
  });

  it('?ref= is honored end to end (route accepts it, no Worker)', async () => {
    const res = await fetch(`${handle.url}/${DOC}?ref=feature-x&comments`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.threads)).toBe(true);
  });
});
