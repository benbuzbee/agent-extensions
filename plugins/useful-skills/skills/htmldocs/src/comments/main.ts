// htmldocs review-mode comments widget — entry point.
//
// Loaded as a single ESM module from each htmldocs-generated HTML doc the
// server is serving in review mode. The server injects the script tag plus
// an inline `<script type="application/json" id="__htmldocs_comments">`
// block carrying the current sidecar state; the widget reads the seed,
// mounts the UI, and PUTs the full CommentsModel back to
// `/__htmldocs/sidecar/<doc-path>` on each save. Opening the doc off disk (file://) or
// over a static server with no injection shows a vanilla page — no widget
// DOM, no banner, no console noise.
//
// Responsibilities at this layer: highlight-namespace registration, sidecar
// load via HttpSidecarStore, registering each comment's Range under the
// `htmldocs-cmt` CSS Custom Highlight, mounting the UI layer, and exposing
// a test-only handle at `window.__htmldocsComments` when `?test=1` is in
// the URL.
//
// The TS sources here compile via esbuild into ../../dist/comments.mjs
// (linguist-generated, checked in). Edit the .ts; rebuild with `npm run
// build`.
//
// The widget is implemented as a `CommentsWidget` class — all mutable state
// (sidecar store, model, highlight ranges, listeners, ready promise, mounted
// UI) lives on the instance. The module-scope `activeWidget` reference is
// the page-level singleton; tests swap it via `resetActiveWidget()` so a
// single page can exercise re-mount flows without reloading. Production
// code never reads `activeWidget` directly.

import type { Anchor, Comment, CommentsModel, TestHandle } from './types';
import * as anchor from './anchor';
import { HttpSidecarStore } from './persistence';
import { mountUI, type MountedUI } from './ui';

const TEST_MODE = new URLSearchParams(location.search).has('test');
const HIGHLIGHT_NAME = 'htmldocs-cmt';

// Module-load sentinel. Set before the TEST_MODE branch so production loads
// (no ?test=1) can prove the script actually reached this point — without it
// a 404 on dist/comments.mjs would look identical to a successful load in
// any test asserting `window.__htmldocsComments === undefined`.
(window as unknown as { __htmldocsModuleLoaded?: boolean }).__htmldocsModuleLoaded = true;

const HIGHLIGHT_STYLES = `
::highlight(htmldocs-cmt) {
  background: rgba(255, 213, 0, .35);
  color: inherit;
}
@media (prefers-color-scheme: dark) {
  ::highlight(htmldocs-cmt) {
    background: rgba(255, 213, 0, .25);
  }
}
`;

// Module-shared highlight stylesheet. Lazily constructed on first widget init
// and re-adopted into `document.adoptedStyleSheets` if it was removed (e.g.
// by a test). The `includes` check keeps the array at one copy across
// re-mounts. Eager `const` construction would fail outside the browser
// (CSSStyleSheet is undefined in Node); the `let` keeps construction inside
// init's browser-only path.
let highlightStylesheet: CSSStyleSheet | null = null;

function ensureHighlightStyles(): void {
  if (!highlightStylesheet) {
    highlightStylesheet = new CSSStyleSheet();
    highlightStylesheet.replaceSync(HIGHLIGHT_STYLES);
  }
  if (!document.adoptedStyleSheets.includes(highlightStylesheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightStylesheet];
  }
}

// Filename of the page hosting the widget — used as the `doc` field
// re-stamped on every save. Falls back to `index.html` for directory-index
// URLs whose pathname ends in `/`.
function currentBasename(): string {
  return location.pathname.split('/').pop() || 'index.html';
}

// True when the server injected the inline JSON seed. The injection is the
// signal that we're in review mode; absent it, the widget mounts nothing
// and the page renders as a vanilla doc.
function reviewModeActive(): boolean {
  return !!document.getElementById('__htmldocs_comments');
}

interface CommentState {
  store: HttpSidecarStore | null;
  model: CommentsModel | null;
  highlightRanges: Map<string, Range>;
}

