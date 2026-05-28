import { describe, expect, test } from "vitest";
import { laidOutOf } from "./util.ts";
import { getNode, walkAbs } from "../src/layout/walk.ts";

// ELK rounds positions to integers; 1.5 px tolerates that plus minor
// sub-pixel offsets ELK applies during edge routing.
const EPSILON = 1.5;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

describe("spatial — containment", () => {
  test("hierarchy: every child's bbox lies inside its parent's", async () => {
    const laid = await laidOutOf("hierarchy.yaml");
    const byId = new Map(Array.from(walkAbs(laid)).map((b) => [b.id, b]));
    for (const box of byId.values()) {
      if (!box.parentId) continue;
      const parent = byId.get(box.parentId);
      if (!parent) continue;
      expect(box.x).toBeGreaterThanOrEqual(parent.x - EPSILON);
      expect(box.y).toBeGreaterThanOrEqual(parent.y - EPSILON);
      expect(box.x + box.width).toBeLessThanOrEqual(parent.x + parent.width + EPSILON);
      expect(box.y + box.height).toBeLessThanOrEqual(parent.y + parent.height + EPSILON);
    }
  });
});

describe("spatial — non-overlap of siblings", () => {
  test("hierarchy: top-level siblings do not overlap", async () => {
    const laid = await laidOutOf("hierarchy.yaml");
    const top = Array.from(walkAbs(laid)).filter((b) => !b.parentId);
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i]!;
        const b = top[j]!;
        expect(rectsIntersect(a, b), `${a.id} and ${b.id} overlap`).toBe(false);
      }
    }
  });

  test("pipeline: all nodes non-overlapping", async () => {
    const laid = await laidOutOf("pipeline.yaml");
    const boxes = Array.from(walkAbs(laid));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          rectsIntersect(boxes[i]!, boxes[j]!),
          `${boxes[i]!.id} ↔ ${boxes[j]!.id}`,
        ).toBe(false);
      }
    }
  });
});

describe("spatial — direction sanity", () => {
  test("direction: right — for edge a→b, source is to the left of target", async () => {
    const laid = await laidOutOf("pipeline.yaml");
    for (const e of laid.edges ?? []) {
      const src = getNode(laid, e.sources[0]!);
      const tgt = getNode(laid, e.targets[0]!);
      expect(src.x + src.width).toBeLessThanOrEqual(tgt.x + EPSILON);
    }
  });

  test("direction: down — for edge a→b, source is above target", async () => {
    const laid = await laidOutOf("hierarchy.yaml");
    for (const e of laid.edges ?? []) {
      const src = getNode(laid, e.sources[0]!);
      const tgt = getNode(laid, e.targets[0]!);
      expect(src.y + src.height).toBeLessThanOrEqual(tgt.y + EPSILON);
    }
  });
});

describe("spatial — edge endpoints touch their bound boxes", () => {
  test("pipeline: edge start touches source bbox; end touches target bbox", async () => {
    const laid = await laidOutOf("pipeline.yaml");
    const onEdgeOf = (p: { x: number; y: number }, b: Rect) => {
      const onLeft = Math.abs(p.x - b.x) <= EPSILON;
      const onRight = Math.abs(p.x - (b.x + b.width)) <= EPSILON;
      const onTop = Math.abs(p.y - b.y) <= EPSILON;
      const onBottom = Math.abs(p.y - (b.y + b.height)) <= EPSILON;
      const insideX = p.x >= b.x - EPSILON && p.x <= b.x + b.width + EPSILON;
      const insideY = p.y >= b.y - EPSILON && p.y <= b.y + b.height + EPSILON;
      return ((onLeft || onRight) && insideY) || ((onTop || onBottom) && insideX);
    };
    for (const e of laid.edges ?? []) {
      const sec = e.sections![0]!;
      const src = getNode(laid, e.sources[0]!);
      const tgt = getNode(laid, e.targets[0]!);
      expect(onEdgeOf(sec.startPoint, src), `start of ${e.id} not on ${src.id}`).toBe(true);
      expect(onEdgeOf(sec.endPoint, tgt), `end of ${e.id} not on ${tgt.id}`).toBe(true);
    }
  });
});

