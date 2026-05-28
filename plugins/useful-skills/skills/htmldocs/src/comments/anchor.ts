// W3C TextQuoteSelector encode/decode. The selector triple (prefix, exact,
// suffix) is the load-bearing locator; the `sections` array on each Anchor
// records which `<article id>` elements the selection intersects, purely as
// metadata for downstream agents (grouping / filtering). The decoder
// always searches the full document. 32-char prefix/suffix windows match
// Hypothesis. Whitespace is normalized for matching only; the returned
// Range points at live DOM, so range.toString() reflects whatever the live
// text actually contains.

import type { Anchor } from './types';

const WINDOW = 32;

// Element tags whose Text descendants should NOT count as visible prose
// (script source, style rules, fallback content). TreeWalker passes through
// element nodes regardless, so we filter at each text node by walking up.
const HIDDEN_TEXT_PARENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

// Widget chrome (popover, dialog composer, gutter bubbles) lives inside
// document.body because the widget appends to body at mount time. Their
// text content ("💬", "Cancel", "Comment", bubble emojis) would otherwise
// flow into the canonical stream, polluting prefix/suffix windows of
// selections near the end of the last article. Worse, bubble count is
// state-dependent — encode-time (mid-session, with prior bubbles rendered)
// and decode-time (post-reload, before refreshGutter runs) see different
// streams. We filter any element marked with this class prefix so the
// stream is stable across renders.
const WIDGET_CHROME_PREFIX = 'htmldocs-cmt-';

// Filters out text nodes that are technically in the DOM but not visible
// prose: <script>/<style>/<noscript>, plus any widget chrome the comments
// module itself added to the document.
function isHiddenText(node: Text): boolean {
  let p: Node | null = node.parentNode;
  while (p && p.nodeType === Node.ELEMENT_NODE) {
    const el = p as Element;
    if (HIDDEN_TEXT_PARENTS.has(el.tagName)) return true;
    if (typeof el.className === 'string' &&
        el.className.includes(WIDGET_CHROME_PREFIX)) return true;
    p = p.parentNode;
  }
  return false;
}

// Collects the ids of every `<article>` in `root` that the range
// intersects. Used as anchor metadata; never load-bearing for resolving
// the Range back. Articles without an id are skipped, and duplicate ids
// (a malformed doc could declare the same id on two <article>s) collapse
// to one entry so downstream `sections.includes(X)` filters behave like
// the set semantics they imply.
function touchedArticleIds(range: Range, root: ParentNode): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of Array.from(root.querySelectorAll('article'))) {
    if (!a.id || seen.has(a.id)) continue;
    if (range.intersectsNode(a)) {
      seen.add(a.id);
      out.push(a.id);
    }
  }
  return out;
}

