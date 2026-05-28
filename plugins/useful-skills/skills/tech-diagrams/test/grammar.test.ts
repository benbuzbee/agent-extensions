import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/grammar/validate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "fixtures");
const read = (name: string) => readFileSync(resolve(fixturesDir, name), "utf8");

describe("grammar — accepts valid fixtures", () => {
  test.each([["pipeline.yaml"], ["hierarchy.yaml"], ["dataflow-mixed.yaml"]])(
    "%s parses",
    (name) => {
      const result = validate(read(name));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.diagram.nodes).length).toBeGreaterThan(0);
      }
    },
  );
});

describe("grammar — rejects with expected error codes", () => {
  test("missing version → version_unsupported or missing_field", () => {
    const result = validate(read("invalid-missing-version.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("missing_field");
      const e = result.errors.find((x) => x.path === "version");
      expect(e).toBeDefined();
    }
  });

  test("typo'd enum value gets a suggestion", () => {
    const result = validate(read("invalid-typo-shape.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.errors.find((x) => x.path === "nodes.a.shape");
      expect(e).toBeDefined();
      expect(e?.code).toBe("unknown_value");
      expect(e?.suggestion).toContain("rectangle");
    }
  });

  test("edge references undeclared node", () => {
    const result = validate(read("invalid-bad-edge-ref.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.errors.find((x) => x.code === "bad_reference");
      expect(e).toBeDefined();
      expect(e?.path).toBe("edges[0].to");
    }
  });

  test("node cannot be its own child (cycle)", () => {
    const result = validate(read("invalid-self-child.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("cycle");
    }
  });

  test("multi-node cycle a→b→c→a is detected once", () => {
    const result = validate(read("invalid-multi-node-cycle.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const cycles = result.errors.filter((e) => e.code === "cycle");
      expect(cycles.length).toBe(1);
    }
  });

  test("node with two parents (duplicate_id)", () => {
    const result = validate(read("invalid-multi-parent.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain("duplicate_id");
    }
  });

  test("duplicate child within one parent", () => {
    const result = validate(read("invalid-duplicate-child.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "duplicate_id")).toBe(true);
    }
  });

  test("unknown field gets a typo suggestion", () => {
    const result = validate(read("invalid-unknown-key.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const e = result.errors.find((x) => x.code === "unknown_field");
      expect(e).toBeDefined();
      // 'lable' → 'label' or 'colour' → no close match for that one
      expect(e?.suggestion).toBeDefined();
    }
  });

  test("empty file fails with missing_field", () => {
    const result = validate(read("invalid-empty.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("missing_field");
    }
  });

  test("empty nodes object fails with missing_field", () => {
    const result = validate(read("invalid-empty-nodes.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "nodes")).toBe(true);
    }
  });

  test("bad version fails", () => {
    const result = validate(read("invalid-bad-version.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === "version")).toBe(true);
    }
  });

  test("yaml syntax error → yaml_parse code", () => {
    const result = validate(read("invalid-yaml-syntax.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("yaml_parse");
    }
  });
});

describe("grammar v2 — labels, edge arrays, at, label style", () => {
  test("node label and labels are mutually exclusive", () => {
    const result = validate(`
version: 1
nodes:
  a:
    label: A
    labels:
      - text: B
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.path === "nodes.a" && /both "label" and "labels"/.test(e.message),
        ),
      ).toBe(true);
    }
  });

  test("edge label and labels are mutually exclusive", () => {
    const result = validate(`
version: 1
nodes:
  a: { label: A }
  b: { label: B }
edges:
  - from: a
    to: b
    label: x
    labels:
      - text: y
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (e) => e.path === "edges[0]" && /both "label" and "labels"/.test(e.message),
        ),
      ).toBe(true);
    }
  });

  test("node at: valid value passes; invalid edge value gets node-context suggestion", () => {
    const ok = validate(`
version: 1
nodes:
  a:
    labels:
      - { text: A, at: outside-top }
`);
    expect(ok.ok).toBe(true);
    const bad = validate(`
version: 1
nodes:
  a:
    labels:
      - { text: A, at: middle }
`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const e = bad.errors.find((x) => x.path === "nodes.a.labels[0].at");
      expect(e).toBeDefined();
      expect(e?.code).toBe("unknown_value");
      // node-context suggestion should be one of the inside-* / outside-* values
      expect(e?.message).toMatch(/inside-/);
    }
  });

  test("edge at: valid value passes; invalid value gets edge-context message", () => {
    const ok = validate(`
version: 1
nodes:
  a: {}
  b: {}
edges:
  - from: a
    to: b
    labels:
      - { text: x, at: start }
`);
    expect(ok.ok).toBe(true);
    const bad = validate(`
version: 1
nodes:
  a: {}
  b: {}
edges:
  - from: a
    to: b
    labels:
      - { text: x, at: inside-top }
`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const e = bad.errors.find((x) => x.path === "edges[0].labels[0].at");
      expect(e).toBeDefined();
      expect(e?.code).toBe("unknown_value");
      expect(e?.message).toMatch(/start.*middle.*end|edge label position/);
    }
  });

  test("label requires text field", () => {
    const result = validate(`
version: 1
nodes:
  a:
    labels:
      - { at: inside-center }
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /text/.test(e.path) && e.code === "missing_field")).toBe(true);
    }
  });

  test("label style.size must be positive", () => {
    const result = validate(`
version: 1
nodes:
  a:
    labels:
      - { text: A, style: { size: -1 } }
`);
    expect(result.ok).toBe(false);
  });

  test("label style.color must be in stroke palette", () => {
    const bad = validate(`
version: 1
nodes:
  a:
    labels:
      - { text: A, style: { color: cerulean } }
`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.code === "unknown_value")).toBe(true);
    }
    const ok = validate(`
version: 1
nodes:
  a:
    labels:
      - { text: A, style: { color: blue, size: 14 } }
`);
    expect(ok.ok).toBe(true);
  });

  test("edge from: array fans-in", () => {
    const result = validate(`
version: 1
nodes:
  a: {}
  b: {}
  c: {}
edges:
  - from: [a, b]
    to: c
`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagram.edges?.[0]?.from).toEqual(["a", "b"]);
    }
  });

  test("edge to: array fans-out; bad ref in array surfaces with index path", () => {
    const ok = validate(`
version: 1
nodes:
  a: {}
  b: {}
  c: {}
edges:
  - from: a
    to: [b, c]
`);
    expect(ok.ok).toBe(true);
    const bad = validate(`
version: 1
nodes:
  a: {}
  b: {}
edges:
  - from: a
    to: [b, ghost]
`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.path === "edges[0].to[1]" && e.code === "bad_reference")).toBe(true);
    }
  });

  test("edge from and to may both be arrays", () => {
    const result = validate(`
version: 1
nodes:
  a: {}
  b: {}
  c: {}
  d: {}
edges:
  - from: [a, b]
    to: [c, d]
`);
    expect(result.ok).toBe(true);
  });

  test("spacing.edgeNode and edgeEdge accepted", () => {
    const result = validate(`
version: 1
spacing: { edgeNode: 30, edgeEdge: 10 }
nodes:
  a: {}
`);
    expect(result.ok).toBe(true);
  });

  test("edge style accepts startArrow and endArrow with valid values", () => {
    const ok = validate(`
version: 1
nodes:
  a: {}
  b: {}
edges:
  - from: a
    to: b
    style: { startArrow: diamond, endArrow: triangle_outline }
`);
    expect(ok.ok).toBe(true);
  });

  test("edge style rejects unknown arrow value with suggestion", () => {
    const bad = validate(`
version: 1
nodes:
  a: {}
  b: {}
edges:
  - from: a
    to: b
    style: { endArrow: triangel }
`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      // Zod-issued errors use dot notation throughout (no `[i]` brackets).
      const e = bad.errors.find((x) => x.path === "edges.0.style.endArrow");
      expect(e).toBeDefined();
      expect(e?.code).toBe("unknown_value");
      expect(e?.suggestion).toContain("triangle");
    }
  });

  test("startArrow on a node style is rejected (edge-only field)", () => {
    const bad = validate(`
version: 1
nodes:
  a:
    style: { startArrow: diamond }
`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.code === "unknown_field" && /startArrow/.test(e.message))).toBe(true);
    }
  });

  describe("lanes", () => {
    test("lanes referencing top-level container ids are accepted", () => {
      const r = validate(`
version: 1
direction: down
lanes: [front, back]
nodes:
  front:
    label: Front
    children: [ui]
  back:
    label: Back
    children: [api]
  ui: { label: UI }
  api: { label: API }
edges:
  - { from: ui, to: api }
`);
      expect(r.ok).toBe(true);
    });

    test("non-existent lane id → bad_reference with suggestion", () => {
      const r = validate(`
version: 1
lanes: [frnt]
nodes:
  front:
    label: Front
    children: [ui]
  ui: { label: UI }
`);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e = r.errors.find((x) => x.code === "bad_reference");
        expect(e).toBeDefined();
        expect(e?.path).toBe("lanes[0]");
        expect(e?.suggestion).toContain("front");
      }
    });

    test("lane that's a leaf (no children) is rejected", () => {
      const r = validate(`
version: 1
lanes: [a]
nodes:
  a: { label: A }
`);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e = r.errors.find((x) => x.code === "wrong_type" && /must be a container/.test(x.message));
        expect(e).toBeDefined();
        expect(e?.path).toBe("lanes[0]");
      }
    });

    test("lane that's a child of another node is rejected", () => {
      const r = validate(`
version: 1
lanes: [inner]
nodes:
  outer:
    children: [inner]
  inner:
    children: [leaf]
  leaf: { label: L }
`);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e = r.errors.find((x) => x.code === "wrong_type" && /must be top-level/.test(x.message));
        expect(e).toBeDefined();
        expect(e?.path).toBe("lanes[0]");
      }
    });

    test("duplicate lane id is rejected", () => {
      const r = validate(`
version: 1
lanes: [a, a]
nodes:
  a:
    children: [x]
  x: {}
`);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e = r.errors.find((x) => x.code === "duplicate_id" && x.path === "lanes[1]");
        expect(e).toBeDefined();
      }
    });
  });

  test("typo'd edge style key suggests startArrow / endArrow", () => {
    const bad = validate(`
version: 1
nodes:
  a: {}
  b: {}
edges:
  - from: a
    to: b
    style: { endArow: arrow }
`);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const e = bad.errors.find((x) => x.path === "edges.0.style");
      expect(e?.suggestion).toContain("endArrow");
    }
  });
});

describe("error format contract (agent-facing)", () => {
  test("every error has path, code, message", () => {
    const result = validate(read("invalid-typo-shape.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const e of result.errors) {
        expect(typeof e.path).toBe("string");
        expect(typeof e.code).toBe("string");
        expect(typeof e.message).toBe("string");
        expect(e.message.length).toBeGreaterThan(0);
      }
    }
  });

  test("messages are imperative-actionable, not raw stack traces", () => {
    const result = validate(read("invalid-bad-edge-ref.yaml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const e of result.errors) {
        expect(e.message).not.toMatch(/ZodError/);
        expect(e.message).not.toMatch(/at\s+\w+\.<anonymous>/);
      }
    }
  });
});
