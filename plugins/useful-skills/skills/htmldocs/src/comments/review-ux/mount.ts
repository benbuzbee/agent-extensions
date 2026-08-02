// Shared lifecycle class (slimmed CommentsWidget). Receives MountDeps.
// Owns: rebuildHighlights, reanchor, saveAnchoredComment, awaitDomReady,
// attachUI, unmount, test-handle wiring. Does NOT construct store or author.

import type { Anchor, Comment, CommentsSeed, Thread } from './types';
import * as anchor from './anchor';
import { ensureHighlightStyles, HIGHLIGHT_NAME } from './highlight';
import { buildGutter, renderGutter } from './gutter';
import { buildPopover, positionPopover, selectionInDocBody } from './popover';
import { buildComposer, wireComposer } from './composer';
import type { MountDeps, ICommentsStore } from './store';

// Styles for the UI elements (popover, composer, gutter) — kept in styles.css
// for readability and lint/auditability; esbuild's text loader inlines it into
// the bundle as a string (see css.d.ts). Adopted once.
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

function reviewModeActive(): boolean {
  return !!document.getElementById('__htmldocs_comments');
}

interface MountedUI {
  unmount(): void;
}

export class CommentsMount {
  private readonly store: ICommentsStore;
  private threads: Thread[] = [];
  // Whether the seed has been parsed (distinguishes "loaded, zero threads" from
  // "never mounted" — getModel() returns null only in the latter case).
  private loaded = false;
  private highlightRanges: Map<string, Range> = new Map();
  private readonly listeners = new Set<() => void>();
  private readyResolve!: () => void;
  private readonly readyPromise: Promise<void> = new Promise<void>((r) => {
    this.readyResolve = r;
  });
  private ui: MountedUI | null = null;
  private disposed = false;
  private readonly deps: MountDeps;

  constructor(deps: MountDeps) {
    this.deps = deps;
    this.store = deps.store;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  // The internal { threads } view — the same shape the seed and the GET
  // ?comments response carry. Null until the seed is parsed (never-mounted).
  getModel(): CommentsSeed | null {
    return this.loaded
      ? (JSON.parse(JSON.stringify({ threads: this.threads })) as CommentsSeed)
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
    if (!this.loaded) return 0;
    return this.threads.length - this.highlightRanges.size;
  }

  async init(): Promise<void> {
    try {
      await this.awaitDomReady();
      if (this.disposed) return;
      if (!reviewModeActive()) return;

      ensureHighlightStyles();
      ensureStyles();
      this.attachUI();

      if (!this.loaded) {
        this.loadModelFromSeed();
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
    this.loaded = false;
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
    if (this.loaded) {
      const ranges: Range[] = [];
      for (const thread of this.threads) {
        const r = anchor.toRange(thread.anchor);
        if (r) {
          this.highlightRanges.set(thread.id, r);
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

  // Parse the inline seed straight into this.threads. The seed is the internal
  // { threads } view (mirrors the GET ?comments response) — no legacy
  // conversion. Any missing/empty/malformed seed loads as zero threads (mounted
  // with a clean slate), so the widget never trips on junk.
  private loadModelFromSeed(): void {
    this.loaded = true;
    this.threads = [];
    const SEED_ELEMENT_ID = '__htmldocs_comments';
    const node = document.getElementById(SEED_ELEMENT_ID);
    const text = node?.textContent || '';
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as { threads?: unknown };
        if (Array.isArray(parsed.threads)) {
          this.threads = parsed.threads.filter(isThread);
        }
      } catch { /* malformed seed — mount with zero threads */ }
    }
    this.rebuildHighlights();
  }

  private attachUI(): void {
    if (this.disposed || this.ui) return;
    // buildPopover/buildGutter append themselves to document.body; buildComposer
    // returns a detached <dialog> that we append here, so this method owns the
    // composer's placement and removal (unmount calls composer.remove()).
    const popover = buildPopover();
    const popoverBtn = popover.querySelector('button') as HTMLButtonElement;
    const composer = buildComposer();
    document.body.appendChild(composer);
    const textarea = composer.querySelector('textarea') as HTMLTextAreaElement;
    const gutter = buildGutter();

    let pendingAnchor: Anchor | null = null;
    const detachers: Array<() => void> = [];

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

    popoverBtn.addEventListener('click', () => {
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
    });

    wireComposer(
      composer,
      { saveAnchoredComment: (a, b) => this.saveAnchoredComment(a, b) },
      () => pendingAnchor,
      () => { pendingAnchor = null; },
    );

    const refreshGutter = (): void => renderGutter(gutter, this.highlightRanges, this.threads);
    const unsubscribeHighlights = this.onHighlightsChanged(refreshGutter);
    detachers.push(unsubscribeHighlights);
    window.addEventListener('resize', refreshGutter);
    detachers.push(() => window.removeEventListener('resize', refreshGutter));
    refreshGutter();

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

// Tolerant Thread-shape guard for one seed entry: enough structure to render an
// anchored root. Deliberately loose — a malformed entry is skipped, never
// thrown on, so a partially-bad seed still paints its good threads.
function isThread(t: unknown): t is Thread {
  if (!t || typeof t !== 'object') return false;
  const x = t as Record<string, unknown>;
  if (typeof x.id !== 'string') return false;
  const a = x.anchor as Record<string, unknown> | undefined;
  if (!a || typeof a !== 'object' || typeof a.exact !== 'string') return false;
  const root = x.root as Record<string, unknown> | undefined;
  if (!root || typeof root !== 'object' || typeof root.body !== 'string') return false;
  return true;
}
