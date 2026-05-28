import type { LaidOut, LaidOutNode } from "./run.ts";

export interface AbsBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string;
  hasChildren: boolean;
}

export function* walkAbs(root: LaidOut): Iterable<AbsBox> {
  const stack: { node: LaidOutNode; ox: number; oy: number; parentId?: string }[] = [];
  for (const c of root.children ?? []) stack.push({ node: c, ox: 0, oy: 0 });
  while (stack.length > 0) {
    const { node, ox, oy, parentId } = stack.pop()!;
    const absX = ox + node.x;
    const absY = oy + node.y;
    yield {
      id: node.id,
      x: absX,
      y: absY,
      width: node.width,
      height: node.height,
      parentId,
      hasChildren: !!node.children?.length,
    };
    for (const c of node.children ?? []) stack.push({ node: c, ox: absX, oy: absY, parentId: node.id });
  }
}

export function getNode(root: LaidOut, id: string): AbsBox {
  for (const box of walkAbs(root)) {
    if (box.id === id) return box;
  }
  throw new Error(`node "${id}" not found in laid-out graph`);
}
