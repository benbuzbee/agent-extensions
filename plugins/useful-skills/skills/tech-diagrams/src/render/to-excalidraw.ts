import type {
  Arrowhead,
  Diagram,
  Edge,
  Label,
  Node,
  Style,
} from "../grammar/schema.ts";
import type { LaidOut, LaidOutEdge, LaidOutLabel, LaidOutNode } from "../layout/run.ts";
import { DEFAULT_FILL, DEFAULT_STROKE, FILL_HEX, STROKE_HEX } from "./colors.ts";
import {
  edgeElementId,
  edgeLabelId,
  nodeElementId,
  nodeLabelId,
  seedsFor,
  spacerId,
  type Seeds,
} from "./ids.ts";
import { CURVE_SAMPLES_PER_SEGMENT, sampleSpline } from "./spline.ts";
import { DEFAULT_SHAPE } from "../desugar/defaults.ts";
import { charWidth as textCharWidth } from "../text/wrap.ts";
import { parseEdgeId } from "../desugar/to-elk.ts";
import {
  DEFAULT_EDGE_AT,
  DEFAULT_NODE_AT,
  effectiveEdgeAt,
  effectiveNodeAt,
  expandLabels,
} from "../grammar/labels.ts";

export interface ExcalidrawScene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: { gridSize: null; viewBackgroundColor: string };
  files: Record<string, never>;
}

interface BaseElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "hachure" | "solid" | "cross-hatch";
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: null;
  roundness: { type: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: false;
  boundElements: { type: "arrow" | "text"; id: string }[] | null;
  updated: number;
  link: null;
  locked: false;
  index?: string;
}

export interface ShapeElement extends BaseElement {
  type: "rectangle" | "ellipse" | "diamond";
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  containerId: string | null;
  originalText: string;
  autoResize: boolean;
  lineHeight: number;
}

// Excalidraw's arrowhead set, minus our schema-side "none" alias which maps to null.
export type ExcalidrawArrowhead = Exclude<Arrowhead, "none">;

export interface ArrowElement extends BaseElement {
  type: "arrow";
  points: [number, number][];
  lastCommittedPoint: null;
  startBinding: { elementId: string; focus: number; gap: number; fixedPoint: null } | null;
  endBinding: { elementId: string; focus: number; gap: number; fixedPoint: null } | null;
  startArrowhead: ExcalidrawArrowhead | null;
  endArrowhead: ExcalidrawArrowhead | null;
  elbowed: boolean;
}

export type ExcalidrawElement = ShapeElement | TextElement | ArrowElement;

const FONT_SIZE = 18;
const LINE_HEIGHT = 1.25;
const FONT_FAMILY = 5; // Excalifont (current Excalidraw default)

// A fixed timestamp keeps the output byte-deterministic across runs and machines.
const UPDATED_AT = 1700000000000;

// Excalidraw's `roundness.type` enum: 3 = adaptive radius (rectangles), 2 = proportional (arrows).
const ROUNDNESS_RECT = { type: 3 } as const;
const ROUNDNESS_ARROW = { type: 2 } as const;

// Pixel gap between an arrow tip and its bound shape edge.
const ARROW_BINDING_GAP = 4;

// Excalidraw arrowheads extend ~11px perpendicular to the line at the tip
// and ~11px back along it. Treat each arrowhead end as a 2·R square buffer
// around the endpoint. Calibrated empirically by rendering single-arrow
// scenes through excalirender against a known background and reading
// non-background pixel extents.
const ARROWHEAD_RADIUS = 12;

// Conservative cushion for text ink — not measured. Excalifont caps and
// diacritics may extend a pixel or two above the text element's nominal y;
// 2px is a guess that has held up in practice.
const TEXT_ASCENT_PAD = 2;

interface BaseOpts {
  id: string;
  seedKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style?: Style;
  roundness?: { type: number } | null;
  boundElements?: BaseElement["boundElements"];
  groupIds?: string[];
  opacity?: number;
}