/**
 * Page-level comments widget. One instance is constructed at module load
 * (production) or per `resetActiveWidget` call (tests). The class owns all
 * mutable state plus the UI lifecycle — `unmount()` is the symmetric
 * teardown of `init()`, used to swap a fresh instance into `activeWidget`
 * without reloading the page. Outstanding `saveComment` / `reanchor`
 * promises kicked off before `unmount()` may still resolve into the
 * orphaned instance; tests must `await` outstanding work before resetting.
 */
class CommentsWidget {
  private readonly state: CommentState = {
    store: null,
    model: null,
    highlightRanges: new Map(),
  };

  private readonly listeners = new Set<() => void>();

  // Resolves when init's first pass completes. Per-instance, so a reset
  // gives the new widget a fresh promise that whenReady() can await
  // independently of the original module-load init.
  private readyResolve!: () => void;
  private readonly readyPromise: Promise<void> = new Promise<void>((r) => {
    this.readyResolve = r;
  });

  private ui: MountedUI | null = null;

  // Flipped true by `unmount()` so deferred work scheduled before disposal
  // (DOMContentLoaded handlers from a still-loading page; in-flight async
  // tasks) can early-return rather than mutate a discarded instance.
  private disposed = false;

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  getModel(): CommentsModel | null {
    return this.state.model
      ? (JSON.parse(JSON.stringify(this.state.model)) as CommentsModel)
      : null;
  }

  getHighlights(): Map<string, Range> {
    // Range values are cloned individually so a caller that mutates a
    // returned Range (e.g. `r.collapse(true)` for inspection) can't
    // corrupt the widget's stored highlight ranges and silently break
    // the next rebuild — matches `getModel`'s deep-copy contract.
    const cloned = new Map<string, Range>();
    for (const [id, r] of this.state.highlightRanges) {
      cloned.set(id, r.cloneRange());
    }
    return cloned;
  }

  /**
   * Count of loaded comments whose anchors failed to resolve against the
   * live DOM. Orphans aren't rendered (no v1 UI), but the count is exposed
   * on the test handle so a resolver regression that silently drops
   * anchors fails a test instead of just disappearing from the page.
   */
  getOrphanCount(): number {
    if (!this.state.model) return 0;
    return this.state.model.comments.length - this.state.highlightRanges.size;
  }

  /**
   * Initialize the widget. Bails out silently when no inline JSON seed was
   * injected (the doc is being viewed plain, not in review mode) so a
   * vanilla file:// or static load is indistinguishable from a doc with no
   * widget wired in. When active, awaits DOMContentLoaded so the inline
   * seed block has been parsed before we read it, then binds an
   * HttpSidecarStore, loads the seed, mounts the UI, and resolves
   * `readyPromise` via the `finally` block.
   */
  async init(): Promise<void> {
    try {
      // Defer until parsing is past <head>/<body> — the inline JSON seed
      // sits before </body>, and a deferred module script can otherwise
      // run before the parser has reached it. `runOrAfterDomReady` already
      // handles the readyState branching for UI mount; for the load path
      // we need to actually await.
      await this.awaitDomReady();
      if (this.disposed) return;
      if (!reviewModeActive()) return;

      ensureHighlightStyles();
      this.attachUI();

      if (!this.state.store) {
        await this.loadModelFromStore(new HttpSidecarStore());
      }
    } finally {
      this.readyResolve();
    }
  }

  /**
   * Range-first save shim retained for the test handle, which captures a
   * Range and submits in one step. Production goes through
   * `saveAnchoredComment` directly so the anchor can be frozen at
   * popover-click time, decoupled from any DOM mutation between click and
   * submit.
   */
  async saveComment(range: Range, body: string): Promise<Comment> {
    return this.saveAnchoredComment(anchor.fromRange(range), body);
  }

