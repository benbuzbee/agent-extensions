import type {
  Arrowhead,
  Diagram,
  Edge,
  Label,
  Node,
  Style,
  StrokeStyle,
} from "../grammar/schema.ts";
import type { LaidOut, LaidOutEdge, LaidOutLabel, LaidOutNode } from "../layout/run.ts";
import {
  DEFAULT_CONTAINER_FILL_CLASS,
  DEFAULT_LEAF_FILL_CLASS,
  DEFAULT_STROKE,
  DEFAULT_STROKE_CLASS,
  DEFAULT_TEXT_CLASS,
  FILL_CLASS,
  FILL_HEX,
  HALO_FILL_CLASS,
  HALO_STROKE_CLASS,
  STROKE_CLASS,
  STROKE_HEX,
  TEXT_CLASS,
  themeStyleBlock,
} from "./colors.ts";
import { DEFAULT_SHAPE } from "../desugar/defaults.ts";
import { innerWrapTarget, parseEdgeId } from "../desugar/to-elk.ts";
import { DEFAULT_NODE_AT, effectiveNodeAt, expandLabels } from "../grammar/labels.ts";
import {
  SHAPE_TEXT_ASPECT,
  lineHeight as textLineHeight,
  wrapToAspect,
} from "../text/wrap.ts";

// Proof-of-concept native SVG emitter. Sibling of render/to-excalidraw.ts;
// consumes the same LaidOut tree. Intentionally crisp (no rough.js jitter),
// no Excalidraw scene fields, no excalirender-compensation hacks.

const FONT_SIZE = 18;
const EDGE_FONT_SIZE = 16;
const VIEWBOX_PADDING = 16;
const RECT_RADIUS = 6;
// Half-width of the halo painted around edge labels so the line behind them
// doesn't bleed through. Expressed in user units; renders as `paint-order:stroke`
// with this stroke-width.
const EDGE_LABEL_HALO_WIDTH = 4;

export interface SvgOptions {
  // Prefix for marker ids so multiple SVGs can coexist in one HTML document
  // without colliding on `url(#m-arrow)` references.
  idPrefix?: string;
  // CSS font-family for label text. Defaults to a generic sans-serif stack.
  fontFamily?: string;
  // Halo colour painted behind edge labels via `paint-order: stroke`.
  // Defaults to white so labels stay legible on light backgrounds; set to
  // match a dark embedding when the SVG ships into a dark-mode page.
  edgeLabelHalo?: string;
}

