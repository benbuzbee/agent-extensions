// The review widget's per-document lifecycle class. Contract in the class doc below.

import type { Anchor, Comment, CommentsModel, Thread } from './types';
import { threadToLegacy, legacyToThread } from './types';
import * as anchor from './anchor';
import { ensureHighlightStyles, HIGHLIGHT_NAME } from './highlight';
import { buildGutter, renderGutter } from './gutter';
import { buildPopover, positionPopover, selectionInDocBody } from './popover';
import { buildComposer, wireComposer } from './composer';
import type { MountDeps, ICommentsStore } from './store';
// The UI stylesheet (popover, composer, gutter). Lives in styles.css and is
// inlined at build time by esbuild's text loader, so the single-file dist
// carries it with no runtime fetch. adoptStyles injects this string once.
import STYLES from './styles.css';


let sharedStylesheet: CSSStyleSheet | null = null;

function ensureStyles(): void {
  if (!sharedStylesheet) {
    sharedStylesheet = new CSSStyleSheet();
    sharedStylesheet.replaceSync(STYLES);
  }
  if (!document.adoptedStyleSheets.includes(sharedStylesheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sharedStylesheet];
  }
}

function currentBasename(): string {
  return location.pathname.split('/').pop() || 'index.html';
}

function reviewModeActive(): boolean {
  return !!document.getElementById('__htmldocs_comments');
}

interface MountedUI {
  unmount(): void;
}

/**
 * Owns the review widget's lifecycle for one document. In order: parse the
 * inline seed into the model, resolve each comment's anchor back to a live
 * Range, publish highlights and render the gutter, wire the popover and
 * composer, and turn user actions into store-backed mutations (create/save).
 *
 * Mount contract: construct with MountDeps (store + author), then call init()
 * once — it waits for the DOM, bails on non-review pages, and attaches the UI.
 * Unmount contract: unmount() is terminal — it detaches listeners, tears down
 * the UI, clears highlights, and marks the instance disposed. A disposed
 * instance is not reusable; callers construct a fresh one to remount.
 */
export class CommentsMount {
  private readonly store: ICommentsStore;
  private readonly deps: MountDeps;
  private threads: Thread[] = [];
  private model: CommentsModel | null = null;
  private highlightRanges: Map<string, Range> = new Map();
  private readonly listeners = new Set<() => void>();
  private readyResolve!: () => void;
  private readonly readyPromise: Promise<void> = new Promise<void>((r) => {
    this.readyResolve = r;
  });
  // Nullable by lifetime, not by dependency: the UI is built at attach time
  // (init → attachUI), so it is null before the first mount and after unmount.
  private ui: MountedUI | null = null;
  private disposed = false;

