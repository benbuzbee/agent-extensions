// Shared helpers for label expansion + `at` defaults. Both desugar and render
// reach through to the same shorthand expansion and default-position rules;
// keeping them in one place prevents the two layers from drifting apart.

import type { EdgeLabelAt, Label, NodeLabelAt } from "./schema.ts";

export const DEFAULT_NODE_AT: NodeLabelAt = "inside-center";
export const DEFAULT_EDGE_AT: EdgeLabelAt = "middle";

// `label: "X"` shorthand → labels[{text:"X"}]; `labels: [...]` passes through.
export function expandLabels(input: { label?: string; labels?: Label[] }): Label[] {
  if (input.labels && input.labels.length > 0) return input.labels;
  if (input.label !== undefined) return [{ text: input.label }];
  return [];
}

export function effectiveNodeAt(lbl: Label): NodeLabelAt {
  return (lbl.at as NodeLabelAt | undefined) ?? DEFAULT_NODE_AT;
}

export function effectiveEdgeAt(lbl: Label): EdgeLabelAt {
  return (lbl.at as EdgeLabelAt | undefined) ?? DEFAULT_EDGE_AT;
}

export function toArray<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : [x];
}