  /**
   * Persist an already-encoded Anchor with body text. Decoupling the
   * encode step (caller-owned, at popover-click time) from the disk write
   * protects against DOM mutations between click and submit shifting the
   * source range. Rolls back the in-memory model on write failure so a
   * later `reanchor()` can't silently overwrite the unsaved comment from
   * disk.
   */
  async saveAnchoredComment(a: Anchor, body: string): Promise<Comment> {
    if (!this.state.store) {
      throw new Error('saveComment: store not bound — call __init() first in test mode, or wait for whenReady()');
    }
    const id = 'c-' + crypto.randomUUID();
    const comment: Comment = {
      id,
      anchor: a,
      body,
      author: 'user',
      created_at: new Date().toISOString(),
    };
    const prevModel = this.state.model;
    // Always heal `doc` and `schema` from current state on save, so a
    // loaded sidecar with stale or missing top-level fields (or a future
    // schema bump) gets corrected on the next write rather than persisted
    // forward.
    const nextModel: CommentsModel = {
      doc: currentBasename(),
      schema: 1,
      comments: prevModel ? [...prevModel.comments, comment] : [comment],
    };
    try {
      await this.state.store.save(currentBasename(), nextModel);
    } catch (err) {
      // Rollback: the disk write failed, so the in-memory model must not
      // reflect the unwritten comment. Without this, a subsequent
      // reanchor() would silently replace it with the on-disk version
      // anyway, but callers who consult getModel() in between would see
      // a phantom entry.
      this.state.model = prevModel;
      throw err;
    }
    this.state.model = nextModel;
    this.rebuildHighlights();
    return comment;
  }

  /**
   * Re-resolve every anchor against the live DOM. Intended for use after
   * host-page mutations that may have shifted or orphaned existing
   * anchors — the purpose is DOM-side anchor resolution, not data refetch.
   * No-ops when no store has been bound (review mode not active).
   *
   * Deliberately does NOT reload the model: the v2 inline seed is frozen
   * at page load, so a re-read would clobber any saves made during this
   * session with the stale on-load snapshot. The agent reads the on-disk
   * sidecar directly; User sees freshest state on next reload.
   */
  async reanchor(): Promise<void> {
    if (!this.state.store) return;
    this.rebuildHighlights();
  }