export function toSvg(diagram: Diagram, laidOut: LaidOut, opts: SvgOptions = {}): string {
  // Escape the prefix the same way fontFamily is escaped — both end up in
  // attribute values, and the caller's contract doesn't promise they're clean.
  const prefix = escapeAttr(opts.idPrefix ?? "");
  const fontFamily = opts.fontFamily ?? "ui-sans-serif, system-ui, -apple-system, sans-serif";
  const edgeHalo = opts.edgeLabelHalo ?? "white";

  const shapes: string[] = [];
  const labels: string[] = [];
  const edgeLines: string[] = [];
  const edgeLabels: string[] = [];
  const usedArrowheads = new Set<Arrowhead>();

  const bbox = new Bbox();

  const walkNodes = (
    nodes: LaidOutNode[] | undefined,
    originX: number,
    originY: number,
  ): void => {
    for (const n of nodes ?? []) {
      const node = diagram.nodes[n.id];
      if (!node) continue;
      const absX = originX + n.x;
      const absY = originY + n.y;
      const isContainer = !!(n.children && n.children.length > 0);

      shapes.push(renderShape(node, absX, absY, n.width, n.height, isContainer));
      bbox.include(absX, absY);
      bbox.include(absX + n.width, absY + n.height);

      const userLabels = expandLabels(node);
      const boundIdx = pickBoundLabelIndex(userLabels);
      userLabels.forEach((lbl, i) => {
        labels.push(
          renderNodeLabel(lbl, node, n, i, absX, absY, isContainer, i === boundIdx),
        );
        // outside-* labels lie outside the node rect; without including their
        // resolved boxes the viewBox clips them.
        const laidLabel = n.labels?.[i];
        if (laidLabel) {
          bbox.include(absX + laidLabel.x, absY + laidLabel.y);
          bbox.include(absX + laidLabel.x + laidLabel.width, absY + laidLabel.y + laidLabel.height);
        }
      });

      if (isContainer) walkNodes(n.children, absX, absY);
    }
  };
  walkNodes(laidOut.children, 0, 0);

  const grouped = groupLaidEdges(laidOut.edges ?? []);
  (diagram.edges ?? []).forEach((userEdge, i) => {
    for (const laidEdge of grouped.get(i) ?? []) {
      const section = laidEdge.sections?.[0];
      if (!section) continue;
      const rawPoints = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      // Drop consecutive duplicates so marker tangents at either endpoint are
      // never derived from a zero-length segment (which would orient the
      // arrowhead arbitrarily, browser-dependent).
      const points = dedupConsecutive(rawPoints);
      if (points.length < 2) continue;
      for (const p of points) bbox.include(p.x, p.y);

      const startArrow = resolveArrowhead(userEdge.style?.startArrow, "none");
      const endArrow = resolveArrowhead(userEdge.style?.endArrow, "arrow");
      if (startArrow !== "none") usedArrowheads.add(startArrow);
      if (endArrow !== "none") usedArrowheads.add(endArrow);

      edgeLines.push(renderEdge(points, userEdge, startArrow, endArrow, prefix));

      const userLabels = expandLabels(userEdge);
      userLabels.forEach((lbl, j) => {
        // Fallback: when ELK doesn't return a label box for a user-supplied
        // edge label, anchor it at the midpoint of the polyline so the text
        // still appears (matching Excalidraw's "always emit" guarantee).
        const laidLabel = laidEdge.labels?.[j] ?? fallbackEdgeLabel(lbl.text, points);
        edgeLabels.push(renderEdgeLabel(lbl, laidLabel, edgeHalo));
        bbox.include(laidLabel.x, laidLabel.y);
        bbox.include(laidLabel.x + laidLabel.width, laidLabel.y + laidLabel.height);
      });
    }
  });

  const vb = bbox.viewBox(VIEWBOX_PADDING);
  const defs = renderDefs([...usedArrowheads], prefix);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="tg-svg" viewBox="${vb}" font-family="${escapeAttr(fontFamily)}">`,
    themeStyleBlock(),
    defs,
    ...shapes,
    ...edgeLines,
    ...labels,
    ...edgeLabels,
    `</svg>`,
  ].join("\n");
}

// ---------- shapes ----------

function renderShape(
  node: Node,
  x: number,
  y: number,
  w: number,
  h: number,
  isContainer: boolean,
): string {
  const shape = node.shape ?? DEFAULT_SHAPE;
  const stroke = node.style?.stroke ? STROKE_HEX[node.style.stroke] : DEFAULT_STROKE;
  const strokeClass = node.style?.stroke ? STROKE_CLASS[node.style.stroke] : DEFAULT_STROKE_CLASS;
  // Containers default to transparent; leaves default to none so the host
  // page background shows through. Both attribute and class are emitted: the
  // class drives theming, the attribute provides a fallback for renderers
  // that strip the embedded <style>.
  const fillKey = node.style?.fill;
  const fill = fillKey ? FILL_HEX[fillKey] : (isContainer ? "transparent" : "none");
  const fillClass = fillKey
    ? FILL_CLASS[fillKey]
    : (isContainer ? DEFAULT_CONTAINER_FILL_CLASS : DEFAULT_LEAF_FILL_CLASS);
  const strokeWidth = node.style?.strokeWidth ?? 2;
  const dash = strokeDashAttr(node.style?.strokeStyle);
  const common = `class="${strokeClass} ${fillClass}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}`;

  if (shape === "ellipse") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" ${common}/>`;
  }
  if (shape === "diamond") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" ${common}/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RECT_RADIUS}" ry="${RECT_RADIUS}" ${common}/>`;
}

// ---------- labels ----------

// Mirrors to-excalidraw.ts:pickBoundLabelIndex. Bound = the label that centers
// on the shape. Prefer the first inside-center label; if none exists, fall
// back to index 0 so a single-label node always has a centered label.
function pickBoundLabelIndex(labels: Label[]): number {
  if (labels.length === 0) return -1;
  for (let i = 0; i < labels.length; i++) {
    if (effectiveNodeAt(labels[i]!) === DEFAULT_NODE_AT) return i;
  }
  return 0;
}

function renderNodeLabel(
  lbl: Label,
  node: Node,
  laid: LaidOutNode,
  idx: number,
  absX: number,
  absY: number,
  isContainer: boolean,
  isBound: boolean,
): string {
  const fontSize = lbl.style?.size ?? FONT_SIZE;
  const color = lbl.style?.color
    ? STROKE_HEX[lbl.style.color]
    : node.style?.stroke
      ? STROKE_HEX[node.style.stroke]
      : DEFAULT_STROKE;
  const textClass = lbl.style?.color
    ? TEXT_CLASS[lbl.style.color]
    : node.style?.stroke
      ? TEXT_CLASS[node.style.stroke]
      : DEFAULT_TEXT_CLASS;
  const laidLabel = laid.labels?.[idx];

  // One IIFE returns the placement + wrapped lines for whichever branch
  // applies — bound (centered in the shape, re-wraps to the laid width so
  // lines match desugar's sizeLeafNode), free label with an ELK-resolved box,
  // or labelless fallback. Keeping x/y/lines `const` makes the three branches
  // legibly distinct rather than three assignments into shared `let`s.
  const { x, y, lines } = ((): { x: number; y: number; lines: string[] } => {
    if (isBound) {
      const bx = absX + laid.width / 2;
      const by = isContainer ? absY + fontSize * 0.8 : absY + laid.height / 2;
      if (isContainer) return { x: bx, y: by, lines: lbl.text.split("\n") };
      // Reverse-derive the wrap target from the *final* node width — the
      // same value desugar's sizeLeafNode passed to wrapToAspect. Both sides
      // wrap to the identical target → identical lines, even when User
      // pinned `width:` narrower than the auto-fit would produce.
      const shape = node.shape ?? DEFAULT_SHAPE;
      const target = innerWrapTarget(laid.width, shape);
      const block = wrapToAspect(lbl.text, fontSize, SHAPE_TEXT_ASPECT[shape], target);
      return { x: bx, y: by, lines: block.lines };
    }
    if (laidLabel) {
      return {
        x: absX + laidLabel.x + laidLabel.width / 2,
        y: absY + laidLabel.y + laidLabel.height / 2,
        lines: lbl.text.split("\n"),
      };
    }
    return {
      x: absX + laid.width / 2,
      y: absY + laid.height / 2,
      lines: lbl.text.split("\n"),
    };
  })();

  return renderMultiLineText(lines, x, y, fontSize, `class="${textClass}" fill="${color}"`);
}

function renderEdgeLabel(lbl: Label, laid: LaidOutLabel, halo: string): string {
  const fontSize = lbl.style?.size ?? EDGE_FONT_SIZE;
  const color = lbl.style?.color ? STROKE_HEX[lbl.style.color] : DEFAULT_STROKE;
  const textClass = lbl.style?.color ? TEXT_CLASS[lbl.style.color] : DEFAULT_TEXT_CLASS;
  const cx = laid.x + laid.width / 2;
  const cy = laid.y + laid.height / 2;
  // `paint-order: stroke` paints stroke first, then fill on top — the stroke
  // becomes a halo around the glyphs so the edge line behind doesn't bleed
  // through. Cheaper than an opaque background rect and inherits halo colour.
  // The halo class points stroke at var(--tg-halo) so it follows the host
  // page in dark mode; the attribute fallback is the caller-supplied `halo`.
  const haloAttrs = `class="${textClass} ${HALO_STROKE_CLASS}" stroke="${escapeAttr(halo)}" stroke-width="${EDGE_LABEL_HALO_WIDTH}" stroke-linejoin="round" paint-order="stroke"`;
  // Edge labels are ribbons: honor explicit \n only, never auto-wrap. Short
  // ribbons like "FB: creates" should stay one line.
  const lines = lbl.text.split("\n");
  return renderMultiLineText(lines, cx, cy, fontSize, `fill="${color}" ${haloAttrs}`);
}

// `dominant-baseline="central"` is repeated on each tspan because WebKit/Safari
// drops it when only set on the parent (Lea Verou, "SVG text baselines").
function renderMultiLineText(
  lines: string[],
  cx: number,
  cy: number,
  fontSize: number,
  extraAttrs: string,
): string {
  const baseAttrs = `font-size="${fontSize}" ${extraAttrs} text-anchor="middle" dominant-baseline="central"`;
  if (lines.length <= 1) {
    const text = lines[0] ?? "";
    return `<text x="${cx}" y="${cy}" ${baseAttrs}>${escapeText(text)}</text>`;
  }
  const lh = textLineHeight(fontSize);
  const startY = cy - ((lines.length - 1) * lh) / 2;
  const tspans = lines
    .map((line, i) => {
      const dy = i === 0 ? "" : ` dy="${lh}"`;
      return `<tspan x="${cx}"${dy} dominant-baseline="central">${escapeText(line)}</tspan>`;
    })
    .join("");
  return `<text x="${cx}" y="${startY}" ${baseAttrs}>${tspans}</text>`;
}

// Minimal stand-in for a missing ELK label box. Centred on the midpoint of the
// laid polyline, sized to fit the text at the edge font size.
function fallbackEdgeLabel(text: string, points: { x: number; y: number }[]): LaidOutLabel {
  const mid = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
  const width = Math.max(40, text.length * 8);
  const height = 16;
  return { text, x: mid.x - width / 2, y: mid.y - height / 2, width, height };
}

function dedupConsecutive<T extends { x: number; y: number }>(points: T[]): T[] {
  const out: T[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) out.push(p);
  }
  return out;
}

// ---------- edges ----------

function renderEdge(
  points: { x: number; y: number }[],
  userEdge: Edge,
  startArrow: Arrowhead,
  endArrow: Arrowhead,
  prefix: string,
): string {
  const stroke = userEdge.style?.stroke ? STROKE_HEX[userEdge.style.stroke] : DEFAULT_STROKE;
  const strokeClass = userEdge.style?.stroke ? STROKE_CLASS[userEdge.style.stroke] : DEFAULT_STROKE_CLASS;
  const strokeWidth = userEdge.style?.strokeWidth ?? 2;
  const dash = strokeDashAttr(userEdge.style?.strokeStyle);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
  const markerStart =
    startArrow !== "none" ? ` marker-start="url(#${markerId(startArrow, prefix)})"` : "";
  const markerEnd =
    endArrow !== "none" ? ` marker-end="url(#${markerId(endArrow, prefix)})"` : "";
  return `<path class="${strokeClass}" d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}${markerStart}${markerEnd}/>`;
}

function groupLaidEdges(edges: LaidOutEdge[]): Map<number, LaidOutEdge[]> {
  const out = new Map<number, { e: LaidOutEdge; j: number }[]>();
  for (const e of edges) {
    const p = parseEdgeId(e.id);
    if (!p) continue;
    const list = out.get(p.userIdx) ?? [];
    list.push({ e, j: p.j });
    out.set(p.userIdx, list);
  }
  const result = new Map<number, LaidOutEdge[]>();
  for (const [k, list] of out) {
    list.sort((a, b) => a.j - b.j);
    result.set(k, list.map((x) => x.e));
  }
  return result;
}

// ---------- arrowheads ----------

function resolveArrowhead(value: Arrowhead | undefined, fallback: Arrowhead): Arrowhead {
  return value ?? fallback;
}

function markerId(a: Arrowhead, prefix: string): string {
  return `${prefix}m-${a.replace(/_/g, "-")}`;
}

function renderDefs(arrowheads: Arrowhead[], prefix: string): string {
  if (arrowheads.length === 0) return "<defs/>";
  const markers = arrowheads
    .filter((a) => a !== "none")
    .map((a) => renderMarker(a, prefix))
    .join("");
  return `<defs>${markers}</defs>`;
}

// `fill="context-stroke"` lets each marker inherit the colour of the line it
// terminates — one marker definition per arrowhead type covers every stroke
// colour. SVG 2 feature, supported in current Chrome/Firefox/Safari 16.4+.
//
// Marker geometry uses default `markerUnits="strokeWidth"` so arrowheads scale
// with the edge thickness — markerWidth/markerHeight are expressed in
// stroke-widths. The pre-halved dimensions below reproduce the previous
// 10×10-px look at the default strokeWidth of 2 and grow proportionally for
// thicker strokes (matching the Excalidraw sibling).
function renderMarker(a: Arrowhead, prefix: string): string {
  const id = markerId(a, prefix);
  const orient = "auto-start-reverse";
  const open = (vb: string, refX: number, refY: number, w: number, h: number): string =>
    `<marker id="${id}" viewBox="${vb}" refX="${refX}" refY="${refY}" markerWidth="${w}" markerHeight="${h}" orient="${orient}">`;
  switch (a) {
    case "arrow":
    case "triangle":
      return open("0 0 10 10", 9, 5, 5, 5) +
        `<path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>`;
    case "triangle_outline":
      return open("0 0 10 10", 9, 5, 5, 5) +
        `<path class="${HALO_FILL_CLASS}" d="M0,0 L10,5 L0,10 z" fill="white" stroke="context-stroke" stroke-width="1.5"/></marker>`;
    case "diamond":
      return open("0 0 12 8", 11, 4, 6, 4) +
        `<path d="M0,4 L6,0 L12,4 L6,8 z" fill="context-stroke"/></marker>`;
    case "diamond_outline":
      return open("0 0 12 8", 11, 4, 6, 4) +
        `<path class="${HALO_FILL_CLASS}" d="M0,4 L6,0 L12,4 L6,8 z" fill="white" stroke="context-stroke" stroke-width="1.5"/></marker>`;
    case "bar":
      return open("0 0 4 10", 2, 5, 2, 5) +
        `<line x1="2" y1="0" x2="2" y2="10" stroke="context-stroke" stroke-width="2"/></marker>`;
    case "dot":
      return open("0 0 10 10", 5, 5, 4, 4) +
        `<circle cx="5" cy="5" r="4" fill="context-stroke"/></marker>`;
    case "crowfoot_one":
      return open("0 0 12 12", 11, 6, 6, 6) +
        `<line x1="6" y1="2" x2="6" y2="10" stroke="context-stroke" stroke-width="1.5"/></marker>`;
    case "crowfoot_many":
    case "crowfoot_one_or_more":
      return open("0 0 14 12", 13, 6, 7, 6) +
        `<path d="M0,6 L12,0 M0,6 L12,12 M0,6 L12,6" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker>`;
    case "crowfoot_one_or_many":
      return open("0 0 16 12", 15, 6, 8, 6) +
        `<line x1="6" y1="2" x2="6" y2="10" stroke="context-stroke" stroke-width="1.5"/>` +
        `<path d="M2,6 L14,0 M2,6 L14,12 M2,6 L14,6" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker>`;
    case "crowfoot_zero_or_one":
      return open("0 0 16 12", 15, 6, 8, 6) +
        `<line x1="10" y1="2" x2="10" y2="10" stroke="context-stroke" stroke-width="1.5"/>` +
        `<circle class="${HALO_FILL_CLASS}" cx="4" cy="6" r="3" fill="white" stroke="context-stroke" stroke-width="1.5"/></marker>`;
    case "none":
      return "";
  }
}

// ---------- helpers ----------

function strokeDashAttr(style: StrokeStyle | undefined): string {
  if (style === "dashed") return ` stroke-dasharray="8 4"`;
  if (style === "dotted") return ` stroke-dasharray="2 4"`;
  return "";
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

class Bbox {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  include(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }
  viewBox(pad: number): string {
    if (!isFinite(this.minX)) return "0 0 100 100";
    const x = this.minX - pad;
    const y = this.minY - pad;
    const w = this.maxX - this.minX + pad * 2;
    const h = this.maxY - this.minY + pad * 2;
    return `${round(x)} ${round(y)} ${round(w)} ${round(h)}`;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
