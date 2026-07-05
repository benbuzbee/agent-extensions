// Margin-gutter thread bubbles. The gutter is the doc's right-margin strip
// where one bubble renders per commented range, each aligned to its
// highlight's midline. Resolved threads' bubbles carry the
// .htmldocs-cmt-bubble--resolved class (green indicator).

import type { Thread } from './types';

export function buildGutter(): HTMLElement {
  const gutter = document.createElement('div');
  gutter.className = 'htmldocs-cmt-gutter';
  document.body.appendChild(gutter);
  return gutter;
}

/**
 * Render one bubble per highlight, aligned vertically to the highlight's
 * bounding rect. Every highlight gets a bubble; a bubble whose thread is
 * resolved additionally gets the `.htmldocs-cmt-bubble--resolved` class
 * (green indicator). Degenerate (zero-size) rects are skipped.
 */
export function renderGutter(
  gutter: HTMLElement,
  highlights: Map<string, Range>,
  threads?: Thread[],
): void {
  gutter.replaceChildren();
  // Build a lookup of threadId -> resolvedAt for green styling
  const resolvedSet = new Set<string>();
  if (threads) {
    for (const t of threads) {
      if (t.resolvedAt !== null) resolvedSet.add(t.id);
    }
  }
  for (const [id, range] of highlights) {
    const rect = range.getBoundingClientRect();
    // Skip degenerate rects — a Range that resolved but points at an
    // offscreen / display:none subtree would otherwise stamp a bubble at (0,0).
    if (rect.width === 0 && rect.height === 0) continue;
    const bubble = document.createElement('div');
    bubble.className = 'htmldocs-cmt-bubble';
    if (resolvedSet.has(id)) {
      bubble.classList.add('htmldocs-cmt-bubble--resolved');
    }
    bubble.dataset.commentId = id;
    bubble.textContent = '💬'; // 💬
    bubble.style.top = `${rect.top + window.scrollY + rect.height / 2}px`;
    bubble.style.right = '0.5rem';
    gutter.appendChild(bubble);
  }
}
