// htmldocs review-mode comments widget — entry point.
//
// Thin entry: builds MountDeps straight off the injected seed and hands them to
// mount. Every runtime serves the same { threads, author } seed over the same
// ?comments transport — the hosted Worker stamps the session's real GitHub
// identity, the local server stamps the fixed LOCAL_AUTHOR — so the widget just
// uses what it is given and never infers which runtime it is on. Exposes a test
// handle at window.__htmldocsComments.
//
// The TS sources here compile via esbuild into ../../dist/comments.mjs
// (linguist-generated, checked in). Edit the .ts; rebuild with `npm run build`.

import type { Comment, CommentsSeed, Author } from './review-ux/types';
import { parseAuthor } from './review-ux/types';
import type { AnchorAPI } from './review-ux/anchor';
import type { MountDeps, ICommentsStore } from './review-ux/store';
import * as anchor from './review-ux/anchor';
import { CommentsMount } from './review-ux/mount';
import { HttpCommentsStore } from './adapters/http-store';
import { LOCAL_AUTHOR } from './adapters/local/author';

// Test-only surface exposed at window.__htmldocsComments. Lives here (the
// entry point that already imports both the shared layer and the adapters)
// rather than in review-ux/, so the shared layer keeps zero references to any
// transport adapter — see review-ux/CLAUDE.md.
export interface TestHandle {
  whenReady(): Promise<void>;
  __init(): Promise<void>;
  __anchor: AnchorAPI;
  __HttpCommentsStore: typeof HttpCommentsStore;
  __resetForTest(): void;
  getModel(): CommentsSeed | null;
  getStore(): ICommentsStore | null;
  getHighlights(): Map<string, Range>;
  getOrphanCount(): number;
  saveComment(range: Range, body: string): Promise<Comment>;
  reanchor(): Promise<void>;
}

declare global {
  interface Window {
    __htmldocsComments?: TestHandle;
  }
}

const TEST_MODE = new URLSearchParams(location.search).has('test');

// Module-load sentinel.
(window as unknown as { __htmldocsModuleLoaded?: boolean }).__htmldocsModuleLoaded = true;

// Wire MountDeps straight off the injected seed: the shared HttpCommentsStore
// plus the seed's author. The LOCAL_AUTHOR fallback covers a missing or
// malformed seed, so the widget never mounts author-less; the server stays the
// authority on the stamp actually persisted. Deps are always fully built here
// and the widget is constructed with them (never nullable, never re-wired
// after).
function buildDeps(): MountDeps {
  return { store: new HttpCommentsStore(), author: seededAuthor() ?? LOCAL_AUTHOR };
}

let activeDeps: MountDeps = buildDeps();
let activeWidget = new CommentsMount(activeDeps);

// Re-mount with fresh deps re-read from the current DOM seed. Tests inject the
// seed one tick after module load (see hosted-store.spec.js), so reset is where
// the seed-author wiring actually gets exercised.
function resetActiveWidget(): void {
  activeWidget.unmount();
  activeDeps = buildDeps();
  activeWidget = new CommentsMount(activeDeps);
}

// Read the reviewer identity off the injected JSON seed (every runtime stamps
// one). Tolerant: any parse or shape problem yields null and buildDeps
// substitutes LOCAL_AUTHOR, so a malformed seed can never smuggle a partial
// identity into the widget.
function seededAuthor(): Author | null {
  const node = document.getElementById('__htmldocs_comments');
  if (!node) return null;
  const text = node.textContent || '';
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as { author?: unknown };
    return parseAuthor(parsed.author);
  } catch { /* malformed seed — treat as no author (local) */ }
  return null;
}

if (TEST_MODE) {
  const handle: TestHandle = {
    whenReady: () => activeWidget.whenReady(),
    __init: () => activeWidget.init(),
    __anchor: { fromRange: anchor.fromRange, toRange: anchor.toRange },
    __HttpCommentsStore: HttpCommentsStore,
    __resetForTest: () => {
      resetActiveWidget();
    },
    getModel: () => activeWidget.getModel(),
    getStore: () => activeDeps.store,
    getHighlights: () => activeWidget.getHighlights(),
    getOrphanCount: () => activeWidget.getOrphanCount(),
    saveComment: (r: Range, b: string) => activeWidget.saveComment(r, b),
    reanchor: () => activeWidget.reanchor(),
  };
  window.__htmldocsComments = handle;
}

// Production path: init the widget (deps were wired at construction).
activeWidget.init().catch((err) => { console.error('[htmldocs-cmt] init failed:', err); });
