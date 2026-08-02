// Barrel re-export for the runtime-agnostic comment API. serve.ts (local) and
// the hosted Worker import from here.

export { parseEnvelope } from './schemas';
export type { ParseResult } from './schemas';
export {
  applyOp,
  statusForError,
  handleCommentsRequest,
  withOpThreadId,
} from './handlers';
export type { CommentsRequest, CommentsResponse } from './handlers';
export {
  createThread,
  resolveThread,
  reopenThread,
  deleteThread,
  NotFoundError,
  isNotFoundError,
} from './thread-ops';
export type { IdFactory } from './thread-ops';
