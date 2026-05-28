import { describe, expect, test } from "vitest";
import { laidOutOf, readFixture } from "./util.ts";
import { validate } from "../src/grammar/validate.ts";
import {
  toExcalidraw,
  type ArrowElement,
  type ExcalidrawElement,
  type ShapeElement,
  type TextElement,
} from "../src/render/to-excalidraw.ts";
import { FILL_HEX, STROKE_HEX } from "../src/render/colors.ts";
import { nodeElementId } from "../src/render/ids.ts";
import type { Diagram } from "../src/grammar/schema.ts";

const FIXTURES = [
  "pipeline.yaml",
  "hierarchy.yaml",
  "dataflow-mixed.yaml",
  "groups-nested.yaml",
  "colored-states.yaml",
  "large-30.yaml",
  "multi-label-class.yaml",
  "fanout-array.yaml",
  "multi-label-edge.yaml",
  "lanes-down.yaml",
  "lanes-right.yaml",
  "class-diagram.yaml",
];

async function render(name: string) {
  const r = validate(readFixture(name));
  if (!r.ok) throw new Error(`fixture ${name} didn't validate`);
  return toExcalidraw(r.diagram, await laidOutOf(name));
}

// ────────── invariant helpers ──────────
type Box = { x1: number; y1: number; x2: number; y2: number };
const boxOf = (e: { x: number; y: number; width: number; height: number }): Box => ({
  x1: e.x,
  y1: e.y,
  x2: e.x + e.width,
  y2: e.y + e.height,
});
const overlaps = (a: Box, b: Box): boolean =>
  a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
const toArr = <T>(x: T | T[]): T[] => (Array.isArray(x) ? x : [x]);

