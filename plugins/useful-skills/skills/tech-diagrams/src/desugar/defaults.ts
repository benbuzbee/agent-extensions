import type { Algorithm, Direction, Shape } from "../grammar/schema.ts";

export const DEFAULT_NODE_WIDTH = 160;
export const DEFAULT_NODE_HEIGHT = 60;
export const DEFAULT_CONTAINER_PADDING = 24;
export const DEFAULT_LAYOUT: Algorithm = "layered";
export const DEFAULT_DIRECTION: Direction = "right";
export const DEFAULT_SHAPE: Shape = "rectangle";
export const DEFAULT_NODE_SPACING = 40;
export const DEFAULT_LAYER_SPACING = 60;
export const DEFAULT_EDGE_SPACING = 20;

export const NODE_LABEL_HEIGHT = 18;
export const EDGE_LABEL_HEIGHT = 16;
export const MIN_LABEL_WIDTH = 40;
// Inner padding (each side) reserved between a node's wrapped text block
// and the shape's inscribed-rect boundary. Mirrored by render/to-svg.ts.
export const NODE_TEXT_PADDING = 12;

export const ELK_DIRECTION: Record<Direction, "RIGHT" | "DOWN" | "LEFT" | "UP"> = {
  right: "RIGHT",
  down: "DOWN",
  left: "LEFT",
  up: "UP",
};