  /**
   * Tear down the UI (DOM + listeners), drop in-memory state, clear the
   * CSS Custom Highlight, and mark the instance disposed so any deferred
   * work scheduled during init bails out. Called by `resetActiveWidget`
   * to swap a fresh widget into `activeWidget`; never called from
   * production code.
   */
  unmount(): void {
    this.disposed = true;
    // Clear visible/global state first so subscribers observe the cleared
    // state when they're notified.
    const cssHi = (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights;
    if (cssHi) cssHi.delete(HIGHLIGHT_NAME);
    this.state.highlightRanges.clear();
    this.state.model = null;
    // Notify subscribers BEFORE `ui.unmount()` runs, because the UI's
    // detacher unsubscribes refreshGutter from `this.listeners` — leaving
    // the post-detach notify loop empty. Notifying first lets the gutter
    // render its "cleared" state once, and gives any future non-UI
    // subscriber a real unmount signal.
    for (const cb of Array.from(this.listeners)) {
      try { cb(); } catch (err) { console.error('[htmldocs-cmt] listener threw on unmount:', err); }
    }
    // Tear down UI (also runs the highlights unsubscribe inside detachers).
    if (this.ui) {
      this.ui.unmount();
      this.ui = null;
    }
    this.listeners.clear();
    this.state.store = null;
  }

  /**
   * Resolves every comment's anchor against the live DOM and republishes
   * the single `htmldocs-cmt` CSS Custom Highlight. Per-comment Highlight
   * names were rejected for v1 — they'd force a stylesheet rewrite on
   * every save without any styling benefit. Always notifies listeners
   * afterward.
   *
   * Disposed-guard: skip entirely if `unmount()` already ran. The CSS
   * Custom Highlight registry is a global keyed by HIGHLIGHT_NAME — an
   * in-flight save/reanchor that resolves after disposal would otherwise
   * republish the orphan instance's ranges over whatever the fresh
   * widget already published.
   */
  private rebuildHighlights(): void {
    if (this.disposed) return;
    this.state.highlightRanges.clear();
    const cssHi = (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights;
    if (cssHi) cssHi.delete(HIGHLIGHT_NAME);
    if (this.state.model) {
      const ranges: Range[] = [];
      for (const c of this.state.model.comments) {
        const r = anchor.toRange(c.anchor);
        if (r) {
          this.state.highlightRanges.set(c.id, r);
          ranges.push(r);
        }
      }
      if (cssHi && typeof Highlight !== 'undefined' && ranges.length > 0) {
        cssHi.set(HIGHLIGHT_NAME, new Highlight(...ranges));
      }
    }
    // Notify gutter / future overlay layers. Snapshot the set before
    // iterating so a listener that subscribes/unsubscribes inside its
    // callback doesn't end up with non-obvious visit semantics. Errors in
    // one listener must not starve the others.
    for (const cb of Array.from(this.listeners)) {
      try { cb(); } catch (err) { console.error('[htmldocs-cmt] listener threw:', err); }
    }
  }

  /**
   * Bind an HttpSidecarStore, populate `state.model` from its seed, and
   * refresh the highlights.
   */
  private async loadModelFromStore(store: HttpSidecarStore): Promise<void> {
    this.state.model = await store.load(currentBasename());
    this.state.store = store;
    this.rebuildHighlights();
  }

  /**
   * Wire ui.ts's mountUI to instance state. Idempotent against
   * mid-disposal: if `disposed` flipped true while the DOMContentLoaded
   * handler was pending, this bails out — otherwise the new instance's
   * UI and this stale call's UI would race for popover/composer/gutter
   * positions.
   */
  private attachUI(): void {
    if (this.disposed || this.ui) return;
    this.ui = mountUI({
      encodeAnchor: anchor.fromRange,
      saveAnchoredComment: (a, b) => this.saveAnchoredComment(a, b),
      getHighlights: () => this.state.highlightRanges,
      onHighlightsChanged: (cb) => {
        this.listeners.add(cb);
        return () => { this.listeners.delete(cb); };
      },
    });
  }

  /**
   * Resolve once the document has reached `complete` (DOMContentLoaded has
   * fired and the deferred-script queue has drained). We deliberately do
   * NOT early-return on `interactive` — at module-evaluation time the
   * parser has finished but DCL has not fired yet, and any other DCL
   * listener registered before us (e.g. a test seed injector) hasn't run.
   * Resuming at `interactive` would race the seed into a not-yet-injected
   * state and bail out of review mode.
   */
  private awaitDomReady(): Promise<void> {
    if (document.readyState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }
}

// The widget IS the page-level singleton — one tab, one widget. A `const`
// would force tests to either reload the page between resets or construct
// their own instance and never let the test handle drive a fresh widget.
// The `let` here is justified by the explicit lifecycle contract (one
// production widget per page; `resetActiveWidget` swaps it for tests)
// rather than by individual state fields needing reassignment.
let activeWidget = new CommentsWidget();

/**
 * Module-private singleton swap. Owns the active-widget reference because
 * the lifecycle contract is a module concern — `CommentsWidget` itself
 * knows nothing about tests or reset semantics. Tests reach this via
 * `__resetForTest` on the test handle. Outstanding async work on the old
 * widget may still resolve into its (now-orphaned) state; callers must
 * `await` in-flight saves before resetting.
 */
function resetActiveWidget(): void {
  activeWidget.unmount();
  activeWidget = new CommentsWidget();
  // No `init()` here — tests typically follow with `__init()` so they can
  // control when the load fires relative to fixture mutations.
}

// Publishes the test-only surface at `window.__htmldocsComments` when
// `?test=1` is present. Arrow wrappers re-read `activeWidget` on each call,
// so methods automatically target the current instance after a reset.
if (TEST_MODE) {
  const handle: TestHandle = {
    whenReady: () => activeWidget.whenReady(),
    __init: () => activeWidget.init(),
    __anchor: { fromRange: anchor.fromRange, toRange: anchor.toRange },
    __HttpSidecarStore: HttpSidecarStore,
    __resetForTest: resetActiveWidget,
    getModel: () => activeWidget.getModel(),
    getHighlights: () => activeWidget.getHighlights(),
    getOrphanCount: () => activeWidget.getOrphanCount(),
    saveComment: (r, b) => activeWidget.saveComment(r, b),
    reanchor: () => activeWidget.reanchor(),
  };
  window.__htmldocsComments = handle;
}

activeWidget.init().catch((err) => { console.error('[htmldocs-cmt] init failed:', err); });