// Structural invariants every valid scene must hold, regardless of layout
// algorithm or pixel positions. Each assertion identifies the offending
// node/edge by id in its message so a failure is actionable without grepping.
function checkInvariants(
  name: string,
  diagram: Diagram,
  scene: { elements: ExcalidrawElement[] },
): void {
  const real = scene.elements.filter((e) => e.opacity !== 0);
  const byId = new Map(real.map((e) => [e.id, e]));
  const nodes = diagram.nodes;
  const isContainer = (id: string): boolean => !!nodes[id]?.children?.length;

  // Recursive descendant list for a container id (excluding the container itself).
  const descendants = (id: string): string[] => {
    const out: string[] = [];
    for (const c of nodes[id]?.children ?? []) {
      out.push(c, ...descendants(c));
    }
    return out;
  };

  // 1. Every declared node has a shape element with the stable id.
  for (const id of Object.keys(nodes)) {
    expect(byId.has(nodeElementId(id)), `[${name}] node "${id}" missing its shape`).toBe(true);
  }

  // 2. Every container encloses all its descendants' shapes.
  for (const id of Object.keys(nodes)) {
    if (!isContainer(id)) continue;
    const cBox = boxOf(byId.get(nodeElementId(id))!);
    for (const d of descendants(id)) {
      const dShape = byId.get(nodeElementId(d));
      if (!dShape) continue;
      const dBox = boxOf(dShape);
      const slop = 1;
      const inside =
        dBox.x1 >= cBox.x1 - slop &&
        dBox.y1 >= cBox.y1 - slop &&
        dBox.x2 <= cBox.x2 + slop &&
        dBox.y2 <= cBox.y2 + slop;
      expect(inside, `[${name}] container "${id}" doesn't enclose descendant "${d}"`).toBe(true);
    }
  }

  // 3. A container's bound label (the one bound via containerId) doesn't
  //    overlap any descendant shape — the bug user surfaced.
  for (const id of Object.keys(nodes)) {
    if (!isContainer(id)) continue;
    const shapeId = nodeElementId(id);
    const label = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.containerId === shapeId,
    );
    if (!label) continue;
    const lBox = boxOf(label);
    for (const d of descendants(id)) {
      const dShape = byId.get(nodeElementId(d));
      if (!dShape) continue;
      expect(
        overlaps(lBox, boxOf(dShape)),
        `[${name}] container "${id}" label "${label.text}" overlaps descendant "${d}"`,
      ).toBe(false);
    }
  }

  // 4. Sibling shapes don't overlap (containers or leaves). Recurse into each
  //    container's children to check inner sibling sets too.
  const checkSiblings = (siblings: string[]): void => {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = byId.get(nodeElementId(siblings[i]!));
        const b = byId.get(nodeElementId(siblings[j]!));
        if (!a || !b) continue;
        expect(
          overlaps(boxOf(a), boxOf(b)),
          `[${name}] siblings "${siblings[i]}" and "${siblings[j]}" overlap`,
        ).toBe(false);
      }
    }
    for (const id of siblings) {
      if (isContainer(id)) checkSiblings(nodes[id]!.children!);
    }
  };
  const childIds = new Set<string>();
  for (const n of Object.values(nodes)) for (const c of n.children ?? []) childIds.add(c);
  const topIds = Object.keys(nodes).filter((id) => !childIds.has(id));
  checkSiblings(topIds);

  // 5. Every (from, to) pair from the input edges — after array explosion —
  //    produces exactly one arrow whose start/end bindings point to those
  //    nodes' shape ids. Layout-agnostic; catches wrong-shape, missing-arrow,
  //    and miscounted-explosion bugs in one check.
  const arrows = scene.elements.filter((e): e is ArrowElement => e.type === "arrow");
  const tally = (pairs: string[]): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const k of pairs) m[k] = (m[k] ?? 0) + 1;
    return m;
  };
  const expectedPairs: string[] = [];
  for (const e of diagram.edges ?? []) {
    for (const f of toArr(e.from)) {
      for (const t of toArr(e.to)) {
        expectedPairs.push(`${nodeElementId(f)}->${nodeElementId(t)}`);
      }
    }
  }
  const arrowPairs = arrows.map(
    (a) => `${a.startBinding?.elementId ?? ""}->${a.endBinding?.elementId ?? ""}`,
  );
  expect(tally(arrowPairs), `[${name}] arrow bindings don't match input edges`).toEqual(
    tally(expectedPairs),
  );

  // 6. Two opacity-0 corner spacers exist and enclose every real element's bbox.
  const spacers = scene.elements.filter((e) => e.opacity === 0);
  expect(spacers.length, `[${name}] spacer count`).toBe(2);
  const sMinX = Math.min(...spacers.map((s) => s.x));
  const sMinY = Math.min(...spacers.map((s) => s.y));
  const sMaxX = Math.max(...spacers.map((s) => s.x + s.width));
  const sMaxY = Math.max(...spacers.map((s) => s.y + s.height));
  for (const e of real) {
    expect(e.x).toBeGreaterThanOrEqual(sMinX);
    expect(e.y).toBeGreaterThanOrEqual(sMinY);
    expect(e.x + e.width).toBeLessThanOrEqual(sMaxX);
    expect(e.y + e.height).toBeLessThanOrEqual(sMaxY);
  }

  // 7. All element ids unique.
  const ids = scene.elements.map((e) => e.id);
  expect(new Set(ids).size, `[${name}] duplicate element ids`).toBe(ids.length);
}

describe("render — top-level scene structure", () => {
  test("scene has Excalidraw file format envelope", async () => {
    const scene = await render("pipeline.yaml");
    expect(scene.type).toBe("excalidraw");
    expect(scene.version).toBe(2);
    expect(typeof scene.source).toBe("string");
    expect(Array.isArray(scene.elements)).toBe(true);
    expect(scene.elements.length).toBeGreaterThan(0);
    expect(scene.appState).toBeDefined();
    expect(scene.files).toEqual({});
  });
});

describe("render — structural invariants across fixtures", () => {
  test.each(FIXTURES.map((f) => [f]))("%s", async (name) => {
    const r = validate(readFixture(name));
    if (!r.ok) throw new Error(`fixture ${name} didn't validate`);
    const scene = toExcalidraw(r.diagram, await laidOutOf(name));
    checkInvariants(name, r.diagram, scene);
  });
});

