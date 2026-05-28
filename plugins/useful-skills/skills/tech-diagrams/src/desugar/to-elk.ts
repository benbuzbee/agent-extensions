import type {
  Diagram,
  Edge,
  EdgeLabelAt,
  Label,
  Node,
  NodeLabelAt,
  Shape,
} from "../grammar/schema.ts";
import {
  DEFAULT_NODE_AT,
  effectiveEdgeAt,
  effectiveNodeAt,
  expandLabels,
  toArray,
} from "../grammar/labels.ts";
import {
  SHAPE_INFLATION,
  SHAPE_TEXT_ASPECT,
  charWidth as textCharWidth,
  inflateForShape,
  lineHeight as textLineHeight,
  measureLineWidth,
  wrapToAspect,
} from "../text/wrap.ts";
import {
  DEFAULT_CONTAINER_PADDING,
  DEFAULT_DIRECTION,
  DEFAULT_EDGE_SPACING,
  DEFAULT_LAYER_SPACING,
  DEFAULT_LAYOUT,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_SPACING,
  DEFAULT_NODE_WIDTH,
  DEFAULT_SHAPE,
  EDGE_LABEL_HEIGHT,
  ELK_DIRECTION,
  MIN_LABEL_WIDTH,
  NODE_LABEL_HEIGHT,
  NODE_TEXT_PADDING,
} from "./defaults.ts";

// ELK placement enums per node-label `at`. Tokens are space-separated; ELK
// also accepts comma/bracket forms but space matched the rest of layoutOptions.
export const NODE_AT_TO_ELK: Record<NodeLabelAt, string> = {
  "inside-top": "INSIDE V_TOP H_CENTER",
  "inside-center": "INSIDE V_CENTER H_CENTER",
  "inside-bottom": "INSIDE V_BOTTOM H_CENTER",
  "outside-top": "OUTSIDE V_TOP H_CENTER",
  "outside-bottom": "OUTSIDE V_BOTTOM H_CENTER",
  "outside-left": "OUTSIDE V_CENTER H_LEFT",
  "outside-right": "OUTSIDE V_CENTER H_RIGHT",
};

// ELK edge-label placement: `start`→TAIL (near source), `middle`→CENTER,
// `end`→HEAD (near target). Setting per-label is required — the graph-level
// option does not differentiate multiple labels on the same edge.
export const EDGE_AT_TO_ELK: Record<EdgeLabelAt, string> = {
  start: "TAIL",
  middle: "CENTER",
  end: "HEAD",
};

export interface ElkLabel {
  text: string;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
}

export interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  labels?: ElkLabel[];
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: ElkLabel[];
}

export interface ElkRoot extends ElkNode {
  id: "root";
  layoutOptions: Record<string, string>;
}

