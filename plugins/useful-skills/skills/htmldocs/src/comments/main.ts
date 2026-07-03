// htmldocs review-mode comments widget — entry point.
//
// Thin entry: imports review-ux/mount.ts + BOTH adapters' deps builders, then
// chooseDeps() selects hosted-vs-local off the injected seed's top-level author
// (present only on the hosted Worker path; absent locally, so local behavior is
// byte-identical). Hands the chosen MountDeps to mount. Exposes a test handle at
// window.__htmldocsComments.
//
// The TS sources here compile via esbuild into ../../dist/comments.mjs
// (linguist-generated, checked in). Edit the .ts; rebuild with `npm run build`.

import type { Comment, CommentsSeed, Author } from './review-ux/types';
import { parseAuthor } from './review-ux/types';
import type { AnchorAPI } from './review-ux/anchor';
import type { MountDeps, ICommentsStore } from './review-ux/store';
import * as anchor from './review-ux/anchor';
import { CommentsMount } from './review-ux/mount';
import { buildLocalDeps } from './adapters/local/deps';
import { buildHostedDeps } from './adapters/hosted/deps';
import { HttpCommentsStore } from './adapters/http-store';
import { chooseDeps } from './adapters/runtime-select';

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

// Wire MountDeps from the adapter the injected seed selects. Both runtimes build
// the SAME HttpCommentsStore over the ?comments API; the seed's top-level author
// only picks the AUTHOR — present means a hosted doc (real GitHub identity),
// absent means the local path (fixed "user"). Local behavior stays identical.
// chooseDeps constructs the store, so deps are always fully built here and the
// widget is constructed with them (never nullable, never re-wired after).
function buildDeps(): MountDeps {
  return chooseDeps(seededAuthor(), buildHostedDeps, buildLocalDeps);
}

let activeDeps: MountDeps = buildDeps();
let activeWidget = new CommentsMount(activeDeps);

// Re-mount with fresh deps re-read from the current DOM seed. Tests inject the
// seed one tick after module load (see hosted-store.spec.js), so reset is where
// the hosted-vs-local selection actually gets exercised.
function resetActiveWidget(): void {
  activeWidget.unmount();
  activeDeps = buildDeps();
  activeWidget = new CommentsMount(activeDeps);
}

// Read the reviewer identity off the injected JSON seed. The hosted Worker
// stamps a top-level `author` (from the captured session); the local seed never
// does. Its presence is the hosted-vs-local discriminator. Tolerant: any parse
// or shape problem falls back to null (-> local), so a malformed seed can never
// force the hosted path.
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
