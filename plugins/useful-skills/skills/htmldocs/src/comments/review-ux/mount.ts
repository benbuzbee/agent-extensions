// Shared lifecycle class (slimmed CommentsWidget). Receives MountDeps.
// Owns: rebuildHighlights, reanchor, saveAnchoredComment, awaitDomReady,
// attachUI, unmount, test-handle wiring. Does NOT construct store or author.

import type { Anchor, Comment, CommentsModel, Thread } from './types';
import { threadToLegacy, legacyToThread } from './types';
import * as anchor from './anchor';
import { ensureHighlightStyles, HIGHLIGHT_NAME } from './highlight';
import { buildGutter, renderGutter } from './gutter';
import { buildPopover, positionPopover, selectionInDocBody } from './popover';
import { buildComposer, wireComposer } from './composer';
import type { MountDeps, ICommentsStore } from './store';

// Styles for the UI elements (popover, composer, gutter). Adopted once.
const STYLES = `
:root {
  --htmldocs-cmt-bubble-bg: #fff8c5;
  --htmldocs-cmt-bubble-fg: #57452a;
  --htmldocs-cmt-bubble-border: #e5d68a;
  --htmldocs-cmt-popover-bg: #ffffff;
  --htmldocs-cmt-popover-fg: #1a1a1a;
  --htmldocs-cmt-popover-border: #d4d4d0;
  --htmldocs-cmt-popover-shadow: 0 2px 8px rgba(0, 0, 0, .15);
  --htmldocs-cmt-dialog-bg: #ffffff;
  --htmldocs-cmt-dialog-fg: #1a1a1a;
  --htmldocs-cmt-dialog-border: #d4d4d0;
  --htmldocs-cmt-error-fg: #a02020;
}
@media (prefers-color-scheme: dark) {
  :root {
    --htmldocs-cmt-bubble-bg: #3d3520;
    --htmldocs-cmt-bubble-fg: #ffd97a;
    --htmldocs-cmt-bubble-border: #6a5a20;
    --htmldocs-cmt-popover-bg: #1a1d23;
    --htmldocs-cmt-popover-fg: #e6e6e6;
    --htmldocs-cmt-popover-border: #2a2e36;
    --htmldocs-cmt-popover-shadow: 0 2px 8px rgba(0, 0, 0, .6);
    --htmldocs-cmt-dialog-bg: #1a1d23;
    --htmldocs-cmt-dialog-fg: #e6e6e6;
    --htmldocs-cmt-dialog-border: #2a2e36;
    --htmldocs-cmt-error-fg: #ff8a8a;
  }
}
.htmldocs-cmt-popover {
  position: fixed;
  z-index: 2147483646;
  padding: 0;
  margin: 0;
  background: var(--htmldocs-cmt-popover-bg);
  color: var(--htmldocs-cmt-popover-fg);
  border: 1px solid var(--htmldocs-cmt-popover-border);
  border-radius: 6px;
  box-shadow: var(--htmldocs-cmt-popover-shadow);
  font: 13px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.htmldocs-cmt-popover button {
  background: transparent;
  color: inherit;
  border: 0;
  padding: .35rem .55rem;
  font: inherit;
  cursor: pointer;
  border-radius: 5px;
}
.htmldocs-cmt-popover button:hover { background: var(--htmldocs-cmt-popover-border); }
.htmldocs-cmt-composer {
  border: 1px solid var(--htmldocs-cmt-dialog-border);
  border-radius: 6px;
  padding: 1rem;
  background: var(--htmldocs-cmt-dialog-bg);
  color: var(--htmldocs-cmt-dialog-fg);
  min-width: min(28rem, 90vw);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.htmldocs-cmt-composer::backdrop { background: rgba(0, 0, 0, .25); }
.htmldocs-cmt-composer form { display: flex; flex-direction: column; gap: .75rem; }
.htmldocs-cmt-composer textarea {
  width: 100%;
  min-height: 6rem;
  box-sizing: border-box;
  font: inherit;
  padding: .5rem;
  border: 1px solid var(--htmldocs-cmt-dialog-border);
  border-radius: 4px;
  background: inherit;
  color: inherit;
  resize: vertical;
}
.htmldocs-cmt-composer-actions { display: flex; gap: .5rem; justify-content: flex-end; }
.htmldocs-cmt-composer-actions button {
  font: inherit;
  padding: .35rem .9rem;
  border-radius: 4px;
  border: 1px solid var(--htmldocs-cmt-dialog-border);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.htmldocs-cmt-composer-actions button[type="submit"] {
  background: var(--htmldocs-cmt-bubble-bg);
  color: var(--htmldocs-cmt-bubble-fg);
  border-color: var(--htmldocs-cmt-bubble-border);
}
.htmldocs-cmt-composer-error {
  color: var(--htmldocs-cmt-error-fg);
  font-size: .88em;
  min-height: 1.1em;
}
.htmldocs-cmt-gutter {
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 2147483645;
}
.htmldocs-cmt-bubble {
  position: absolute;
  width: 1.4rem;
  height: 1.4rem;
  line-height: 1.4rem;
  text-align: center;
  border-radius: 50%;
  background: var(--htmldocs-cmt-bubble-bg);
  color: var(--htmldocs-cmt-bubble-fg);
  border: 1px solid var(--htmldocs-cmt-bubble-border);
  font: 12px/1 ui-sans-serif, system-ui, sans-serif;
  pointer-events: auto;
  cursor: default;
  transform: translateY(-50%);
}
.htmldocs-cmt-bubble--resolved {
  background: #c8e6c9;
  border-color: #81c784;
  color: #2e7d32;
}
@media (prefers-color-scheme: dark) {
  .htmldocs-cmt-bubble--resolved {
    background: #1b5e20;
    border-color: #388e3c;
    color: #a5d6a7;
  }
}
`;

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