export function desugar(d: Diagram): ElkRoot {
  const algorithm = d.layout ?? DEFAULT_LAYOUT;
  const direction = d.direction ?? DEFAULT_DIRECTION;
  const edgeSpacing = d.spacing?.edge ?? DEFAULT_EDGE_SPACING;

  const layoutOptions: Record<string, string> = {
    "elk.algorithm": algorithm,
    "elk.direction": ELK_DIRECTION[direction],
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.spacing.nodeNode": String(d.spacing?.node ?? DEFAULT_NODE_SPACING),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(
      d.spacing?.layer ?? DEFAULT_LAYER_SPACING,
    ),
    "elk.spacing.edgeNode": String(d.spacing?.edgeNode ?? edgeSpacing),
    "elk.spacing.edgeEdge": String(d.spacing?.edgeEdge ?? edgeSpacing),
    "elk.padding": padding(DEFAULT_CONTAINER_PADDING),
  };

  // Lanes: each declared lane gets its own ELK partition. Spike (Phase 0)
  // confirmed INCLUDE_CHILDREN + partitioning preserves cross-lane edge routing,
  // which SEPARATE_CHILDREN silently drops.
  if (d.lanes?.length) {
    layoutOptions["elk.partitioning.activate"] = "true";
  }
  const lanePartition = new Map<string, number>();
  (d.lanes ?? []).forEach((id, i) => lanePartition.set(id, i));

  // ELK requires the parent/child tree nested at root; the AST stores it flat.
  const childIds = new Set<string>();
  for (const node of Object.values(d.nodes)) {
    for (const c of node.children ?? []) childIds.add(c);
  }
  const topLevelIds = Object.keys(d.nodes).filter((id) => !childIds.has(id));

  const buildNode = (id: string): ElkNode => {
    const node = d.nodes[id]!;
    const isContainer = !!node.children?.length;
    const elk: ElkNode = { id };
    const labels = nodeLabels(node);
    if (labels.length > 0) elk.labels = labels;
    if (isContainer) {
      elk.children = node.children!.map(buildNode);
      // ELK doesn't reserve interior space for compound-node labels, so
      // children would overlap the label band the renderer plants at the
      // container's top edge (verticalAlign:"top"). Inflate the top inset
      // by the rendered height (fontSize × 1.25) of every inside-top /
      // inside-center label — the placements the renderer stacks at top.
      // Defaults (18, 1.25) mirror the renderer's FONT_SIZE / LINE_HEIGHT.
      const labelStackPx = expandLabels(node)
        .filter((l) => {
          const at = effectiveNodeAt(l);
          return at === "inside-top" || at === "inside-center";
        })
        .reduce((sum, l) => sum + Math.ceil((l.style?.size ?? 18) * 1.25), 0);
      if (labelStackPx > 0) {
        const p = DEFAULT_CONTAINER_PADDING;
        elk.layoutOptions = {
          ...(elk.layoutOptions ?? {}),
          "elk.padding": `[top=${p + labelStackPx},left=${p},bottom=${p},right=${p}]`,
        };
      }
    } else {
      const sized = sizeLeafNode(node);
      elk.width = sized.width;
      elk.height = sized.height;
    }
    const partition = lanePartition.get(id);
    if (partition !== undefined) {
      elk.layoutOptions = {
        ...(elk.layoutOptions ?? {}),
        "elk.partitioning.partition": String(partition),
      };
    }
    return elk;
  };

  const children = topLevelIds.map(buildNode);

  const edges: ElkEdge[] = [];
  (d.edges ?? []).forEach((e, i) => {
    // Hyperedge sugar: explode N×M into N*M independent edges. ELK rejects
    // hyperedges in `layered`. ids: e<i> for first, e<i>_<j> for j=1..N-1 so
    // single-source/target edges keep their v1 id (snapshot-stable).
    const labels = edgeLabels(e);
    let j = 0;
    for (const from of toArray(e.from)) {
      for (const to of toArray(e.to)) {
        const id = explodedEdgeId(i, j);
        const elkEdge: ElkEdge = { id, sources: [from], targets: [to] };
        if (labels.length > 0) elkEdge.labels = labels.map(cloneLabel);
        edges.push(elkEdge);
        j++;
      }
    }
  });

  return {
    id: "root",
    layoutOptions,
    children,
    edges,
  };
}

function nodeLabels(node: Node): ElkLabel[] {
  return expandLabels(node).map((lbl) => buildElkLabel(lbl, "node"));
}

function edgeLabels(edge: Edge): ElkLabel[] {
  return expandLabels(edge).map((lbl) => buildElkLabel(lbl, "edge"));
}

function buildElkLabel(lbl: Label, kind: "node" | "edge"): ElkLabel {
  const fontSize = lbl.style?.size ?? (kind === "node" ? NODE_LABEL_HEIGHT : EDGE_LABEL_HEIGHT);
  // Edge labels never auto-wrap — only honor explicit \n. Bound node labels
  // are absorbed into the node box via sizeLeafNode; non-bound (outside-*)
  // node labels fall through here. Both branches honor explicit \n in
  // height — the renderer emits one <tspan> per line, so ELK must reserve
  // matching vertical space for layout + viewBox inclusion.
  const lines = lbl.text.split("\n");
  const longestLine = lines.reduce(
    (m, line) => Math.max(m, measureLineWidth(line, fontSize)),
    0,
  );
  const lineHeightPx = textLineHeight(fontSize);
  const { width, height } = ((): { width: number; height: number } => {
    if (kind === "edge") {
      return {
        width: Math.max(MIN_LABEL_WIDTH, longestLine),
        height: lines.length * lineHeightPx,
      };
    }
    return {
      width: estimateLabelWidth(lbl.text, fontSize),
      height: lines.length * lineHeightPx,
    };
  })();
  const elk: ElkLabel = { text: lbl.text, width, height };
  if (lbl.at !== undefined) {
    elk.layoutOptions =
      kind === "node"
        ? { "elk.nodeLabels.placement": NODE_AT_TO_ELK[effectiveNodeAt(lbl)] }
        : { "elk.edgeLabels.placement": EDGE_AT_TO_ELK[effectiveEdgeAt(lbl)] };
  }
  return elk;
}