describe("render — node elements", () => {
  test("each input node produces a shape element of the right type", async () => {
    const scene = await render("dataflow-mixed.yaml");
    const shapeByLabel = new Map<string, ShapeElement>();
    for (const el of scene.elements) {
      if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
        const text = scene.elements.find(
          (t): t is TextElement => t.type === "text" && t.containerId === el.id,
        );
        if (text) shapeByLabel.set(text.text, el);
      }
    }
    expect(shapeByLabel.get("User")?.type).toBe("ellipse");
    expect(shapeByLabel.get("Validate")?.type).toBe("diamond");
    expect(shapeByLabel.get("Store")?.type).toBe("rectangle");
  });

  test("style.fill maps to Excalidraw palette hex", async () => {
    const scene = await render("hierarchy.yaml");
    const dbText = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "Postgres",
    );
    expect(dbText).toBeDefined();
    const dbShape = scene.elements.find((e) => e.id === dbText!.containerId);
    expect(dbShape?.backgroundColor).toBe(FILL_HEX["blue-light"]);
  });

  test("default stroke is black hex", async () => {
    const scene = await render("pipeline.yaml");
    const ingest = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "Ingest",
    );
    const shape = scene.elements.find((e) => e.id === ingest?.containerId);
    expect(shape?.strokeColor).toBe(STROKE_HEX.black);
  });
});

describe("render — arrows and bindings", () => {
  test("edge labels become text elements bound to the arrow", async () => {
    const scene = await render("hierarchy.yaml");
    const reads = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "reads",
    );
    expect(reads).toBeDefined();
    expect(reads?.containerId).toBeDefined();
    const arrow = scene.elements.find((e) => e.id === reads!.containerId);
    expect(arrow?.type).toBe("arrow");
    expect(arrow?.boundElements?.some((b) => b.id === reads!.id && b.type === "text")).toBe(true);
  });

  test("startArrow / endArrow on edge style propagate to Excalidraw arrowheads", async () => {
    const scene = await render("class-diagram.yaml");
    const arrows = scene.elements.filter((e): e is ArrowElement => e.type === "arrow");
    // Edges in fixture order: inheritance, composition, aggregation, dependency, double-ended, none.
    expect(arrows.length).toBe(6);
    const [inheritance, composition, aggregation, dependency, double, noneArrow] = arrows;
    expect(inheritance!.startArrowhead).toBeNull();
    expect(inheritance!.endArrowhead).toBe("triangle_outline");
    expect(composition!.startArrowhead).toBe("diamond");
    expect(composition!.endArrowhead).toBe("arrow");
    expect(aggregation!.startArrowhead).toBe("diamond_outline");
    expect(aggregation!.endArrowhead).toBe("arrow");
    expect(dependency!.startArrowhead).toBeNull();
    expect(dependency!.endArrowhead).toBe("arrow");
    expect(dependency!.strokeStyle).toBe("dashed");
    expect(double!.startArrowhead).toBe("arrow");
    expect(double!.endArrowhead).toBe("arrow");
    // "none" is a schema alias that maps to Excalidraw's null.
    expect(noneArrow!.startArrowhead).toBeNull();
    expect(noneArrow!.endArrowhead).toBeNull();
  });
});

describe("render — text/label elements", () => {
  test("text element has font family + size + lineHeight", async () => {
    const scene = await render("pipeline.yaml");
    const texts = scene.elements.filter((e): e is TextElement => e.type === "text");
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t.fontSize).toBeGreaterThan(0);
      expect(t.fontFamily).toBeGreaterThan(0);
      expect(t.lineHeight).toBeGreaterThan(0);
      expect(t.text.length).toBeGreaterThan(0);
      expect(t.originalText).toBe(t.text);
    }
  });
});