describe("spatial — sane root bbox", () => {
  test.each([
    ["dataflow-mixed.yaml"],
    ["groups-nested.yaml"],
    ["colored-states.yaml"],
    ["large-30.yaml"],
  ])("%s total layout fits within a reasonable envelope", async (name) => {
    const laid = await laidOutOf(name);
    expect(laid.width).toBeLessThan(10000);
    expect(laid.height).toBeLessThan(10000);
    expect(laid.width).toBeGreaterThan(0);
    expect(laid.height).toBeGreaterThan(0);
  });
});

describe("spatial v2 — outside labels and edge label spread", () => {
  test("outside-top / outside-bottom labels lie outside the node bbox", async () => {
    const laid = await laidOutOf("multi-label-outside.yaml");
    const stack: any[] = [...(laid.children ?? [])];
    let api: any;
    while (stack.length) {
      const cur = stack.pop();
      if (cur.id === "api") {
        api = cur;
        break;
      }
      if (cur.children) stack.push(...cur.children);
    }
    expect(api).toBeDefined();
    const labels = api.labels ?? [];
    expect(labels.length).toBe(3);
    // Inside-center: lies within node bounds
    const inside = labels.find((l: any) => l.text === "API");
    expect(inside.x).toBeGreaterThanOrEqual(-EPSILON);
    expect(inside.y).toBeGreaterThanOrEqual(-EPSILON);
    expect(inside.x + inside.width).toBeLessThanOrEqual(api.width + EPSILON);
    expect(inside.y + inside.height).toBeLessThanOrEqual(api.height + EPSILON);
    // Outside-top: y is above the node (y < 0 in node-relative coords)
    const top = labels.find((l: any) => l.text === "v2");
    expect(top.y + top.height).toBeLessThanOrEqual(EPSILON);
    // Outside-bottom: y is below the node (y >= node.height)
    const bottom = labels.find((l: any) => l.text === "rest");
    expect(bottom.y).toBeGreaterThanOrEqual(api.height - EPSILON);
  });

  test("edge labels with start/middle/end spread along the edge", async () => {
    const laid = await laidOutOf("multi-label-edge.yaml");
    const edge = (laid.edges ?? [])[0]!;
    const labels = edge.labels ?? [];
    expect(labels.length).toBe(3);
    // direction:right ⇒ start.x < middle.x < end.x.
    const xs = labels.map((l) => l.x);
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
    const sec = edge.sections![0]!;
    const minX = Math.min(sec.startPoint.x, sec.endPoint.x) - EPSILON;
    const maxX = Math.max(sec.startPoint.x, sec.endPoint.x) + EPSILON;
    for (const lbl of labels) {
      expect(lbl.x + lbl.width).toBeGreaterThanOrEqual(minX);
      expect(lbl.x).toBeLessThanOrEqual(maxX);
    }
  });
});

describe("spatial — invariants on larger fixtures", () => {
  test("groups-nested: every grandchild lies inside its parent container", async () => {
    const laid = await laidOutOf("groups-nested.yaml");
    const byId = new Map(Array.from(walkAbs(laid)).map((b) => [b.id, b]));
    for (const box of byId.values()) {
      if (!box.parentId) continue;
      const parent = byId.get(box.parentId);
      if (!parent) continue;
      expect(box.x).toBeGreaterThanOrEqual(parent.x - EPSILON);
      expect(box.y).toBeGreaterThanOrEqual(parent.y - EPSILON);
      expect(box.x + box.width).toBeLessThanOrEqual(parent.x + parent.width + EPSILON);
      expect(box.y + box.height).toBeLessThanOrEqual(parent.y + parent.height + EPSILON);
    }
  });

  test("large-30: no two leaf siblings overlap (sample at root level)", async () => {
    const laid = await laidOutOf("large-30.yaml");
    const top = Array.from(walkAbs(laid)).filter((b) => !b.parentId);
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i]!;
        const b = top[j]!;
        expect(rectsIntersect(a, b), `${a.id} ↔ ${b.id}`).toBe(false);
      }
    }
  });
});