  constructor(deps: MountDeps) {
    this.deps = deps;
    this.store = deps.store;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  getModel(): CommentsModel | null {
    return this.model
      ? (JSON.parse(JSON.stringify(this.model)) as CommentsModel)
      : null;
  }

  getHighlights(): Map<string, Range> {
    const cloned = new Map<string, Range>();
    for (const [id, r] of this.highlightRanges) {
      cloned.set(id, r.cloneRange());
    }
    return cloned;
  }

  getOrphanCount(): number {
    if (!this.model) return 0;
    return this.model.comments.length - this.highlightRanges.size;
  }

  async init(): Promise<void> {
    try {
      await this.awaitDomReady();
      if (this.disposed) return;
      if (!reviewModeActive()) return;

      ensureHighlightStyles();
      ensureStyles();
      this.attachUI();

      if (!this.model) {
        await this.loadModelFromSeed();
      }
    } finally {
      this.readyResolve();
    }
  }

  async saveComment(range: Range, body: string): Promise<Comment> {
    return this.saveAnchoredComment(anchor.fromRange(range), body);
  }

  async saveAnchoredComment(a: Anchor, body: string): Promise<Comment> {
    if (this.disposed) {
      throw new Error('saveComment: widget unmounted');
    }
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const thread = await this.store.create(doc, { op: 'create', anchor: a, text: body }, this.deps.author);
    // Update in-memory model for backward compat
    const legacyComments = threadToLegacy(thread);
    const prevModel = this.model;
    this.model = {
      doc: currentBasename(),
      schema: 1,
      comments: prevModel ? [...prevModel.comments, ...legacyComments] : legacyComments,
    };
    this.threads.push(thread);
    this.rebuildHighlights();
    return thread.root;
  }

  async reanchor(): Promise<void> {
    if (this.disposed) return;
    this.rebuildHighlights();
  }

  unmount(): void {
    this.disposed = true;
    const cssHi = (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights;
    if (cssHi) cssHi.delete(HIGHLIGHT_NAME);
    this.highlightRanges.clear();
    this.model = null;
    this.threads = [];
    for (const cb of Array.from(this.listeners)) {
      try { cb(); } catch (err) { console.error('[htmldocs-cmt] listener threw on unmount:', err); }
    }
    if (this.ui) {
      this.ui.unmount();
      this.ui = null;
    }
    this.listeners.clear();
  }

  private rebuildHighlights(): void {
    if (this.disposed) return;
    this.highlightRanges.clear();
    const cssHi = (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights;
    if (cssHi) cssHi.delete(HIGHLIGHT_NAME);
    if (this.model) {
      const ranges: Range[] = [];
      for (const c of this.model.comments) {
        const a: Anchor = {
          exact: c.anchor.exact,
          prefix: c.anchor.prefix || undefined,
          suffix: c.anchor.suffix || undefined,
          sections: c.anchor.sections.length > 0 ? c.anchor.sections : undefined,
        };
        const r = anchor.toRange(a);
        if (r) {
          this.highlightRanges.set(c.id, r);
          ranges.push(r);
        }
      }
      if (cssHi && typeof Highlight !== 'undefined' && ranges.length > 0) {
        cssHi.set(HIGHLIGHT_NAME, new Highlight(...ranges));
      }
    }
    for (const cb of Array.from(this.listeners)) {
      try { cb(); } catch (err) { console.error('[htmldocs-cmt] listener threw:', err); }
    }
  }

  private async loadModelFromSeed(): Promise<void> {
    const SEED_ELEMENT_ID = '__htmldocs_comments';
    const node = document.getElementById(SEED_ELEMENT_ID);
    if (!node) {
      this.model = { doc: currentBasename(), schema: 1, comments: [] };
      this.threads = [];
      this.rebuildHighlights();
      return;
    }
    const text = node.textContent || '';
    if (!text.trim()) {
      this.model = { doc: currentBasename(), schema: 1, comments: [] };
      this.threads = [];
      this.rebuildHighlights();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.model = { doc: currentBasename(), schema: 1, comments: [] };
      this.threads = [];
      this.rebuildHighlights();
      return;
    }
    const shapeError = modelShapeError(parsed);
    if (shapeError) {
      console.error(`[htmldocs-cmt] ignoring malformed comments seed: ${shapeError}`);
      this.model = { doc: currentBasename(), schema: 1, comments: [] };
      this.threads = [];
      this.rebuildHighlights();
      return;
    }
    this.model = parsed as CommentsModel;
    this.threads = (parsed as CommentsModel).comments.map(legacyToThread);
    this.rebuildHighlights();
  }

  private attachUI(): void {
    if (this.disposed || this.ui) return;

    // Build the three UI pieces. buildPopover/buildGutter append themselves to
    // document.body; buildComposer returns a detached <dialog> that we append
    // here, so this method owns the composer's placement and removal.
    const popover = buildPopover();
    const popoverBtn = popover.querySelector('button') as HTMLButtonElement;
    const composer = buildComposer();
    document.body.appendChild(composer);
    const textarea = composer.querySelector('textarea') as HTMLTextAreaElement;
    const gutter = buildGutter();

    let pendingAnchor: Anchor | null = null;
    // Every listener wired below pushes its detacher here; MountedUI.unmount
    // runs them all so nothing survives a teardown.
    const detachers: Array<() => void> = [];

    // --- Selection tracking: show/hide the popover as the selection changes ---
    const hidePopover = (): void => { popover.hidden = true; };

    const showPopoverFor = (range: Range): void => {
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) { hidePopover(); return; }
      popover.hidden = false;
      positionPopover(popover, rect);
    };

    const onSelectionChange = (): void => {
      if (composer.open) return;
      const sel = document.getSelection();
      if (!sel) { hidePopover(); return; }
      const range = selectionInDocBody(sel);
      if (!range) { hidePopover(); return; }
      showPopoverFor(range);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    detachers.push(() => document.removeEventListener('selectionchange', onSelectionChange));

    // --- Popover wiring: clicking the affordance opens the composer on the
    // current selection, snapshotting it as the pending anchor. ---
    const onPopoverClick = (): void => {
      const sel = document.getSelection();
      const range = sel ? selectionInDocBody(sel) : null;
      if (!range) { hidePopover(); return; }
      pendingAnchor = anchor.fromRange(range);
      hidePopover();
      textarea.value = '';
      const errorSlot = composer.querySelector('.htmldocs-cmt-composer-error') as HTMLElement;
      if (errorSlot) errorSlot.textContent = '';
      composer.showModal();
      textarea.focus();
    };
    popoverBtn.addEventListener('click', onPopoverClick);
    detachers.push(() => popoverBtn.removeEventListener('click', onPopoverClick));

    // --- Composer wiring: submit/cancel/close handlers. Fold its detachers
    // into ours so unmount removes the composer's listeners too. ---
    const composerWiring = wireComposer(
      composer,
      { saveAnchoredComment: (a, b) => this.saveAnchoredComment(a, b) },
      () => pendingAnchor,
      () => { pendingAnchor = null; },
    );
    detachers.push(...composerWiring.detachers);

    // --- Highlight subscription + resize handling: re-render the gutter when
    // highlights change or the viewport resizes. ---
    const refreshGutter = (): void => renderGutter(gutter, this.highlightRanges, this.threads);
    const unsubscribeHighlights = this.onHighlightsChanged(refreshGutter);
    detachers.push(unsubscribeHighlights);
    window.addEventListener('resize', refreshGutter);
    detachers.push(() => window.removeEventListener('resize', refreshGutter));
    refreshGutter();

    // --- Cleanup registration: MountedUI.unmount detaches every listener and
    // removes the DOM nodes this method created. ---
    this.ui = {
      unmount(): void {
        for (const off of detachers) {
          try { off(); } catch (err) { console.error('[htmldocs-cmt] detacher threw:', err); }
        }
        detachers.length = 0;
        popover.remove();
        composer.remove();
        gutter.remove();
      },
    };
  }

  private onHighlightsChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private awaitDomReady(): Promise<void> {
    if (document.readyState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }
}

// Shape check matching serve.ts's isWellShapedModel. Keep in sync. Rather than
// flatten to a boolean, each returns null when the value is well-shaped or a
// human-readable reason naming the first failed check, so a malformed seed
// degrades to an empty model *visibly* — the caller logs the reason.
function commentShapeError(c: unknown, i: number): string | null {
  if (!c || typeof c !== 'object') return `comments[${i}] is not an object`;
  const x = c as Record<string, unknown>;
  if (typeof x.id !== 'string') return `comments[${i}].id is not a string`;
  if (typeof x.body !== 'string') return `comments[${i}].body is not a string`;
  if (typeof x.author !== 'string') return `comments[${i}].author is not a string`;
  if (typeof x.created_at !== 'string') return `comments[${i}].created_at is not a string`;
  if (!x.anchor || typeof x.anchor !== 'object') return `comments[${i}].anchor is not an object`;
  const a = x.anchor as Record<string, unknown>;
  if (!Array.isArray(a.sections) || !a.sections.every((s: unknown) => typeof s === 'string')) {
    return `comments[${i}].anchor.sections is not a string[]`;
  }
  if (typeof a.prefix !== 'string') return `comments[${i}].anchor.prefix is not a string`;
  if (typeof a.exact !== 'string') return `comments[${i}].anchor.exact is not a string`;
  if (typeof a.suffix !== 'string') return `comments[${i}].anchor.suffix is not a string`;
  return null;
}

function modelShapeError(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return 'seed is not an object';
  const m = parsed as Partial<CommentsModel>;
  if (typeof m.doc !== 'string') return 'seed.doc is not a string';
  if (m.schema !== 1) return `seed.schema is not 1 (got ${JSON.stringify(m.schema)})`;
  if (!Array.isArray(m.comments)) return 'seed.comments is not an array';
  for (let i = 0; i < m.comments.length; i++) {
    const err = commentShapeError(m.comments[i], i);
    if (err) return err;
  }
  return null;
}