describe("render — id stability and format", () => {
  test("same input → identical element ids", async () => {
    const scene1 = await render("pipeline.yaml");
    const scene2 = await render("pipeline.yaml");
    const ids1 = scene1.elements.map((e) => e.id).sort();
    const ids2 = scene2.elements.map((e) => e.id).sort();
    expect(ids1).toEqual(ids2);
  });

  test("ids are 21-char base64url", async () => {
    const scene = await render("hierarchy.yaml");
    for (const el of scene.elements) {
      expect(el.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    }
  });
});

describe("render — multi-label, exploded edges, vcenter, group-binding", () => {
  test("multi-label node produces N text elements, exactly one container-bound", async () => {
    const scene = await render("multi-label-class.yaml");
    const userTexts = scene.elements.filter(
      (e): e is TextElement => e.type === "text" && e.text === "User",
    );
    const stereoTexts = scene.elements.filter(
      (e): e is TextElement => e.type === "text" && e.text === "<<entity>>",
    );
    const fieldTexts = scene.elements.filter(
      (e): e is TextElement => e.type === "text" && e.text === "+ id: UUID",
    );
    expect(userTexts.length).toBe(1);
    expect(stereoTexts.length).toBe(1);
    expect(fieldTexts.length).toBe(1);
    // The inside-center label is container-bound; inside-top / inside-bottom labels are free.
    const userShape = scene.elements.find((e) => e.id === stereoTexts[0]!.containerId);
    expect(userShape).toBeDefined();
    expect(userShape?.type).toBe("rectangle");
    expect(userTexts[0]!.containerId).toBeNull();
    expect(fieldTexts[0]!.containerId).toBeNull();
  });

  test("multi-label node: shape and all labels share a groupIds entry", async () => {
    const scene = await render("multi-label-class.yaml");
    const stereo = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "<<entity>>",
    )!;
    const shape = scene.elements.find((e) => e.id === stereo.containerId)!;
    expect(shape.groupIds.length).toBe(1);
    const gid = shape.groupIds[0]!;
    for (const text of ["User", "<<entity>>", "+ id: UUID"]) {
      const t = scene.elements.find((e): e is TextElement => e.type === "text" && e.text === text)!;
      expect(t.groupIds).toContain(gid);
    }
  });

  test("per-label color and size apply to the text element", async () => {
    const scene = await render("multi-label-class.yaml");
    const stereo = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "<<entity>>",
    )!;
    expect(stereo.fontSize).toBe(12);
    expect(stereo.strokeColor).toBe(STROKE_HEX.gray);
    const title = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "User",
    )!;
    expect(title.fontSize).toBe(20);
  });

  test("vertical-center fix: bound text on a leaf is centered in the shape (math)", async () => {
    const scene = await render("pipeline.yaml");
    const ingest = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "Ingest",
    )!;
    const shape = scene.elements.find((e) => e.id === ingest.containerId)!;
    const expectedY = shape.y + (shape.height - ingest.height) / 2;
    expect(ingest.y).toBeCloseTo(expectedY, 4);
  });

  test("array `to:` explodes into N arrows from the same source", async () => {
    const scene = await render("fanout-array.yaml");
    const arrows = scene.elements.filter((e): e is ArrowElement => e.type === "arrow");
    expect(arrows.length).toBe(4);
    const sourceText = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "Source",
    )!;
    const sourceShapeId = sourceText.containerId;
    for (const a of arrows) {
      expect(a.startBinding!.elementId).toBe(sourceShapeId);
    }
  });

  test("multi-label edge: 3 text elements; start/end free, middle container-bound", async () => {
    const scene = await render("multi-label-edge.yaml");
    const reqText = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "request",
    )!;
    const tlsText = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "TLS 1.3",
    )!;
    const respText = scene.elements.find(
      (e): e is TextElement => e.type === "text" && e.text === "response",
    )!;
    expect(reqText.containerId).toBeNull();
    expect(respText.containerId).toBeNull();
    const arrow = scene.elements.find((e) => e.id === tlsText.containerId);
    expect(arrow?.type).toBe("arrow");
    expect(tlsText.fontSize).toBe(12);
    expect(tlsText.strokeColor).toBe(STROKE_HEX.blue);
    const gid = arrow!.groupIds[0];
    expect(gid).toBeDefined();
    expect(reqText.groupIds).toContain(gid);
    expect(tlsText.groupIds).toContain(gid);
    expect(respText.groupIds).toContain(gid);
  });

  test("single-label node has no groupIds (preserves v1 behavior)", async () => {
    const scene = await render("pipeline.yaml");
    for (const el of scene.elements) {
      expect(el.groupIds).toEqual([]);
    }
  });
});

describe("render — semantic content survives the pipeline", () => {
  test.each([
    ["pipeline.yaml", ["Ingest", "Transform", "Load"]],
    ["hierarchy.yaml", ["Application", "API", "Worker", "Postgres", "reads", "writes"]],
    ["dataflow-mixed.yaml", ["User", "Validate", "Store", "Reject", "ok", "fail"]],
  ])("%s contains all expected text labels", async (name, expectedTexts) => {
    const scene = await render(name);
    const allText = new Set(
      scene.elements.filter((e): e is TextElement => e.type === "text").map((e) => e.text),
    );
    for (const expected of expectedTexts) {
      expect(allText.has(expected), `missing label "${expected}" in ${name}`).toBe(true);
    }
  });
});
