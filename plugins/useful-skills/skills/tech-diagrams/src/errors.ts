import leven from "leven";

export type ErrorCode =
  | "missing_field"
  | "wrong_type"
  | "unknown_field"
  | "unknown_value"
  | "bad_reference"
  | "duplicate_id"
  | "cycle"
  | "yaml_parse"
  | "version_unsupported"
  | "usage"
  | "internal";

export interface ValidationError {
  path: string;
  code: ErrorCode;
  message: string;
  suggestion?: string;
}

export function emitErrors(errors: ValidationError[]): string {
  return JSON.stringify({ ok: false, errors }, null, 2);
}

const KNOWN_KEYS = {
  root: ["version", "layout", "direction", "spacing", "lanes", "nodes", "edges"],
  node: ["label", "labels", "shape", "width", "height", "children", "style"],
  edge: ["from", "to", "label", "labels", "style"],
  style: ["stroke", "fill", "fillStyle", "strokeStyle", "strokeWidth", "roughness"],
  edgeStyle: [
    "stroke",
    "fill",
    "fillStyle",
    "strokeStyle",
    "strokeWidth",
    "roughness",
    "startArrow",
    "endArrow",
  ],
  spacing: ["node", "layer", "edge", "edgeNode", "edgeEdge"],
  label: ["text", "at", "style"],
  labelStyle: ["color", "size"],
} as const;

export type KeyContext = keyof typeof KNOWN_KEYS;

export function suggestKey(badKey: string, context: KeyContext): string | undefined {
  return closest(badKey, KNOWN_KEYS[context], 2);
}

export function closest(input: string, candidates: readonly string[], maxDistance = 3): string | undefined {
  if (input.length > 64) return undefined;
  const lower = input.toLowerCase();
  let best: { word: string; d: number } | undefined;
  for (const c of candidates) {
    const d = leven(lower, c.toLowerCase());
    if (d <= maxDistance && (!best || d < best.d)) best = { word: c, d };
  }
  return best?.word;
}