export class CommentsMount {
  private store: ICommentsStore | null = null;
  private threads: Thread[] = [];
  private model: CommentsModel | null = null;
  private highlightRanges: Map<string, Range> = new Map();
  private readonly listeners = new Set<() => void>();
  private readyResolve!: () => void;
  private readonly readyPromise: Promise<void> = new Promise<void>((r) => {
    this.readyResolve = r;
  });
  private ui: MountedUI | null = null;
  private disposed = false;
  private deps: MountDeps | null = null;

  setDeps(deps: MountDeps): void {
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

      if (this.store && !this.model) {
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
    if (!this.store || !this.deps) {
      throw new Error('saveComment: store not bound — call __init() first in test mode, or wait for whenReady()');
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
    if (!this.store) return;
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
    this.store = null;
    this.deps = null;
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
    if (!isWellShaped(parsed)) {
      this.model = { doc: currentBasename(), schema: 1, comments: [] };
      this.threads = [];
      this.rebuildHighlights();
      return;
    }
    this.model = parsed;
    this.threads = parsed.comments.map(legacyToThread);
    this.rebuildHighlights();
  }

  private attachUI(): void {
    if (this.disposed || this.ui) return;
    const popover = buildPopover();
    const popoverBtn = popover.querySelector('button') as HTMLButtonElement;
    const composer = buildComposer();
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

// Shape check matching serve.ts's isWellShapedModel. Keep in sync.
function isWellShapedComment(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  if (typeof x.id !== 'string' || typeof x.body !== 'string') return false;
  if (typeof x.author !== 'string' || typeof x.created_at !== 'string') return false;
  if (!x.anchor || typeof x.anchor !== 'object') return false;
  const a = x.anchor as Record<string, unknown>;
  if (!Array.isArray(a.sections) || !a.sections.every((s: unknown) => typeof s === 'string')) return false;
  return typeof a.prefix === 'string'
    && typeof a.exact === 'string' && typeof a.suffix === 'string';
}

function isWellShaped(parsed: unknown): parsed is CommentsModel {
  if (!parsed || typeof parsed !== 'object') return false;
  const m = parsed as Partial<CommentsModel>;
  if (typeof m.doc !== 'string' || m.schema !== 1 || !Array.isArray(m.comments)) return false;
  return m.comments.every(isWellShapedComment);
}