function baseElement(opts: BaseOpts): BaseElement {
  const style = opts.style ?? {};
  const seeds: Seeds = seedsFor(opts.seedKey);
  return {
    id: opts.id,
    type: "",
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    angle: 0,
    strokeColor: style.stroke ? STROKE_HEX[style.stroke] : DEFAULT_STROKE,
    backgroundColor: style.fill ? FILL_HEX[style.fill] : DEFAULT_FILL,
    fillStyle: style.fillStyle ?? "hachure",
    strokeWidth: style.strokeWidth ?? 2,
    strokeStyle: style.strokeStyle ?? "solid",
    roughness: style.roughness ?? 1,
    opacity: opts.opacity ?? 100,
    groupIds: opts.groupIds ?? [],
    frameId: null,
    roundness: opts.roundness ?? null,
    seed: seeds.seed,
    version: 1,
    versionNonce: seeds.versionNonce,
    isDeleted: false,
    boundElements: opts.boundElements ?? null,
    updated: UPDATED_AT,
    link: null,
    locked: false,
  };
}

export function toExcalidraw(diagram: Diagram, laidOut: LaidOut): ExcalidrawScene {
  const elements: ExcalidrawElement[] = [];

  // Document order so containers render before children — Excalidraw's z-stacking
  // is element-array order, and a container drawn over its children would hide them.
  const walk = (nodes: LaidOutNode[] | undefined, originX: number, originY: number) => {
    for (const n of nodes ?? []) {
      const node = diagram.nodes[n.id];
      if (!node) continue;
      const absX = originX + n.x;
      const absY = originY + n.y;
      const isContainer = !!(n.children && n.children.length > 0);
      renderNode(elements, n, node, absX, absY, isContainer);
      if (isContainer) walk(n.children, absX, absY);
    }
  };
  walk(laidOut.children, 0, 0);

  // Each user edge may explode into multiple ELK edges (e<i>, e<i>_1, ...);
  // group laid edges by user-edge index via the id prefix.
  const laidByUserIdx = groupLaidEdges(laidOut.edges ?? []);
  (diagram.edges ?? []).forEach((userEdge, i) => {
    const laidEdges = laidByUserIdx.get(i) ?? [];
    for (const laidEdge of laidEdges) {
      renderEdge(elements, laidEdge, userEdge);
    }
  });

  bindArrows(elements);

  appendCornerSpacers(elements);

  return {
    type: "excalidraw",
    version: 2,
    source: "tech-diagrams",
    elements,
    appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    files: {},
  };
}

// Excalirender computes the export canvas from element bboxes only, with no
// inflation for stroke width, arrowhead overshoot, rough.js jitter, or font
// ascenders — so content at the bbox edge gets clipped. We compute each
// element's *visual* ink extent (declared bbox + the cause-specific bleed),
// union those extents, and place two opacity-0 1×1 corner spacers exactly at
// the union extremes. The canvas then grows to enclose the real ink, without
// altering any real element's geometry.
//
// Two spacers suffice because excalirender's canvas is the AABB-union of
// element bboxes — pinning the two diagonal corners pins the whole rectangle.
function appendCornerSpacers(elements: ExcalidrawElement[]): void {
  if (elements.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of elements) {
    const [x1, y1, x2, y2] = inkBounds(e);
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }
  elements.push(buildSpacer("tl", minX, minY));
  elements.push(buildSpacer("br", maxX - 1, maxY - 1));
}