// Produces the ordered visible-text stream that every other function in
// this file treats as the document's canonical character sequence.
function collectTextNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      isHiddenText(n as Text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

// Needed because a Range boundary can land on either a Text node (offset
// is a char index) or an Element (offset is a child index); the encoder
// needs both forms reduced to a single absolute character offset so it
// can slice prefix/suffix windows out of the document text.
//
// Text-anchored boundaries get a linear-scan node-identity match. Element-
// anchored boundaries (child-index offsets) use Range.compareBoundaryPoints
// to sum the lengths of every text node whose start strictly precedes the
// boundary point — the previous identity-only check missed the case where
// the child at targetOffset was itself an Element (e.g. `<b>` wrapping
// text), silently returning the doc-end offset.
function rawOffsetWithin(root: Node, target: Node, targetOffset: number): number {
  if (target.nodeType === Node.TEXT_NODE) {
    let total = 0;
    for (const text of collectTextNodes(root)) {
      if (text === target) return total + targetOffset;
      total += text.data.length;
    }
    return total;
  }
  const boundary = document.createRange();
  boundary.setStart(target, targetOffset);
  boundary.collapse(true);
  const probe = document.createRange();
  let total = 0;
  for (const text of collectTextNodes(root)) {
    probe.setStart(text, 0);
    probe.collapse(true);
    if (probe.compareBoundaryPoints(Range.START_TO_START, boundary) >= 0) break;
    total += text.data.length;
  }
  return total;
}

// Encode side of the public API: snapshot a live selection as a portable
// Anchor. Total over its input — never throws. `sections` records the
// `<article id>` elements the range intersects, prefix/suffix windows are
// sliced from the full document text. Roots at `document.body` so the
// stream the decoder will later search is the same one the encoder
// sliced from.
export function fromRange(range: Range): Anchor {
  const root = document.body;
  const docText = collectTextNodes(root).map((t) => t.data).join('');
  const startIdx = rawOffsetWithin(root, range.startContainer, range.startOffset);
  const endIdx = rawOffsetWithin(root, range.endContainer, range.endOffset);
  const prefix = docText.slice(Math.max(0, startIdx - WINDOW), startIdx);
  const exact = range.toString();
  const suffix = docText.slice(endIdx, Math.min(docText.length, endIdx + WINDOW));
  return { sections: touchedArticleIds(range, document), prefix, exact, suffix };
}

// Normalized view of a subtree's visible text. `text` collapses each run of
// whitespace to a single space. `charToSrc[i]` maps normalized index i back
// to (textNode, sourceOffset) — specifically: for the first char of a
// collapsed whitespace run, the FIRST source whitespace char; for the
// position just past a run, the next non-whitespace char.
//
// `runEndOffset[i]` is set ONLY for normalized indices that are spaces from
// a collapsed run; it stores the source offset of the LAST whitespace char
// of the run, so end-of-range mapping can include the full run in the
// returned Range when the match ends on that space.
interface NormMap {
  text: string;
  charToSrc: Array<{ node: Text; offset: number }>;
  runEndOffset: Array<{ node: Text; offset: number } | null>;
}

// Builds the normalized string the decoder searches AND the back-map from
// each normalized index to its source (Text node, offset), so a match in
// collapsed-whitespace space can produce a Range pointing at raw DOM.
function buildNormMap(root: Node): NormMap {
  let text = '';
  const charToSrc: Array<{ node: Text; offset: number }> = [];
  const runEndOffset: Array<{ node: Text; offset: number } | null> = [];
  let prevWasSpace = false;
  let lastRunNode: Text | null = null;
  let lastRunOffset = -1;
  for (const node of collectTextNodes(root)) {
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      const c = data.charAt(i);
      if (/\s/.test(c)) {
        if (prevWasSpace) {
          // Extend the current collapsed run; record the LAST source pos.
          lastRunNode = node;
          lastRunOffset = i;
          if (runEndOffset.length > 0) {
            runEndOffset[runEndOffset.length - 1] = { node, offset: i };
          }
          continue;
        }
        text += ' ';
        charToSrc.push({ node, offset: i });
        runEndOffset.push({ node, offset: i });
        lastRunNode = node;
        lastRunOffset = i;
        prevWasSpace = true;
      } else {
        text += c;
        charToSrc.push({ node, offset: i });
        runEndOffset.push(null);
        prevWasSpace = false;
      }
    }
  }
  // Suppress unused warnings; values captured for potential future debug.
  void lastRunNode;
  void lastRunOffset;
  return { text, charToSrc, runEndOffset };
}

// Applies the same whitespace collapse to stored anchor strings that
// buildNormMap applies to live DOM text, so the two are comparable.
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ');
}

// Decode side of the public API: resolve an Anchor back to a live Range
// by searching `document.body` for the exact text, using prefix/suffix
// as tiebreakers when it occurs more than once. `anchor.sections` is
// metadata only — it's not consulted here. Returns null when the exact
// text is gone — never throws, never mutates the DOM. The search root is
// fixed to mirror fromRange's encoder root; a custom root would make the
// round-trip asymmetric (prefix/suffix windows sliced from one stream,
// matched against another) for no caller's benefit.
export function toRange(anchor: Anchor): Range | null {
  const map = buildNormMap(document.body);
  const normExact = normalize(anchor.exact);
  if (!normExact) return null;
  const normPrefix = normalize(anchor.prefix);
  const normSuffix = normalize(anchor.suffix);

  const candidates: number[] = [];
  let from = 0;
  while (from <= map.text.length) {
    const idx = map.text.indexOf(normExact, from);
    if (idx === -1) break;
    candidates.push(idx);
    from = idx + 1;
  }
  if (candidates.length === 0) return null;

  let best = candidates[0]!;
  let bestScore = -1;
  for (const idx of candidates) {
    const before = map.text.slice(Math.max(0, idx - WINDOW), idx);
    const after = map.text.slice(idx + normExact.length, idx + normExact.length + WINDOW);
    let p = 0;
    while (p < Math.min(before.length, normPrefix.length) &&
           before.charAt(before.length - 1 - p) === normPrefix.charAt(normPrefix.length - 1 - p)) p++;
    let s = 0;
    while (s < Math.min(after.length, normSuffix.length) &&
           after.charAt(s) === normSuffix.charAt(s)) s++;
    const score = p + s;
    if (score > bestScore) { bestScore = score; best = idx; }
  }

  const startMap = map.charToSrc[best];
  const lastIdx = best + normExact.length - 1;
  const lastMap = map.charToSrc[lastIdx];
  if (!startMap || !lastMap) return null;
  // If the last matched normalized char is a space from a collapsed run,
  // extend the Range to include the entire run so range.toString() doesn't
  // truncate mid-whitespace.
  const runEnd = map.runEndOffset[lastIdx];
  const endNode = runEnd ? runEnd.node : lastMap.node;
  const endOffset = (runEnd ? runEnd.offset : lastMap.offset) + 1;
  const r = document.createRange();
  r.setStart(startMap.node, startMap.offset);
  r.setEnd(endNode, endOffset);
  return r;
}
