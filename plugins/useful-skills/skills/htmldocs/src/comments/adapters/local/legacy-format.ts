// The legacy on-disk sidecar shape — SOLE surviving home of the legacy JSON.
//
// Node/disk-only. The wire the browser sees is the internal { threads: Thread[] }
// view (mirrors the GET ?comments response); this file is the ONLY place the
// legacy `*.comments.json` shape (author string, created_at/resolved_at ISO)
// still lives, so existing sidecar files load and persist byte-unchanged with
// zero migration. Imported only by sidecar-store.ts and serve.ts's disk helpers.

import type { Anchor, Comment, Thread } from '../../review-ux/types';
import { asThreadId, asCommentId, asTimestamp } from '../../review-ux/types';

/**
 * One comment in the legacy sidecar JSON shape. This is the wire format
 * serve.ts's `isWellShapedModel` validates; it is NOT the internal
 * Thread/Comment shape.
 */
export interface LegacyComment {
  id: string;
  anchor: { sections: string[]; prefix: string; exact: string; suffix: string };
  body: string;
  author: string;
  created_at: string;
  /**
   * Optional soft-close timestamp (ISO string, mirroring `created_at`).
   * Absent/omitted == open. Added backward-compatibly: `isWellShapedModel`
   * tolerates extra fields, and older sidecars simply lack it (they load as
   * open), so Deliverable 1 sidecars still validate.
   */
  resolved_at?: string;
}

/**
 * Top-level shape of the JSON sidecar on disk. One definition serves the local
 * server's disk layer and SidecarStore — the single source of truth for the
 * legacy format.
 */
export interface CommentsModel {
  doc: string;
  schema: 1;
  comments: LegacyComment[];
}

/**
 * Flatten a Thread back to the legacy wire array of LegacyComment objects.
 * Each thread becomes one root entry (replies are appended after root).
 */
export function threadToLegacy(thread: Thread): LegacyComment[] {
  const out: LegacyComment[] = [];
  const toLegacy = (c: Comment, anchor: Anchor): LegacyComment => {
    const legacy: LegacyComment = {
      id: c.id,
      anchor: {
        sections: anchor.sections ?? [],
        prefix: anchor.prefix ?? '',
        exact: anchor.exact,
        suffix: anchor.suffix ?? '',
      },
      body: c.body,
      author: c.author.login,
      created_at: new Date(c.createdAt).toISOString(),
    };
    // Carry resolve state on the wire so a soft-close survives persist/reload.
    if (thread.resolvedAt !== null) {
      legacy.resolved_at = new Date(thread.resolvedAt).toISOString();
    }
    return legacy;
  };
  out.push(toLegacy(thread.root, thread.anchor));
  for (const reply of thread.replies) {
    out.push(toLegacy(reply, thread.anchor));
  }
  return out;
}

/**
 * Convert a single legacy comment (treated as a thread root with no replies)
 * into the internal Thread shape. For v1 single-comment threads: replies=[]
 * and resolvedAt=null; ThreadId === the legacy comment's id.
 */
export function legacyToThread(comment: LegacyComment): Thread {
  return {
    id: asThreadId(comment.id),
    anchor: {
      exact: comment.anchor.exact,
      prefix: comment.anchor.prefix || undefined,
      suffix: comment.anchor.suffix || undefined,
      sections: comment.anchor.sections.length > 0 ? comment.anchor.sections : undefined,
    },
    root: {
      id: asCommentId(comment.id),
      author: { login: comment.author, name: null },
      body: comment.body,
      createdAt: asTimestamp(new Date(comment.created_at).getTime()),
    },
    replies: [],
    resolvedAt: comment.resolved_at
      ? asTimestamp(new Date(comment.resolved_at).getTime())
      : null,
  };
}