// Sizes a leaf node so its bound label's wrapped block fits inside the shape's
// inscribed rectangle, plus NODE_TEXT_PADDING on each side. Floors at the
// historical defaults so labelless or tiny-label nodes keep their existing
// minimum footprint.
//
// User-supplied `width`/`height` override the auto-fit on that axis and
// constrain the wrap on the *width* axis: a long label in a pinned-narrow
// node re-wraps to fit, so render and desugar produce the same lines from
// the same final width.
//
// Two-pass shape: pass 1 picks an initial wrap to derive the auto width;
// pass 2 re-wraps from the *final* node width (after Math.max-flooring and
// ceil rounding) so the lines render against `laid.width` are byte-identical
// to what desugar fit into the box. Skipped when `node.width` is supplied —
// only one wrap pass needed since the target is known up-front.
function sizeLeafNode(node: Node): { width: number; height: number } {
  const bound = pickBoundLabel(node);
  if (!bound) {
    return {
      width: node.width ?? DEFAULT_NODE_WIDTH,
      height: node.height ?? DEFAULT_NODE_HEIGHT,
    };
  }
  const shape: Shape = node.shape ?? DEFAULT_SHAPE;
  const fontSize = bound.style?.size ?? NODE_LABEL_HEIGHT;
  const aspect = SHAPE_TEXT_ASPECT[shape];
  const pad = 2 * NODE_TEXT_PADDING;

  const { width, height } = ((): { width: number; height: number } => {
    // When width is pinned, derive the wrap target directly from the inscribed
    // inner width — no first pass needed.
    if (node.width !== undefined) {
      const innerTarget = innerWrapTarget(node.width, shape);
      const block = wrapToAspect(bound.text, fontSize, aspect, innerTarget);
      const bbox = inflateForShape(block.width, block.height, shape);
      return {
        width: node.width,
        height: node.height ?? Math.max(DEFAULT_NODE_HEIGHT, Math.ceil(bbox.h + pad)),
      };
    }
    // Two-pass: closed-form aspect target → final width → re-wrap to inner
    // target so render reproduces the same lines from `laid.width`.
    const first = wrapToAspect(bound.text, fontSize, aspect);
    const firstBbox = inflateForShape(first.width, first.height, shape);
    const finalWidth = Math.max(DEFAULT_NODE_WIDTH, Math.ceil(firstBbox.w + pad));
    const innerTarget = innerWrapTarget(finalWidth, shape);
    const second = wrapToAspect(bound.text, fontSize, aspect, innerTarget);
    const secondBbox = inflateForShape(second.width, second.height, shape);
    return {
      width: finalWidth,
      height: node.height ?? Math.max(DEFAULT_NODE_HEIGHT, Math.ceil(secondBbox.h + pad)),
    };
  })();
  return { width, height };
}

// Inner wrap target = the inscribed inner rectangle's width after removing
// padding and de-inflating for the shape. Render derives this same value
// from `laid.width` so both layers wrap to the identical target.
export function innerWrapTarget(nodeWidth: number, shape: Shape): number {
  const pad = 2 * NODE_TEXT_PADDING;
  return (nodeWidth - pad) / SHAPE_INFLATION[shape];
}

function pickBoundLabel(node: Node): Label | undefined {
  const labels = expandLabels(node);
  if (labels.length === 0) return undefined;
  for (const lbl of labels) {
    if (effectiveNodeAt(lbl) === DEFAULT_NODE_AT) return lbl;
  }
  return labels[0];
}

// ELK edge-id contract shared with the renderer: e<userIdx> for the first
// (and only, for non-array edges) explosion, e<userIdx>_<j> for j > 0.
export function explodedEdgeId(userIdx: number, j: number): string {
  return j === 0 ? `e${userIdx}` : `e${userIdx}_${j}`;
}

const EDGE_ID_RE = /^e(\d+)(?:_(\d+))?$/;

export function parseEdgeId(id: string): { userIdx: number; j: number } | undefined {
  const m = EDGE_ID_RE.exec(id);
  if (!m) return undefined;
  return { userIdx: parseInt(m[1]!, 10), j: m[2] ? parseInt(m[2], 10) : 0 };
}

function cloneLabel(lbl: ElkLabel): ElkLabel {
  const out: ElkLabel = { text: lbl.text };
  if (lbl.width !== undefined) out.width = lbl.width;
  if (lbl.height !== undefined) out.height = lbl.height;
  if (lbl.layoutOptions) out.layoutOptions = { ...lbl.layoutOptions };
  return out;
}

// Used only for non-bound node labels — auto-wrap belongs to bound labels
// (which size the node) and edge labels (which use EDGE_LABEL_ASPECT).
// Outside-* labels stay single-line by design.
function estimateLabelWidth(text: string, fontSize: number): number {
  const longest = text.split("\n").reduce((m, line) => Math.max(m, line.length), 0);
  return Math.max(MIN_LABEL_WIDTH, longest * textCharWidth(fontSize));
}

function padding(n: number): string {
  return `[top=${n},left=${n},bottom=${n},right=${n}]`;
}
