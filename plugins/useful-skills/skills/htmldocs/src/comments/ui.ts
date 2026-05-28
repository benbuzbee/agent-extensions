// Comment-widget UI layer. Stays out of state/IO concerns — the widget
// hands in the few accessors it needs via mountUI(deps). Responsibilities:
//
//   * Selection-driven popover ("💬" button hovering over a selection inside
//     an <article>).
//   * <dialog> composer that captures body text and submits.
//   * Margin gutter that renders one bubble per resolved highlight, aligned
//     vertically to the highlight's bounding rect.
//   * One stylesheet (separate from main.ts's banner sheet) injecting all of
//     the above under `--htmldocs-cmt-*` custom properties, with a
//     dark-mode block.
//
// mountUI is one-shot — it builds the UI and returns a MountedUI handle with
// `unmount()` for teardown. The CommentsWidget owns the handle and calls
// unmount on instance disposal (test reset, future v2 multi-instance). The
// shared stylesheet is created once per module and re-adopted across mounts
// rather than re-injected.

import type { Anchor, Comment } from './types';

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
`;

export interface MountDeps {
  /** Encode a live Range as an Anchor at popover-click time, so the
   * encoded form is frozen before any DOM mutation between click and
   * submit can shift the source nodes. */
  encodeAnchor(range: Range): Anchor;
  /** Persist a comment whose anchor was captured earlier. Handles picker
   * bootstrap and sidecar write. */
  saveAnchoredComment(anchor: Anchor, body: string): Promise<Comment>;
  /** Snapshot of resolved commentId → Range, used to lay out the gutter. */
  getHighlights(): Map<string, Range>;
  /** Subscribe to highlight-rebuilds so the gutter can refresh. Returns an
   * unsubscribe fn — invoked from `MountedUI.unmount` to stop the gutter
   * from re-rendering against a torn-down DOM. */
  onHighlightsChanged(cb: () => void): () => void;
}

/**
 * Handle returned by `mountUI`. `unmount()` removes the popover/composer/
 * gutter nodes from the DOM and detaches every document/window listener the
 * mount installed, so a fresh `mountUI` call on the same page lands cleanly.
 */
export interface MountedUI {
  unmount(): void;
}

// Single shared stylesheet across mounts. Created lazily on first mount and
// re-adopted into `document.adoptedStyleSheets` if it's been removed (e.g.
// by a test). Re-adopt is idempotent — `includes` keeps the array at one
// copy. A `const` here would force eager construction at module load, which
// fails outside browsers (CSSStyleSheet is undefined in Node); the `let`
// keeps construction inside the browser-only mount path.
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

// Builds the floating "💬" affordance shown above an active selection.
// Plain positioned div, not a `[popover]` element: the Popover API's UA
// rule `[popover]:not(:popover-open) { display: none }` fights manual
// visibility toggling, and we don't need top-layer placement (the composer
// dialog handles that).
function buildPopover(): HTMLElement {
  const popover = document.createElement('div');
  popover.className = 'htmldocs-cmt-popover';
  popover.hidden = true;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'htmldocs-cmt-popover-btn';
  btn.setAttribute('aria-label', 'Add comment');
  btn.textContent = '💬';
  popover.appendChild(btn);
  document.body.appendChild(popover);
  return popover;
}

// Builds the modal `<dialog>` for entering comment body text. Native
// `<dialog>` gives top-layer placement, ESC-to-close, and backdrop styling
// without a focus-trap library.
function buildComposer(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'htmldocs-cmt-composer';
  dialog.innerHTML =
    '<form method="dialog">' +
    '<label><textarea class="htmldocs-cmt-composer-body" required ' +
    'placeholder="Leave a comment…" aria-label="Comment body"></textarea></label>' +
    '<div class="htmldocs-cmt-composer-error" role="alert"></div>' +
    '<div class="htmldocs-cmt-composer-actions">' +
    '<button type="button" class="htmldocs-cmt-composer-cancel">Cancel</button>' +
    '<button type="submit" class="htmldocs-cmt-composer-submit">Comment</button>' +
    '</div>' +
    '</form>';
  document.body.appendChild(dialog);
  return dialog;
}

function buildGutter(): HTMLElement {
  const gutter = document.createElement('div');
  gutter.className = 'htmldocs-cmt-gutter';
  document.body.appendChild(gutter);
  return gutter;
}

// Position the popover near the selection's bounding rect. Pinned to the
// viewport (position:fixed) so it doesn't drift when the user scrolls
// between selection and click.
function positionPopover(popover: HTMLElement, rect: DOMRect): void {
  const margin = 6;
  const top = Math.max(margin, rect.top - 32);
  const left = Math.max(margin, rect.left + rect.width / 2 - 16);
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

// Selection must intersect at least one <article> in the document for the
// popover to appear. "Intersects" rather than "is contained by" so a drag
// that spans two adjacent articles still qualifies — the contained-by check
// failed because the range's commonAncestor was the wrapper above both.
// querySelectorAll is called per selectionchange; doc article counts are
// small in practice, but if it ever becomes a hotspot, cache at mount time
// and refresh on a MutationObserver.
function selectionTouchesArticle(sel: Selection): Range | null {
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  for (const a of Array.from(document.querySelectorAll('article'))) {
    if (range.intersectsNode(a)) return range;
  }
  return null;
}

function renderGutter(gutter: HTMLElement, highlights: Map<string, Range>): void {
  gutter.replaceChildren();
  for (const [id, range] of highlights) {
    const rect = range.getBoundingClientRect();
    // Skip degenerate rects — a Range that resolved but points at an
    // offscreen / display:none subtree would otherwise stamp a bubble at
    // (0,0).
    if (rect.width === 0 && rect.height === 0) continue;
    const bubble = document.createElement('div');
    bubble.className = 'htmldocs-cmt-bubble';
    bubble.dataset.commentId = id;
    bubble.textContent = '💬';
    bubble.style.top = `${rect.top + window.scrollY + rect.height / 2}px`;
    bubble.style.right = '0.5rem';
    gutter.appendChild(bubble);
  }
}

/**
 * Mount the comment UI: stylesheet, popover, composer, gutter. One-shot —
 * the returned `MountedUI.unmount()` is the symmetric teardown. The
 * CommentsWidget calls mountUI exactly once per instance; mid-mount throws
 * leave partial DOM that the next instance's mount will see, so the widget
 * holds the handle and tears down on disposal rather than relying on a
 * sentinel guard.
 */
export function mountUI(deps: MountDeps): MountedUI {
  ensureStyles();

  const popover = buildPopover();
  const popoverBtn = popover.querySelector('button') as HTMLButtonElement;
  const composer = buildComposer();
  const textarea = composer.querySelector('textarea') as HTMLTextAreaElement;
  const errorSlot = composer.querySelector('.htmldocs-cmt-composer-error') as HTMLElement;
  const cancelBtn = composer.querySelector('.htmldocs-cmt-composer-cancel') as HTMLButtonElement;
  const submitBtn = composer.querySelector('.htmldocs-cmt-composer-submit') as HTMLButtonElement;
  const gutter = buildGutter();

  // Captured at popover-click time. The Anchor is the *encoded* form — a
  // plain object, immune to DOM mutations between click and submit. The
  // raw Range would have been fragile because its boundary points stay
  // live; a host MutationObserver / a re-anchor pass mid-modal could shift
  // the offsets after capture.
  let pendingAnchor: Anchor | null = null;
  let saveInFlight = false;

  // Detachers for document/window-scoped listeners — these survive past DOM
  // removal of our nodes, so unmount() must run them explicitly to avoid a
  // torn-down closure firing against stale references. Listeners scoped to
  // popover/composer/gutter nodes die with the nodes themselves.
  const detachers: Array<() => void> = [];

  function hidePopover(): void {
    popover.hidden = true;
  }

  function showPopoverFor(range: Range): void {
    const rect = range.getBoundingClientRect();
    // A selection inside a display:none ancestor (collapsed accordion,
    // hidden tab pane) yields a 0×0 rect; pinning the popover at
    // (margin, margin) would float a stray 💬 at the viewport corner.
    if (rect.width === 0 && rect.height === 0) { hidePopover(); return; }
    popover.hidden = false;
    positionPopover(popover, rect);
  }

  const onSelectionChange = (): void => {
    if (composer.open) return;
    const sel = document.getSelection();
    if (!sel) { hidePopover(); return; }
    const range = selectionTouchesArticle(sel);
    if (!range) { hidePopover(); return; }
    showPopoverFor(range);
  };
  document.addEventListener('selectionchange', onSelectionChange);
  detachers.push(() => document.removeEventListener('selectionchange', onSelectionChange));

  popoverBtn.addEventListener('click', () => {
    const sel = document.getSelection();
    const range = sel ? selectionTouchesArticle(sel) : null;
    if (!range) { hidePopover(); return; }
    // Encode immediately — frozen against DOM mutations between here and
    // the eventual submit.
    pendingAnchor = deps.encodeAnchor(range);
    hidePopover();
    textarea.value = '';
    errorSlot.textContent = '';
    composer.showModal();
    textarea.focus();
  });

  function setSaveInFlight(busy: boolean): void {
    saveInFlight = busy;
    submitBtn.disabled = busy;
    // Cancel is fine to keep enabled — user may want to back out of a
    // long-running save (best-effort: the in-flight promise still
    // resolves, but the dialog state is cleared).
  }

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    if (saveInFlight) return;
    const body = textarea.value.trim();
    if (!body || !pendingAnchor) { composer.close(); return; }
    errorSlot.textContent = '';
    const anchorToSave = pendingAnchor;
    setSaveInFlight(true);
    void deps.saveAnchoredComment(anchorToSave, body)
      .then(() => {
        pendingAnchor = null;
        setSaveInFlight(false);
        composer.close();
      })
      .catch((err: unknown) => {
        setSaveInFlight(false);
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'AbortError' || name === 'NotAllowedError') {
          // User cancelled the directory picker (or the browser rejected
          // it for lack of user activation). Don't render the raw browser
          // message — surface a friendlier line and leave the dialog open
          // so the user can retry.
          errorSlot.textContent =
            'Pick a folder to save your comments, then submit again.';
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        errorSlot.textContent = msg;
      });
  });

  cancelBtn.addEventListener('click', () => {
    pendingAnchor = null;
    composer.close();
  });
  composer.addEventListener('close', () => {
    // The browser fires `close` on Esc too — drop the pending anchor so a
    // stray re-submit can't reuse it after the user dismissed the dialog.
    pendingAnchor = null;
  });

  const refreshGutter = (): void => renderGutter(gutter, deps.getHighlights());
  const unsubscribeHighlights = deps.onHighlightsChanged(refreshGutter);
  detachers.push(unsubscribeHighlights);
  window.addEventListener('resize', refreshGutter);
  detachers.push(() => window.removeEventListener('resize', refreshGutter));
  // Initial render in case highlights were loaded before mount.
  refreshGutter();

  return {
    unmount(): void {
      // Detach document/window listeners first so a late event during
      // node removal can't re-enter into a half-torn closure. Each
      // detacher runs inside try/catch so a future one that throws
      // (e.g. an unsubscribe with extra logic) can't strand the
      // remaining listeners or the popover/composer/gutter node
      // removals below.
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
