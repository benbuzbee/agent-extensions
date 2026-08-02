import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpCommentsStore } from '../../src/comments/adapters/http-store';
import type {
  Thread, Author, Op, CreateOp, ResolveOp, ReopenOp, DeleteOp,
} from '../../src/comments/review-ux/types';
import { asThreadId, asCommentId, asTimestamp } from '../../src/comments/review-ux/types';

// The widget's doc key is derived server-side from the URL + session, so the
// HttpCommentsStore ignores the DocKey arg and builds its collection URL from
// location.href. We assert the URL it actually fetches independently.
const DOC = { repo: 'app-ios', ref: 'main', path: '/app-ios/guide.html' };
const AUTHOR: Author = { login: 'octocat', name: 'Mona' };
const HREF = 'https://docs.my-org.dev/app-ios/guide.html?ref=main';
// `?comments` added, existing `?ref` preserved (empty-valued `comments=`).
const EXPECTED_URL = '/app-ios/guide.html?ref=main&comments=';

function fakeThread(id: string, resolvedAt: number | null = null): Thread {
  return {
    id: asThreadId(id),
    anchor: { exact: `anchor-${id}` },
    root: {
      id: asCommentId(id),
      author: AUTHOR,
      body: `body-${id}`,
      createdAt: asTimestamp(1000),
    },
    replies: [],
    resolvedAt: resolvedAt === null ? null : asTimestamp(resolvedAt),
  };
}

interface RecordedCall {
  url: string;
  method: string;
  body: string | null;
  credentials?: string;
}

let calls: RecordedCall[];
let queue: Response[];

beforeEach(() => {
  calls = [];
  queue = [];
  (globalThis as unknown as { location: { href: string } }).location = { href: HREF };
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
    (input: unknown, init: { method?: string; body?: string; credentials?: string } = {}) => {
      calls.push({
        url: String(input),
        method: (init.method ?? 'GET').toUpperCase(),
        body: init.body ?? null,
        credentials: init.credentials,
      });
      const res = queue.shift();
      if (!res) throw new Error('hosted-store test: no queued fetch response');
      return Promise.resolve(res);
    },
  );
});