// Visual ink bounds [minX, minY, maxX, maxY] for one element — i.e. the
// rectangle that actually-rendered pixels stay inside. Per element type:
//   - text: declared bbox + small font-ascender allowance.
//   - rectangle/ellipse/diamond: declared bbox + stroke half-width + rough jitter.
//   - arrow: spline samples (since multi-point arrows bow outside the
//     bbox formed by `element.x/y/w/h`) + arrowhead buffers + stroke margin.
function inkBounds(el: ExcalidrawElement): [number, number, number, number] {
  if (el.type === "text") {
    return [el.x, el.y - TEXT_ASCENT_PAD, el.x + el.width, el.y + el.height + TEXT_ASCENT_PAD];
  }
  // Half-stroke for the line itself, plus ~2px per unit of roughness for
  // rough.js perpendicular jitter. The 2x factor is empirical, sourced from
  // single-element renders against a known background.
  const stroke = el.strokeWidth / 2 + el.roughness * 2;
  if (el.type !== "arrow") {
    return [el.x - stroke, el.y - stroke, el.x + el.width + stroke, el.y + el.height + stroke];
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const samples = el.points.length >= 3
    ? sampleSpline(el.points, CURVE_SAMPLES_PER_SEGMENT)
    : el.points;
  for (const [dx, dy] of samples) include(el.x + dx, el.y + dy);
  const N = el.points.length;
  if (el.startArrowhead !== null && N >= 1) {
    const [px, py] = el.points[0]!;
    include(el.x + px - ARROWHEAD_RADIUS, el.y + py - ARROWHEAD_RADIUS);
    include(el.x + px + ARROWHEAD_RADIUS, el.y + py + ARROWHEAD_RADIUS);
  }
  if (el.endArrowhead !== null && N >= 1) {
    const [px, py] = el.points[N - 1]!;
    include(el.x + px - ARROWHEAD_RADIUS, el.y + py - ARROWHEAD_RADIUS);
    include(el.x + px + ARROWHEAD_RADIUS, el.y + py + ARROWHEAD_RADIUS);
  }
  return [minX - stroke, minY - stroke, maxX + stroke, maxY + stroke];
}

function buildSpacer(corner: "tl" | "br", x: number, y: number): ShapeElement {
  const id = spacerId(corner);
  return {
    ...baseElement({
      id,
      seedKey: "spacer:" + corner,
      x,
      y,
      width: 1,
      height: 1,
      opacity: 0,
    }),
    type: "rectangle",
  };
}

// Group laid edges by user-edge index in a single pass; tag each with `j` so
// ordering follows the desugar explosion order without a second regex per id.
function groupLaidEdges(edges: LaidOutEdge[]): Map<number, LaidOutEdge[]> {
  const out = new Map<number, { edge: LaidOutEdge; j: number }[]>();
  for (const e of edges) {
    const parsed = parseEdgeId(e.id);
    if (!parsed) continue;
    const list = out.get(parsed.userIdx) ?? [];
    list.push({ edge: e, j: parsed.j });
    out.set(parsed.userIdx, list);
  }
  const result = new Map<number, LaidOutEdge[]>();
  for (const [userIdx, list] of out) {
    list.sort((a, b) => a.j - b.j);
    result.set(userIdx, list.map((x) => x.edge));
  }
  return result;
}

// Pick which label gets `containerId` binding to the shape/arrow.
// Prefers the first inside-center (node) / middle (edge) label, since that's
// what Excalidraw's bound-text rendering geometry is designed for.
function pickBoundLabelIndex(labels: Label[], context: "node" | "edge"): number {
  if (labels.length === 0) return -1;
  for (let i = 0; i < labels.length; i++) {
    const at = context === "node" ? effectiveNodeAt(labels[i]!) : effectiveEdgeAt(labels[i]!);
    if (at === (context === "node" ? DEFAULT_NODE_AT : DEFAULT_EDGE_AT)) return i;
  }
  return 0;
}

function labelTextStyle(lbl: Label, fallback: Style | undefined): Style {
  return {
    stroke: lbl.style?.color ?? fallback?.stroke,
    strokeWidth: 1,
    strokeStyle: "solid",
    fillStyle: "solid",
  };
}

function labelSeedKey(prefix: string, idx: number): string {
  return idx === 0 ? prefix : prefix + ":" + idx;
}

function renderNode(
  elements: ExcalidrawElement[],
  n: LaidOutNode,
  node: Node,
  absX: number,
  absY: number,
  isContainer: boolean,
): void {
  const userLabels = expandLabels(node);
  const boundIdx = pickBoundLabelIndex(userLabels, "node");
  const groupId = userLabels.length > 1 ? "g:" + nodeElementId(n.id) : undefined;
  const groupIds = groupId ? [groupId] : [];

  const boundLabelId = boundIdx >= 0 ? nodeLabelId(n.id, boundIdx) : undefined;
  const shape = buildShape(
    n.id,
    node.shape ?? DEFAULT_SHAPE,
    absX,
    absY,
    n.width,
    n.height,
    node.style,
    boundLabelId,
    groupIds,
  );
  elements.push(shape);

  userLabels.forEach((lbl, i) => {
    const isBound = i === boundIdx;
    const laidLabel = n.labels?.[i];
    elements.push(
      buildNodeLabel({
        nodeId: n.id,
        idx: i,
        lbl,
        nodeStyle: node.style,
        laidLabel,
        absX,
        absY,
        shapeWidth: n.width,
        shapeHeight: n.height,
        isContainer,
        containerId: isBound ? shape.id : null,
        groupIds,
      }),
    );
  });
}

function renderEdge(
  elements: ExcalidrawElement[],
  laidEdge: LaidOutEdge,
  userEdge: Edge,
): void {
  const userLabels = expandLabels(userEdge);
  const boundIdx = pickBoundLabelIndex(userLabels, "edge");
  const groupId = userLabels.length > 1 ? "g:" + edgeElementId(laidEdge.id) : undefined;
  const groupIds = groupId ? [groupId] : [];

  const arrow = buildArrow(laidEdge, userEdge, groupIds);
  elements.push(arrow);

  userLabels.forEach((lbl, i) => {
    const isBound = i === boundIdx;
    const labelId = edgeLabelId(laidEdge.id, i);
    elements.push(
      buildEdgeLabel({
        edgeId: laidEdge.id,
        idx: i,
        labelId,
        lbl,
        laidLabel: laidEdge.labels?.[i],
        containerId: isBound ? arrow.id : null,
        groupIds,
      }),
    );
    if (isBound) {
      arrow.boundElements = appendBoundEntry(arrow.boundElements, { type: "text", id: labelId });
    }
  });
}

function buildShape(
  nodeId: string,
  shape: "rectangle" | "ellipse" | "diamond",
  x: number,
  y: number,
  width: number,
  height: number,
  style: Style | undefined,
  boundLabelId: string | undefined,
  groupIds: string[],
): ShapeElement {
  const id = nodeElementId(nodeId);
  return {
    ...baseElement({
      id,
      seedKey: "shape:" + nodeId,
      x,
      y,
      width,
      height,
      style,
      roundness: shape === "rectangle" ? ROUNDNESS_RECT : null,
      boundElements: boundLabelId ? [{ type: "text", id: boundLabelId }] : null,
      groupIds,
    }),
    type: shape,
  };
}

interface NodeLabelInputs {
  nodeId: string;
  idx: number;
  lbl: Label;
  nodeStyle: Style | undefined;
  laidLabel: LaidOutLabel | undefined;
  absX: number;
  absY: number;
  shapeWidth: number;
  shapeHeight: number;
  isContainer: boolean;
  containerId: string | null;
  groupIds: string[];
}

function buildNodeLabel(opts: NodeLabelInputs): TextElement {
  const { nodeId, idx, lbl, nodeStyle, laidLabel, absX, absY, shapeWidth, shapeHeight, isContainer, containerId, groupIds } = opts;
  const fontSize = lbl.style?.size ?? FONT_SIZE;
  const isBound = containerId !== null;
  // Bound text spans the shape (so verticalAlign:"middle" centers within the
  // shape). Free text uses ELK's resolved label box, falling back defensively
  // to a char-count estimate if ELK ever drops the box. Verticalalign:"middle"
  // centers within the *text element's* bounds, not the shape's, so non-
  // container bound text shifts down by (shapeHeight - textHeight)/2.
  const { x, y, width, height } = ((): {
    x: number;
    y: number;
    width: number;
    height: number;
  } => {
    const lineH = fontSize * LINE_HEIGHT;
    if (isBound) {
      const h = lineH;
      return {
        x: absX,
        y: isContainer ? absY : absY + (shapeHeight - h) / 2,
        width: shapeWidth,
        height: h,
      };
    }
    return {
      x: absX + (laidLabel?.x ?? 0),
      y: absY + (laidLabel?.y ?? 0),
      width: laidLabel?.width ?? lbl.text.length * textCharWidth(fontSize),
      height: laidLabel?.height ?? lineH,
    };
  })();
  return {
    ...baseElement({
      id: nodeLabelId(nodeId, idx),
      seedKey: labelSeedKey("text:" + nodeId, idx),
      x,
      y,
      width,
      height,
      style: labelTextStyle(lbl, nodeStyle),
      groupIds,
    }),
    type: "text",
    text: lbl.text,
    fontSize,
    fontFamily: FONT_FAMILY,
    textAlign: "center",
    verticalAlign: isBound && isContainer ? "top" : "middle",
    containerId,
    originalText: lbl.text,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
  };
}

function buildArrow(
  laidEdge: LaidOutEdge,
  userEdge: Edge,
  groupIds: string[],
): ArrowElement {
  const section = laidEdge.sections?.[0];
  const start = section?.startPoint ?? { x: 0, y: 0 };
  const end = section?.endPoint ?? { x: 100, y: 0 };
  const bends = section?.bendPoints ?? [];
  const allPoints = [start, ...bends, end];
  const startRel: [number, number][] = allPoints.map((p) => [p.x - start.x, p.y - start.y]);
  const xs = startRel.map((p) => p[0]);
  const ys = startRel.map((p) => p[1]);
  // Re-anchor element origin to the bbox top-left so points have non-negative
  // offsets. The arrow's start point is no longer fixed at points[0]=[0,0]; this
  // matters for tools that compute scene bounds from `x,y,width,height` without
  // iterating points (e.g. excalirender), which previously cropped looping
  // back-edges. Visually identical: shifting the origin and the point offsets by
  // the same amount cancels out.
  const xMin = Math.min(...xs);
  const yMin = Math.min(...ys);
  const points: [number, number][] = startRel.map(([dx, dy]) => [dx - xMin, dy - yMin]);

  // Use ELK's resolved source/target ids — for exploded edges they identify the
  // specific endpoint pair, not the user-edge's array form.
  const fromId = laidEdge.sources[0]!;
  const toId = laidEdge.targets[0]!;

  return {
    ...baseElement({
      id: edgeElementId(laidEdge.id),
      seedKey: "arrow:" + laidEdge.id,
      x: start.x + xMin,
      y: start.y + yMin,
      width: Math.max(...xs) - xMin,
      height: Math.max(...ys) - yMin,
      style: userEdge.style,
      roundness: null,
      groupIds,
    }),
    type: "arrow",
    points,
    lastCommittedPoint: null,
    startBinding: { elementId: nodeElementId(fromId), focus: 0, gap: ARROW_BINDING_GAP, fixedPoint: null },
    endBinding: { elementId: nodeElementId(toId), focus: 0, gap: ARROW_BINDING_GAP, fixedPoint: null },
    startArrowhead: resolveArrowhead(userEdge.style?.startArrow, null),
    endArrowhead: resolveArrowhead(userEdge.style?.endArrow, "arrow"),
    elbowed: true,
  };
}

function resolveArrowhead(
  value: Arrowhead | undefined,
  fallback: ExcalidrawArrowhead | null,
): ExcalidrawArrowhead | null {
  if (value === undefined) return fallback;
  if (value === "none") return null;
  return value;
}

interface EdgeLabelInputs {
  edgeId: string;
  idx: number;
  labelId: string;
  lbl: Label;
  laidLabel: LaidOutLabel | undefined;
  containerId: string | null;
  groupIds: string[];
}

function buildEdgeLabel(opts: EdgeLabelInputs): TextElement {
  const { edgeId, idx, labelId, lbl, laidLabel, containerId, groupIds } = opts;
  const fontSize = lbl.style?.size ?? FONT_SIZE - 2;
  return {
    ...baseElement({
      id: labelId,
      seedKey: labelSeedKey("text:edge:" + edgeId, idx),
      x: laidLabel?.x ?? 0,
      y: laidLabel?.y ?? 0,
      width: laidLabel?.width ?? 40,
      height: laidLabel?.height ?? 16,
      style: labelTextStyle(lbl, undefined),
      groupIds,
    }),
    type: "text",
    text: lbl.text,
    fontSize,
    fontFamily: FONT_FAMILY,
    textAlign: "center",
    verticalAlign: "middle",
    containerId,
    originalText: lbl.text,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
  };
}

// Walk arrows once and append their ids to each bound shape's boundElements list.
// O(arrows + elements) using a Map; previously O(arrows × elements) via .find().
// We only flow arrow → shape; the arrow→label binding is set during edge construction
// and a label has no inverse binding (its containerId already points to the arrow).
function bindArrows(elements: ExcalidrawElement[]): void {
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const el of elements) {
    if (el.type !== "arrow") continue;
    appendBound(byId.get(el.startBinding?.elementId ?? ""), el.id, "arrow");
    appendBound(byId.get(el.endBinding?.elementId ?? ""), el.id, "arrow");
  }
}

function appendBound(
  shape: ExcalidrawElement | undefined,
  id: string,
  kind: "arrow" | "text",
): void {
  if (!shape) return;
  shape.boundElements = appendBoundEntry(shape.boundElements, { type: kind, id });
}

function appendBoundEntry(
  list: BaseElement["boundElements"],
  entry: { type: "arrow" | "text"; id: string },
): BaseElement["boundElements"] {
  const arr = list ?? [];
  if (arr.some((b) => b.id === entry.id)) return arr;
  return [...arr, entry];
}
