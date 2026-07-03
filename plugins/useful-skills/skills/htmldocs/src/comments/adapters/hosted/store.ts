// HostedStore — the browser-side ICommentsStore for the hosted Worker runtime.
//
// A pure HTTP transport: it drives the `<doc>?ref=<ref>&comments` body-op API
// over `fetch` with the session cookie (`credentials: 'same-origin'`) and
// unwraps the server's OpResults so the shared widget sees the EXACT same
// observable behavior it gets from LocalFileStore — success returns the arm's
// value, failure throws an `.opError`-tagged Error, and reply/edit throw
// 'op not yet supported'. It touches only fetch/location/URL at runtime (no
// DOM, no rendering): all comment semantics live server-side behind the API.

import type { ICommentsStore } from '../../review-ux/store';
import type {
  Thread, ThreadId, Comment, DocKey, Author,
  CreateOp, ReplyOp, ResolveOp, ReopenOp, DeleteOp, EditOp, Op, OpResult, OpError,
} from '../../review-ux/types';

export class HostedStore implements ICommentsStore {
  // The collection URL for the doc hosting the widget: the current path with
  // `?comments` added and any existing `?ref=` preserved, so the Worker sees
  // `?ref=<ref>&comments` and `searchParams.has('comments')` is true. The doc
  // key is scoped server-side from the URL + session, so the DocKey arg is
  // unused (mirrors D1Store: the browser never maps repo/ref/path itself).
  private commentsUrl(): string {
    const url = new URL(location.href);
    url.searchParams.set('comments', '');
    return url.pathname + url.search;
  }

  async list(_doc: DocKey): Promise<Thread[]> {
    const res = await fetch(this.commentsUrl(), { credentials: 'same-origin' });
    if (!res.ok) throw await this.toError(res);
    const body = (await res.json()) as { threads?: unknown };
    return Array.isArray(body.threads) ? (body.threads as Thread[]) : [];
  }

  async create(_doc: DocKey, op: CreateOp, _author: Author): Promise<Thread> {
    const result = await this.postOp(op);
    if (result.ok && result.op === 'create') return result.thread;
    throw this.tagged('transient');
  }

  async reply(_doc: DocKey, _op: ReplyOp, _author: Author): Promise<Comment> {
    throw new Error('op not yet supported');
  }

  async resolve(_doc: DocKey, op: ResolveOp, _author: Author): Promise<Thread> {
    const result = await this.postOp(op);
    if (result.ok && (result.op === 'resolve' || result.op === 'reopen')) return result.thread;
    throw this.tagged('transient');
  }

  async reopen(_doc: DocKey, op: ReopenOp, _author: Author): Promise<Thread> {
    const result = await this.postOp(op);
    if (result.ok && (result.op === 'resolve' || result.op === 'reopen')) return result.thread;
    throw this.tagged('transient');
  }

  async delete(_doc: DocKey, op: DeleteOp, _author: Author): Promise<ThreadId> {
    const result = await this.postOp(op);
    if (result.ok && result.op === 'delete') return result.threadId;
    throw this.tagged('transient');
  }

  async edit(_doc: DocKey, _op: EditOp, _author: Author): Promise<Comment> {
    throw new Error('op not yet supported');
  }

  // A batch is ONE POST of a JSON array of op envelopes; the server runs them
  // best-effort and answers 207 with per-op results in request order. Return
  // that discriminated union verbatim — the widget/agent inspects each arm.
  async batch(_doc: DocKey, ops: Op[], _author: Author): Promise<OpResult[]> {
    const res = await fetch(this.commentsUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ops),
    });
    // 207 is a 2xx, so `res.ok` is true for a well-formed batch; only a
    // whole-request failure (e.g. the access probe denied it) falls through.
    if (!res.ok) throw await this.toError(res);
    const body = (await res.json()) as { results?: OpResult[] };
    return body.results ?? [];
  }

  // POST a single op envelope. A 200 body IS the single-op OpResult; a non-200
  // maps to a tagged throw mirroring LocalFileStore's seam contract.
  private async postOp(op: Op): Promise<OpResult> {
    const res = await fetch(this.commentsUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op),
    });
    if (!res.ok) throw await this.toError(res);
    return (await res.json()) as OpResult;
  }

  // Map a non-2xx response to the tagged Error the shared handler/caller
  // expects. A structured single-op OpResult body (404 not_found carrying a
  // threadId, or a 5xx transient) drives the code + threadId; a bodyless /
  // neutral text 404 (the access-deny path) is no_access; anything else is a
  // transient failure.
  private async toError(res: Response): Promise<Error> {
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* neutral text body — not JSON */ }
    const opResult = parsed as { ok?: boolean; error?: OpError } | null;
    if (opResult && opResult.ok === false && opResult.error && typeof opResult.error.code === 'string') {
      return this.tagged(opResult.error.code, opResult.error.threadId);
    }
    return this.tagged(res.status === 404 ? 'no_access' : 'transient');
  }

  // Build the `.opError`-tagged Error the shared handler/caller reads. A 2xx
  // whose arm doesn't match the op we sent lands here as 'transient' too — a
  // server contract breach, surfaced rather than returned as a wrong value.
  private tagged(code: OpError['code'], threadId?: ThreadId): Error {
    const opError: OpError = threadId !== undefined ? { code, threadId } : { code };
    return Object.assign(new Error(code), { opError });
  }
}
