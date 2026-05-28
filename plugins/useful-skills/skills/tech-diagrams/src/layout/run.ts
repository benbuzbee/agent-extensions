import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { ElkRoot } from "../desugar/to-elk.ts";

export interface LaidOutPoint {
  x: number;
  y: number;
}

export interface LaidOutSection {
  startPoint: LaidOutPoint;
  endPoint: LaidOutPoint;
  bendPoints?: LaidOutPoint[];
}

export interface LaidOutLabel {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  labels?: LaidOutLabel[];
  children?: LaidOutNode[];
  edges?: LaidOutEdge[];
}

export interface LaidOutEdge {
  id: string;
  sources: string[];
  targets: string[];
  sections?: LaidOutSection[];
  labels?: LaidOutLabel[];
}

export interface LaidOut extends LaidOutNode {
  id: "root";
  edges?: LaidOutEdge[];
}

export async function layout(graph: ElkRoot): Promise<LaidOut> {
  const elk = new ELK();
  const result = (await elk.layout(graph as ElkNode)) as LaidOut;
  stripInternals(result);
  return result;
}

// elkjs (a GWT-compiled Java port) leaks internal hash counters like `$H`
// onto returned objects. They differ across runs and corrupt determinism /
// snapshotting without affecting layout. Strip them.
function stripInternals(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripInternals(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key.startsWith("$")) delete obj[key];
    else stripInternals(obj[key]);
  }
}
