import { z } from "zod";

export const SHAPE = z.enum(["rectangle", "ellipse", "diamond"]);
export const FILL_STYLE = z.enum(["hachure", "solid", "cross-hatch"]);
export const STROKE_STYLE = z.enum(["solid", "dashed", "dotted"]);
export const STROKE_COLOR = z.enum([
  "black",
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
]);
export const FILL_COLOR = z.enum([
  "transparent",
  "gray-light",
  "red-light",
  "orange-light",
  "yellow-light",
  "green-light",
  "teal-light",
  "blue-light",
  "violet-light",
  "pink-light",
]);
export const DIRECTION = z.enum(["right", "down", "left", "up"]);
export const ALGORITHM = z.enum(["layered", "mrtree", "force"]);

export const NODE_LABEL_AT = z.enum([
  "inside-top",
  "inside-center",
  "inside-bottom",
  "outside-top",
  "outside-bottom",
  "outside-left",
  "outside-right",
]);
export const EDGE_LABEL_AT = z.enum(["start", "middle", "end"]);

// Excalidraw native arrowhead values, plus our own "none" alias for null.
// Triangle/diamond shapes serve UML class-diagram semantics; crowfoot variants
// are passed through so users who want ER notation get it for free.
export const ARROWHEAD = z.enum([
  "none",
  "arrow",
  "bar",
  "dot",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
  "crowfoot_zero_or_one",
  "crowfoot_one_or_more",
]);

export const StyleSchema = z
  .object({
    stroke: STROKE_COLOR.optional(),
    fill: FILL_COLOR.optional(),
    fillStyle: FILL_STYLE.optional(),
    strokeStyle: STROKE_STYLE.optional(),
    strokeWidth: z.number().int().min(1).max(4).optional(),
    roughness: z.number().int().min(0).max(2).optional(),
  })
  .strict();

// Edge style is a superset of node style. `startArrow`/`endArrow` are only
// meaningful on edges; keeping them off StyleSchema means `nodes.foo.style.startArrow`
// is rejected by strict mode rather than silently ignored.
export const EdgeStyleSchema = StyleSchema.extend({
  startArrow: ARROWHEAD.optional(),
  endArrow: ARROWHEAD.optional(),
}).strict();

export const LabelStyleSchema = z
  .object({
    color: STROKE_COLOR.optional(),
    size: z.number().positive().optional(),
  })
  .strict();

// `at` is validated per-context (node vs edge) in validate.ts so error
// messages can suggest the right enum. Schema keeps it as a free string.
export const LabelSchema = z
  .object({
    text: z.string().min(1),
    at: z.string().optional(),
    style: LabelStyleSchema.optional(),
  })
  .strict();

const StringOrStringArray = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const NodeSchema = z
  .object({
    label: z.string().optional(),
    labels: z.array(LabelSchema).optional(),
    shape: SHAPE.optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    children: z.array(z.string().min(1)).optional(),
    style: StyleSchema.optional(),
  })
  .strict();

export const EdgeSchema = z
  .object({
    from: StringOrStringArray,
    to: StringOrStringArray,
    label: z.string().optional(),
    labels: z.array(LabelSchema).optional(),
    style: EdgeStyleSchema.optional(),
  })
  .strict();

export const SpacingSchema = z
  .object({
    node: z.number().positive().optional(),
    layer: z.number().positive().optional(),
    edge: z.number().positive().optional(),
    edgeNode: z.number().positive().optional(),
    edgeEdge: z.number().positive().optional(),
  })
  .strict();

export const DiagramSchema = z
  .object({
    version: z.literal(1),
    layout: ALGORITHM.optional(),
    direction: DIRECTION.optional(),
    spacing: SpacingSchema.optional(),
    // Ordered list of container-node ids. Lanes stack along the flow direction
    // (each lane is one ELK partition); nodes inside each lane lay out locally.
    // Cross-lane edges still route through INCLUDE_CHILDREN. See desugar/to-elk.ts.
    lanes: z.array(z.string().min(1)).optional(),
    nodes: z.record(z.string().min(1), NodeSchema),
    edges: z.array(EdgeSchema).optional(),
  })
  .strict();

export type Diagram = z.infer<typeof DiagramSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Style = z.infer<typeof StyleSchema>;
export type EdgeStyle = z.infer<typeof EdgeStyleSchema>;
export type Arrowhead = z.infer<typeof ARROWHEAD>;
export type Label = z.infer<typeof LabelSchema>;
export type LabelStyle = z.infer<typeof LabelStyleSchema>;
export type Shape = z.infer<typeof SHAPE>;
export type FillStyle = z.infer<typeof FILL_STYLE>;
export type StrokeStyle = z.infer<typeof STROKE_STYLE>;
export type StrokeColor = z.infer<typeof STROKE_COLOR>;
export type FillColor = z.infer<typeof FILL_COLOR>;
export type Direction = z.infer<typeof DIRECTION>;
export type Algorithm = z.infer<typeof ALGORITHM>;
export type NodeLabelAt = z.infer<typeof NODE_LABEL_AT>;
export type EdgeLabelAt = z.infer<typeof EDGE_LABEL_AT>;
