import { describe, expect, test } from "vitest";
import { laidOutOf } from "./util.ts";
import { walkAbs } from "../src/layout/walk.ts";

describe("layout — integration with elkjs", () => {
  test("every node has populated x, y, width, height", async () => {
    const laid = await laidOutOf("hierarchy.yaml");
    let leafCount = 0;
    for (const box of walkAbs(laid)) {
      expect(typeof box.x).toBe("number");
      expect(typeof box.y).toBe("number");
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      if (!box.hasChildren) leafCount++;
    }
    expect(leafCount).toBeGreaterThan(0);
  });

  test("every edge has a section with start and end points", async () => {
    const laid = await laidOutOf("pipeline.yaml");
    expect(laid.edges?.length).toBe(2);
    for (const e of laid.edges ?? []) {
      expect(e.sections?.length).toBeGreaterThanOrEqual(1);
      const sec = e.sections![0]!;
      expect(typeof sec.startPoint.x).toBe("number");
      expect(typeof sec.startPoint.y).toBe("number");
      expect(typeof sec.endPoint.x).toBe("number");
      expect(typeof sec.endPoint.y).toBe("number");
    }
  });

  test("layout is deterministic — 5 sequential runs produce identical output", async () => {
    // Sequential, not Promise.all — elkjs has module-level GWT state
    // and we only need to prove the public output is identical, not stress concurrency.
    const runs: string[] = [];
    for (let i = 0; i < 5; i++) {
      // bypass cache: reuse the cached layout call would defeat the point
      const { validate } = await import("../src/grammar/validate.ts");
      const { desugar } = await import("../src/desugar/to-elk.ts");
      const { layout } = await import("../src/layout/run.ts");
      const { readFixture } = await import("./util.ts");
      const r = validate(readFixture("dataflow-mixed.yaml"));
      if (!r.ok) throw new Error("fixture didn't validate");
      runs.push(JSON.stringify(await layout(desugar(r.diagram))));
    }
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toBe(runs[0]);
    }
  });

  test("layout finishes under 1s for typical fixtures", async () => {
    const start = Date.now();
    await laidOutOf("hierarchy.yaml");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  test("no $-prefixed elkjs internal keys leak through", async () => {
    const laid = await laidOutOf("pipeline.yaml");
    const json = JSON.stringify(laid);
    expect(json).not.toMatch(/"\$[A-Z]/);
  });

  test("lanes-down: declared lane order matches Y-axis stacking", async () => {
    const laid = await laidOutOf("lanes-down.yaml");
    const byId = new Map(laid.children!.map((c) => [c.id, c]));
    const yClient = byId.get("client")!.y;
    const yServer = byId.get("server")!.y;
    const yDb = byId.get("db")!.y;
    expect(yClient).toBeLessThan(yServer);
    expect(yServer).toBeLessThan(yDb);
  });

  test("lanes-right: declared lane order matches X-axis stacking", async () => {
    const laid = await laidOutOf("lanes-right.yaml");
    const byId = new Map(laid.children!.map((c) => [c.id, c]));
    const xSrc = byId.get("src")!.x;
    const xMid = byId.get("mid")!.x;
    const xDst = byId.get("dst")!.x;
    expect(xSrc).toBeLessThan(xMid);
    expect(xMid).toBeLessThan(xDst);
  });

  test("lanes preserves cross-lane edge routing (no edges silently dropped)", async () => {
    const laid = await laidOutOf("lanes-down.yaml");
    // 5 user-edges in fixture; INCLUDE_CHILDREN must keep all of them.
    expect((laid.edges ?? []).length).toBe(5);
    for (const e of laid.edges ?? []) {
      expect(e.sections?.length).toBeGreaterThanOrEqual(1);
    }
  });
});