function queueJson(status: number, obj: unknown): void {
  queue.push(new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
}
function queueText(status: number, text: string): void {
  queue.push(new Response(text, { status, headers: { 'content-type': 'text/plain' } }));
}

describe('HttpCommentsStore — envelope mapping + OpResult unwrap', () => {
  it('create POSTs the create envelope with credentials and unwraps the thread', async () => {
    const store = new HttpCommentsStore();
    queueJson(200, { ok: true, op: 'create', thread: fakeThread('t-new') });
    const op: CreateOp = { op: 'create', anchor: { exact: 'hi' }, text: 'a note' };

    const out = await store.create(DOC, op, AUTHOR);

    expect(out.id).toBe('t-new');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(EXPECTED_URL);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.credentials).toBe('same-origin');
    expect(JSON.parse(calls[0]!.body!)).toEqual(op);
  });

  it('resolve POSTs the resolve envelope and unwraps the (resolved) thread', async () => {
    const store = new HttpCommentsStore();
    queueJson(200, { ok: true, op: 'resolve', thread: fakeThread('t1', 4242) });
    const op: ResolveOp = { op: 'resolve', threadId: asThreadId('t1') };

    const out = await store.resolve(DOC, op, AUTHOR);

    expect(out.resolvedAt).toBe(4242);
    expect(calls[0]!.url).toBe(EXPECTED_URL);
    expect(calls[0]!.credentials).toBe('same-origin');
    expect(JSON.parse(calls[0]!.body!)).toEqual(op);
  });

  it('reopen POSTs the reopen envelope and unwraps the thread', async () => {
    const store = new HttpCommentsStore();
    queueJson(200, { ok: true, op: 'reopen', thread: fakeThread('t1', null) });
    const op: ReopenOp = { op: 'reopen', threadId: asThreadId('t1') };

    const out = await store.reopen(DOC, op, AUTHOR);

    expect(out.resolvedAt).toBeNull();
    expect(JSON.parse(calls[0]!.body!)).toEqual(op);
  });

  it('delete POSTs the delete envelope and unwraps the threadId', async () => {
    const store = new HttpCommentsStore();
    queueJson(200, { ok: true, op: 'delete', threadId: 't-gone' });
    const op: DeleteOp = { op: 'delete', threadId: asThreadId('t-gone') };

    const out = await store.delete(DOC, op, AUTHOR);

    expect(out).toBe('t-gone');
    expect(calls[0]!.method).toBe('POST');
    expect(JSON.parse(calls[0]!.body!)).toEqual(op);
  });

  it('list GETs the collection URL and returns body.threads', async () => {
    const store = new HttpCommentsStore();
    queueJson(200, { threads: [fakeThread('a'), fakeThread('b')] });

    const out = await store.list(DOC);

    expect(out).toHaveLength(2);
    expect(out.map((t) => t.id)).toEqual(['a', 'b']);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(EXPECTED_URL);
    expect(calls[0]!.credentials).toBe('same-origin');
    expect(calls[0]!.body).toBeNull();
  });

  it('batch POSTs a JSON ARRAY and returns the 207 results (partial failure included)', async () => {
    const store = new HttpCommentsStore();
    const ops: Op[] = [
      { op: 'resolve', threadId: asThreadId('t1') },
      { op: 'resolve', threadId: asThreadId('ghost') },
    ];
    queueJson(207, {
      results: [
        { ok: true, op: 'resolve', thread: fakeThread('t1', 9) },
        { ok: false, op: 'resolve', error: { code: 'not_found', threadId: 'ghost' } },
      ],
    });

    const results = await store.batch(DOC, ops, AUTHOR);

    expect(results).toHaveLength(2);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    expect((results[1] as { error: { code: string } }).error.code).toBe('not_found');
    // The wire body is a JSON array of the op envelopes, in request order.
    const sent = JSON.parse(calls[0]!.body!);
    expect(Array.isArray(sent)).toBe(true);
    expect(sent).toEqual(ops);
  });
});

describe('HttpCommentsStore — error arms map non-2xx to tagged OpErrors', () => {
  it('404 carrying an OpResult body throws a not_found tagged error with threadId', async () => {
    const store = new HttpCommentsStore();
    queueJson(404, { ok: false, op: 'resolve', error: { code: 'not_found', threadId: 'ghost' } });
    await expect(
      store.resolve(DOC, { op: 'resolve', threadId: asThreadId('ghost') }, AUTHOR),
    ).rejects.toMatchObject({ opError: { code: 'not_found', threadId: 'ghost' } });
  });

  it('a neutral text/404 (access deny) throws a no_access tagged error', async () => {
    const store = new HttpCommentsStore();
    queueText(404, 'Not found or no access');
    await expect(
      store.resolve(DOC, { op: 'resolve', threadId: asThreadId('t1') }, AUTHOR),
    ).rejects.toMatchObject({ opError: { code: 'no_access' } });
  });

  it('a 500 throws a transient tagged error', async () => {
    const store = new HttpCommentsStore();
    queueJson(500, { ok: false, op: 'resolve', error: { code: 'transient', message: 'boom' } });
    await expect(
      store.resolve(DOC, { op: 'resolve', threadId: asThreadId('t1') }, AUTHOR),
    ).rejects.toMatchObject({ opError: { code: 'transient' } });
  });

  it('reply and edit throw "op not yet supported" (both reserved ops)', async () => {
    const store = new HttpCommentsStore();
    await expect(
      store.reply(DOC, { op: 'reply', threadId: asThreadId('t1'), text: 'x' }, AUTHOR),
    ).rejects.toThrow('op not yet supported');
    await expect(
      store.edit(DOC, { op: 'edit', commentId: asCommentId('c1'), patch: { body: 'x' } }, AUTHOR),
    ).rejects.toThrow('op not yet supported');
    // Neither reserved op touches the network.
    expect(calls).toHaveLength(0);
  });
});

