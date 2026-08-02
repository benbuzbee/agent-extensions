// Selection-driven popover.

/**
 * Builds the floating "comment" affordance shown above an active selection.
 */
export function buildPopover(): HTMLElement {
  const popover = document.createElement('div');
  popover.className = 'htmldocs-cmt-popover';
  popover.hidden = true;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'htmldocs-cmt-popover-btn';
  btn.setAttribute('aria-label', 'Add comment');
  btn.textContent = '💬'; // 💬
  popover.appendChild(btn);
  document.body.appendChild(popover);
  return popover;
}

/**
 * Position the popover near the selection's bounding rect. Pinned to the
 * viewport (position:fixed) so it doesn't drift on scroll.
 */
export function positionPopover(popover: HTMLElement, rect: DOMRect): void {
  const margin = 6;
  const top = Math.max(margin, rect.top - 32);
  const left = Math.max(margin, rect.left + rect.width / 2 - 16);
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

// Widget chrome class prefix — any element with a className containing this
// prefix is considered widget UI and excluded from the selection predicate.
const WIDGET_CHROME_PREFIX = 'htmldocs-cmt-';

/**
 * Check if a node (inclusive) has an ancestor with a className containing
 * the widget chrome prefix.
 */
function isInsideWidgetUI(node: Node): boolean {
  let current: Node | null = node;
  while (current && current !== document.body) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element;
      if (typeof el.className === 'string' && el.className.includes(WIDGET_CHROME_PREFIX)) {
        return true;
      }
    }
    current = current.parentNode;
  }
  return false;
}

/**
 * Returns the selection's Range if it is a real, in-document text selection:
 * 1. sel.rangeCount > 0
 * 2. The range is not collapsed
 * 3. Both range.startContainer and range.endContainer are inside document.body
 * 4. Neither endpoint has an ancestor with a className containing 'htmldocs-cmt-'
 *
 * Checking both endpoints prevents a cross-boundary selection spanning from
 * doc text into widget UI from passing the gate.
 */
export function selectionInDocBody(sel: Selection): Range | null {
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  // Both endpoints must be inside document.body
  if (!document.body.contains(range.startContainer)) return null;
  if (!document.body.contains(range.endContainer)) return null;
  // Neither endpoint may be inside widget UI
  if (isInsideWidgetUI(range.startContainer)) return null;
  if (isInsideWidgetUI(range.endContainer)) return null;
  return range;
}
