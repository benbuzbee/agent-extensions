// Envelope validation — the ONLY zod importer in the tree (kept out of the
// widget bundle because main.ts never imports api/). Validates the request
// envelope with `zod/mini` and, on success, brands the raw string ids exactly
// once (asThreadId/asCommentId) so a ThreadId can never be confused with a
// CommentId downstream.
//
// A single op body OR an array of op bodies is accepted. Reserved verbs
// (reply/edit) parse here on purpose — the "parse then 400" contract lives in
// handlers.ts, not the schema. A malformed envelope (unknown op, missing
// required field, wrong type, or a body that is neither an op nor an array of
// ops) yields {ok:false} — the single source of the API's 400.

import * as z from 'zod/mini';
import type { Anchor, Op } from '../review-ux/types';
import { asThreadId, asCommentId } from '../review-ux/types';

// --- per-field schemas ---

const anchorSchema = z.object({
  exact: z.string(),
  prefix: z.optional(z.string()),
  suffix: z.optional(z.string()),
  sections: z.optional(z.array(z.string())),
});

// --- per-op schemas (raw string ids; branded after parse) ---

const createSchema = z.object({
  op: z.literal('create'),
  anchor: anchorSchema,
  text: z.string(),
  clientOpId: z.optional(z.string()),
});

const resolveSchema = z.object({
  op: z.literal('resolve'),
  threadId: z.string(),
});

const reopenSchema = z.object({
  op: z.literal('reopen'),
  threadId: z.string(),
});

const deleteSchema = z.object({
  op: z.literal('delete'),
  threadId: z.string(),
});

// Reserved — parsed so the shape is stable, rejected with 400 in handlers.ts.
const replySchema = z.object({
  op: z.literal('reply'),
  threadId: z.string(),
  text: z.string(),
  clientOpId: z.optional(z.string()),
});

const editSchema = z.object({
  op: z.literal('edit'),
  commentId: z.string(),
  patch: z.object({ body: z.string() }),
});

const opSchema = z.discriminatedUnion('op', [
  createSchema,
  resolveSchema,
  reopenSchema,
  deleteSchema,
  replySchema,
  editSchema,
]);

const envelopeSchema = z.union([opSchema, z.array(opSchema)]);

// The parsed (still raw-string-id) shape zod produces for one op.
type RawOp = z.infer<typeof opSchema>;

/**
 * Apply the branded-id constructors exactly once, at this parse boundary. This
 * is the sole place a raw string becomes a ThreadId/CommentId, keeping the two
 * brands distinct everywhere downstream.
 */
function brandOp(raw: RawOp): Op {
  switch (raw.op) {
    case 'create':
      return {
        op: 'create',
        anchor: raw.anchor as Anchor,
        text: raw.text,
        clientOpId: raw.clientOpId,
      };
    case 'resolve':
      return { op: 'resolve', threadId: asThreadId(raw.threadId) };
    case 'reopen':
      return { op: 'reopen', threadId: asThreadId(raw.threadId) };
    case 'delete':
      return { op: 'delete', threadId: asThreadId(raw.threadId) };
    case 'reply':
      return {
        op: 'reply',
        threadId: asThreadId(raw.threadId),
        text: raw.text,
        clientOpId: raw.clientOpId,
      };
    case 'edit':
      return {
        op: 'edit',
        commentId: asCommentId(raw.commentId),
        patch: { body: raw.patch.body },
      };
  }
}

export type ParseResult =
  | { ok: true; ops: Op[]; isBatch: boolean }
  | { ok: false; message: string };

/**
 * Validate a raw (already JSON-parsed) request body. On success returns the
 * branded ops plus whether the body was a batch array; on failure returns a
 * message the caller turns into a 400. NEVER touches the store.
 */
export function parseEnvelope(raw: unknown): ParseResult {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'invalid comment op envelope' };
  }
  const value = parsed.data;
  if (Array.isArray(value)) {
    return { ok: true, ops: value.map(brandOp), isBatch: true };
  }
  return { ok: true, ops: [brandOp(value)], isBatch: false };
}
