// The runtime-agnostic op dispatcher + request handler. Knows nothing about
// HTTP framing, fs, or Cloudflare — it takes a parsed method/body, a store, a
// DocKey, and the caller-supplied author, and returns a {status, json} pair the
// runtime serializes. The author is a parameter, never read from the body.

import type { ICommentsStore } from '../review-ux/store';
import type { DocKey, Author, Op, OpResult, OpError, ThreadId, Thread } from '../review-ux/types';
import { parseEnvelope } from './schemas';
import { isNotFoundError, NotImplementedError } from './thread-ops';

const RESERVED_MESSAGE = new NotImplementedError().message;

/** Pull an OpError out of whatever a store threw. A store may tag an error with
 *  `.opError`; thread-ops throws NotFoundError; anything else is a genuine
 *  transient failure. */
function errorToOpError(err: unknown): OpError {
  const tagged = (err as { opError?: OpError }).opError;
  if (tagged && typeof tagged.code === 'string') return tagged;
  if (isNotFoundError(err)) return { code: 'not_found', threadId: err.threadId, message: err.message };
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'transient', message };
}

/** The threadId an op names, or undefined — a LEGITIMATE arm, not an error:
 *  create mints its id server-side and edit names a commentId, so neither
 *  carries one. Structural (`in`) rather than a switch over op kinds, so a
 *  future threadId-bearing op is picked up without touching this function. */
function opThreadId(op: Op): ThreadId | undefined {
  return 'threadId' in op ? op.threadId : undefined;
}

/** Ensure a failed op's error echoes the threadId the op named. A `not_found`
 *  already carries it (thread-ops stamps it), but a `transient`/`no_access`
 *  failure on a threadId-bearing op otherwise wouldn't — so a batch caller
 *  couldn't tell WHICH op failed. Backfill it (never clobber an existing one) so
 *  every ok:false element naming a thread reports its target. Exported so the
 *  hosted D1Store's own batch loop applies the identical rule (no drift). */
export function withOpThreadId(op: Op, error: OpError): OpError {
  if (error.threadId !== undefined) return error;
  const threadId = opThreadId(op);
  return threadId !== undefined ? { ...error, threadId } : error;
}

/**
 * Apply a single op against the store and return its OpResult arm. Reserved
 * verbs (reply/edit) never touch the store — inside a batch they surface as a
 * per-op transient failure so one reserved op can't fail the whole batch.
 */
export async function applyOp(
  store: ICommentsStore,
  doc: DocKey,
  op: Op,
  author: Author,
): Promise<OpResult> {
  try {
    switch (op.op) {
      case 'create': {
        const thread = await store.create(doc, op, author);
        return { ok: true, op: 'create', thread };
      }
      case 'resolve': {
        const thread = await store.resolve(doc, op, author);
        return { ok: true, op: 'resolve', thread };
      }
      case 'reopen': {
        const thread = await store.reopen(doc, op, author);
        return { ok: true, op: 'reopen', thread };
      }
      case 'delete': {
        const threadId = await store.delete(doc, op, author);
        return { ok: true, op: 'delete', threadId };
      }
      case 'reply':
      case 'edit':
        return {
          ok: false,
          op: op.op,
          error: withOpThreadId(op, { code: 'transient', message: RESERVED_MESSAGE }),
        };
    }
  } catch (err) {
    return { ok: false, op: op.op, error: withOpThreadId(op, errorToOpError(err)) };
  }
}

/** Map an OpError to the HTTP status a SINGLE op returns. A batch always uses
 *  207 regardless of per-op outcomes. */
export function statusForError(error: OpError): number {
  switch (error.code) {
    case 'not_found':
    case 'no_access':
      return 404;
    case 'transient':
    default:
      return 500;
  }
}

export interface CommentsRequest {
  method: string;
  /** The already JSON-parsed request body (undefined for GET / empty body).
   *  `unknown` on purpose: it is untrusted, caller-supplied input that MUST go
   *  through parseEnvelope before any field is read. */
  body?: unknown;
  store: ICommentsStore;
  doc: DocKey;
  author: Author;
}

/** Every JSON body handleCommentsRequest can return. The runtime only
 *  serializes this, so the union stays a closed enumeration of the shapes the
 *  handler actually emits (see handleCommentsRequest's doc-comment). */
export type CommentsResponseBody =
  | { threads: Thread[] }
  | { results: OpResult[] }
  | { error: string }
  | OpResult;

export interface CommentsResponse {
  status: number;
  json: CommentsResponseBody;
}

/**
 * Handle one comments-API request end to end (no HTTP framing):
 *   GET   → 200 {threads}
 *   POST malformed envelope → 400 (ZERO store calls)
 *   POST single reserved reply/edit → 400 {error:'op not yet supported'}
 *   POST single → applyOp → 200 on ok / statusForError(...) on fail; body is
 *                 the OpResult
 *   POST array  → best-effort loop → 207 {results} in request order
 */
export async function handleCommentsRequest(req: CommentsRequest): Promise<CommentsResponse> {
  const method = req.method.toUpperCase();

  if (method === 'GET') {
    const threads: Thread[] = await req.store.list(req.doc);
    return { status: 200, json: { threads } };
  }

  if (method !== 'POST') {
    return { status: 405, json: { error: 'method not allowed' } };
  }

  const parsed = parseEnvelope(req.body);
  if (!parsed.ok) {
    // 400 BEFORE any store call.
    return { status: 400, json: { error: parsed.message } };
  }

  if (parsed.isBatch) {
    const results: OpResult[] = [];
    for (const op of parsed.ops) {
      results.push(await applyOp(req.store, req.doc, op, req.author));
    }
    return { status: 207, json: { results } };
  }

  const op = parsed.ops[0]!;
  // A single reserved op is parsed-then-rejected with a clean 400.
  if (op.op === 'reply' || op.op === 'edit') {
    return { status: 400, json: { error: RESERVED_MESSAGE } };
  }

  const result = await applyOp(req.store, req.doc, op, req.author);
  if (result.ok) {
    return { status: 200, json: result };
  }
  return { status: statusForError(result.error), json: result };
}
