// Shared types for the comments widget. Cross-cuts main.ts (runtime),
// anchor.ts (encode/decode), persistence.ts (sidecar I/O), serve.ts (server
// wire format), and the Playwright specs that consume the test handle.

import type { HttpSidecarStore } from './persistence';

/**
 * Pins a comment to a span of prose via a W3C TextQuoteSelector triple
 * (`prefix`, `exact`, `suffix`) with 32-char windows, matching Hypothesis.
 * `sections` lists every `<article id>` the selection intersects — usually
 * one element, two or more for cross-article comments, empty when no
 * id-bearing article is touched. Metadata only: the decoder always
 * searches the full document and uses prefix/suffix as the disambiguator;
 * `sections` exists so agents reading the sidecar can group/filter
 * comments by article without re-resolving the Range.
 */
export interface Anchor {
  sections: string[];
  prefix: string;
  exact: string;
  suffix: string;
}

/**
 * One review comment as stored in the sidecar. `id` is a widget-minted
 * opaque string; `created_at` is ISO-8601 UTC. v1 has no `status` or
 * `replies` — every comment is implicitly open until removed from the
 * `comments` array (see plan §out-of-scope).
 */
export interface Comment {
  id: string;
  anchor: Anchor;
  body: string;
  author: string;
  created_at: string;
}

/**
 * Top-level shape of the JSON sidecar (`<basename>.comments.json`) and the
 * wire body for `PUT /__htmldocs/sidecar/<doc-path>`. One definition serves the widget,
 * the server (serve.ts imports this), and the agent read path — single
 * source of truth, no drift across the wire.
 * `schema: 1` reserves a version bump for any future non-additive change;
 * v2 additions (resolve, threading, orphan tracking) are expected to be
 * backward-compatible optional fields.
 */
export interface CommentsModel {
  doc: string;
  schema: 1;
  comments: Comment[];
}

/**
 * Pure encode/decode surface for one Range ↔ one Anchor. `fromRange` is
 * total over its input — it never throws. `toRange` returns null when the
 * exact text cannot be located in the document.
 */
export interface AnchorAPI {
  fromRange(range: Range): Anchor;
  toRange(anchor: Anchor): Range | null;
}

/**
 * Test-only handle the widget exposes at `window.__htmldocsComments` when
 * the page is loaded with `?test=1`. Production loads never see this — the
 * sniff-check spec enforces that. Methods prefixed with `__` are escape
 * hatches for unit testing; the rest mirror what a production controller
 * would do (whenReady / saveComment / reanchor / getModel / getHighlights).
 */
export interface TestHandle {
  /** Resolves when init's first pass completes (store bound, inline seed
   * loaded if any was present, UI mount scheduled). */
  whenReady(): Promise<void>;
  /** Re-run init. Idempotent; safe to call after `__resetForTest`. */
  __init(): Promise<void>;
  /** Direct access to the anchor module so the encode/decode contract can
   * be unit-tested without orchestrating a full save+reload. */
  __anchor: AnchorAPI;
  /** Direct access to the HttpSidecarStore class so persistence specs can
   * exercise the load/save paths without running through init. */
  __HttpSidecarStore: typeof HttpSidecarStore;
  /** Drop all mutable state (store, model, highlights) back to
   * post-construction values. Test-only — exists to let a single page
   * exercise re-mount flows without reloading. */
  __resetForTest(): void;
  /** Deep clone of the in-memory CommentsModel (or null if none loaded). */
  getModel(): CommentsModel | null;
  /** Snapshot of `commentId → Range` for currently-resolved highlights. */
  getHighlights(): Map<string, Range>;
  /** Count of comments whose anchor's exact text no longer resolves in the
   * live DOM. v1 doesn't render orphans, but the count must stay observable
   * so resolver regressions that silently drop anchors are catchable. */
  getOrphanCount(): number;
  /** Encode the given Range as an Anchor, PUT the resulting CommentsModel
   * to /__htmldocs/sidecar/<doc-path>, and re-render highlights. Rolls back the
   * in-memory model if the PUT throws. */
  saveComment(range: Range, body: string): Promise<Comment>;
  /** Reparse the inline JSON seed and re-resolve every anchor against the
   * live DOM. Use after the DOM has changed to refresh highlight ranges. */
  reanchor(): Promise<void>;
}

declare global {
  interface Window {
    __htmldocsComments?: TestHandle;
  }
}
