// htmldocs review-mode comments widget — entry point.
//
// Thin entry: imports review-ux/mount.ts + adapters/local/deps.ts, constructs
// MountDeps, delegates to mount. Exposes test handle at window.__htmldocsComments.
//
// The TS sources here compile via esbuild into ../../dist/comments.mjs
// (linguist-generated, checked in). Edit the .ts; rebuild with `npm run build`.

import type { AnchorAPI, Comment, CommentsModel } from './review-ux/types';
import * as anchor from './review-ux/anchor';
import { CommentsMount } from './review-ux/mount';
import { buildLocalDeps } from './adapters/local/deps';
import { LocalFileStore } from './adapters/local/local-file-store';

// Test-only surface exposed at window.__htmldocsComments. Lives here (the
// entry point that already imports both the shared layer and the local
// adapter) rather than in review-ux/, so the shared layer keeps zero
// references to any transport adapter — see review-ux/CLAUDE.md.
export interface TestHandle {
  whenReady(): Promise<void>;
  __init(): Promise<void>;
  __anchor: AnchorAPI;
  __LocalFileStore: typeof LocalFileStore;
  __resetForTest(): void;
  getModel(): CommentsModel | null;
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

// Build a widget wired to a fresh local adapter. CommentsMount requires its
// MountDeps (store + author) at construction, so deps are built here and the
// LocalFileStore reads the current inline seed each time.
function buildWidget(): CommentsMount {
  return new CommentsMount(buildLocalDeps());
}

let activeWidget = buildWidget();

function resetActiveWidget(): void {
  activeWidget.unmount();
  activeWidget = buildWidget();
}

if (TEST_MODE) {
  const handle: TestHandle = {
    whenReady: () => activeWidget.whenReady(),
    __init: () => activeWidget.init(),
    __anchor: { fromRange: anchor.fromRange, toRange: anchor.toRange },
    __LocalFileStore: LocalFileStore,
    __resetForTest: () => {
      resetActiveWidget();
    },
    getModel: () => activeWidget.getModel(),
    getHighlights: () => activeWidget.getHighlights(),
    getOrphanCount: () => activeWidget.getOrphanCount(),
    saveComment: (r: Range, b: string) => activeWidget.saveComment(r, b),
    reanchor: () => activeWidget.reanchor(),
  };
  window.__htmldocsComments = handle;
}

// Production path: init the widget (deps were wired at construction).
activeWidget.init().catch((err) => { console.error('[htmldocs-cmt] init failed:', err); });
