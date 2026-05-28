import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/grammar/validate.ts";
import { desugar } from "../src/desugar/to-elk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "fixtures");
const read = (name: string) => readFileSync(resolve(fixturesDir, name), "utf8");

function loadAndDesugar(name: string) {
  const result = validate(read(name));
  if (!result.ok) throw new Error(`fixture ${name} did not validate`);
  return desugar(result.diagram);
}

describe("desugar — sugar to ELK conventions", () => {
  test("from/to becomes sources/targets", () => {
    const elk = loadAndDesugar("pipeline.yaml");
    expect(elk.edges).toBeDefined();
    expect(elk.edges?.[0]?.sources).toEqual(["ingest"]);
    expect(elk.edges?.[0]?.targets).toEqual(["transform"]);
  });

  test("label becomes labels[{text}]", () => {
    const elk = loadAndDesugar("pipeline.yaml");
    const ingest = elk.children?.find((n) => n.id === "ingest");
    expect(ingest?.labels).toBeDefined();
    expect(ingest?.labels?.[0]?.text).toBe("Ingest");
  });

  test("missing width/height get defaults on leaf nodes", () => {
    const elk = loadAndDesugar("pipeline.yaml");
    const ingest = elk.children?.find((n) => n.id === "ingest");
    expect(ingest?.width).toBe(160);
    expect(ingest?.height).toBe(60);
  });

  test("container nodes don't carry explicit width/height (ELK sizes them)", () => {
    const elk = loadAndDesugar("hierarchy.yaml");
    const app = elk.children?.find((n) => n.id === "app");
    expect(app?.children).toBeDefined();
    expect(app?.width).toBeUndefined();
    expect(app?.height).toBeUndefined();
    expect(app?.children?.map((c) => c.id).sort()).toEqual(["api", "worker"]);
  });

  test("only top-level (non-child) nodes appear at root", () => {
    const elk = loadAndDesugar("hierarchy.yaml");
    const topIds = elk.children?.map((c) => c.id) ?? [];
    expect(topIds).toContain("app");
    expect(topIds).toContain("db");
    expect(topIds).not.toContain("api");
    expect(topIds).not.toContain("worker");
  });

  test("layout + direction map to ELK layoutOptions", () => {
    const elk = loadAndDesugar("pipeline.yaml");
    expect(elk.layoutOptions["elk.algorithm"]).toBe("layered");
    expect(elk.layoutOptions["elk.direction"]).toBe("RIGHT");
    expect(elk.layoutOptions["elk.hierarchyHandling"]).toBe("INCLUDE_CHILDREN");
  });

  test("direction down maps to DOWN", () => {
    const elk = loadAndDesugar("hierarchy.yaml");
    expect(elk.layoutOptions["elk.direction"]).toBe("DOWN");
  });

  test("style fields are NOT leaked into ELK input", () => {
    const elk = loadAndDesugar("dataflow-mixed.yaml");
    const everyNodeJson = JSON.stringify(elk.children);
    expect(everyNodeJson).not.toContain("blue-light");
    expect(everyNodeJson).not.toContain("yellow-light");
    expect(everyNodeJson).not.toContain("fillStyle");
    const everyEdgeJson = JSON.stringify(elk.edges);
    expect(everyEdgeJson).not.toContain("dashed");
    expect(everyEdgeJson).not.toContain("strokeStyle");
  });

  test("edges get sequential ids e0, e1, ...", () => {
    const elk = loadAndDesugar("pipeline.yaml");
    expect(elk.edges?.map((e) => e.id)).toEqual(["e0", "e1"]);
  });

  test("edge label desugars to labels[{text}]", () => {
    const elk = loadAndDesugar("hierarchy.yaml");
    const edge = elk.edges?.[0];
    expect(edge?.labels?.[0]?.text).toBe("reads");
  });
});

describe("desugar v2 — multi-label, at, edge arrays, new spacings", () => {
  function elkOf(yaml: string) {
    const r = validate(yaml);
    if (!r.ok) throw new Error("yaml didn't validate: " + JSON.stringify(r.errors));
    return desugar(r.diagram);
  }

  test("label shorthand expands to labels[{text}]", () => {
    const elk = elkOf(`
version: 1
nodes:
  a: { label: "X" }
`);
    const a = elk.children?.find((n) => n.id === "a");
    expect(a?.labels?.length).toBe(1);
    expect(a?.labels?.[0]?.text).toBe("X");
    // No `at` set → no layoutOptions on the label (snapshot stability for v1).
    expect(a?.labels?.[0]?.layoutOptions).toBeUndefined();
  });

  test("node `at` maps to elk.nodeLabels.placement", () => {
    const elk = elkOf(`
version: 1
nodes:
  a:
    labels:
      - { text: A, at: outside-top }
      - { text: B, at: outside-right }
`);
    const a = elk.children?.find((n) => n.id === "a");
    expect(a?.labels?.[0]?.layoutOptions?.["elk.nodeLabels.placement"]).toBe(
      "OUTSIDE V_TOP H_CENTER",
    );
    expect(a?.labels?.[1]?.layoutOptions?.["elk.nodeLabels.placement"]).toBe(
      "OUTSIDE V_CENTER H_RIGHT",
    );
  });

  test("edge `at` maps to elk.edgeLabels.placement", () => {
    const elk = elkOf(`
version: 1
nodes:
  a: {}
  b: {}
edges:
  - from: a
    to: b
    labels:
      - { text: s, at: start }
      - { text: m, at: middle }
      - { text: e, at: end }
`);
    const e = elk.edges?.[0];
    expect(e?.labels?.[0]?.layoutOptions?.["elk.edgeLabels.placement"]).toBe("TAIL");
    expect(e?.labels?.[1]?.layoutOptions?.["elk.edgeLabels.placement"]).toBe("CENTER");
    expect(e?.labels?.[2]?.layoutOptions?.["elk.edgeLabels.placement"]).toBe("HEAD");
  });

  test("from/to arrays explode into N exploded edges", () => {
    const elk = elkOf(`
version: 1
nodes:
  a: {}
  b: {}
  c: {}
  d: {}
edges:
  - from: a
    to: [b, c, d]
`);
    expect(elk.edges?.map((e) => e.id)).toEqual(["e0", "e0_1", "e0_2"]);
    expect(elk.edges?.map((e) => e.sources[0])).toEqual(["a", "a", "a"]);
    expect(elk.edges?.map((e) => e.targets[0])).toEqual(["b", "c", "d"]);
  });

  test("exploded edges share the original edge's labels", () => {
    const elk = elkOf(`
version: 1
nodes:
  a: {}
  b: {}
  c: {}
edges:
  - from: a
    to: [b, c]
    labels:
      - { text: signal, at: middle }
`);
    expect(elk.edges?.length).toBe(2);
    for (const e of elk.edges ?? []) {
      expect(e.labels?.[0]?.text).toBe("signal");
      expect(e.labels?.[0]?.layoutOptions?.["elk.edgeLabels.placement"]).toBe("CENTER");
    }
    // Cloned, not aliased — mutating one must not affect another
    elk.edges![0]!.labels![0]!.text = "mutated";
    expect(elk.edges![1]!.labels![0]!.text).toBe("signal");
  });

  test("spacing.edgeNode and edgeEdge propagate into root layoutOptions", () => {
    const elk = elkOf(`
version: 1
spacing: { edgeNode: 30, edgeEdge: 12 }
nodes:
  a: {}
`);
    expect(elk.layoutOptions["elk.spacing.edgeNode"]).toBe("30");
    expect(elk.layoutOptions["elk.spacing.edgeEdge"]).toBe("12");
  });
});

describe("desugar — frozen snapshots", () => {
  test.each([
    ["pipeline.yaml"],
    ["hierarchy.yaml"],
    ["dataflow-mixed.yaml"],
    ["groups-nested.yaml"],
    ["colored-states.yaml"],
    ["large-30.yaml"],
    ["lanes-down.yaml"],
    ["lanes-right.yaml"],
  ])("%s ELK JSON snapshot", (name) => {
    const elk = loadAndDesugar(name);
    expect(elk).toMatchSnapshot();
  });
});

describe("desugar — lanes", () => {
  test("lanes activates ELK partitioning at the root", () => {
    const elk = loadAndDesugar("lanes-down.yaml");
    expect(elk.layoutOptions["elk.partitioning.activate"]).toBe("true");
    // INCLUDE_CHILDREN is preserved (Phase 0 spike confirmed cross-lane edges
    // require it; SEPARATE_CHILDREN drops them silently).
    expect(elk.layoutOptions["elk.hierarchyHandling"]).toBe("INCLUDE_CHILDREN");
  });

  test("each lane container carries its partition index", () => {
    const elk = loadAndDesugar("lanes-down.yaml");
    const byId = new Map(elk.children!.map((c) => [c.id, c]));
    expect(byId.get("client")?.layoutOptions?.["elk.partitioning.partition"]).toBe("0");
    expect(byId.get("server")?.layoutOptions?.["elk.partitioning.partition"]).toBe("1");
    expect(byId.get("db")?.layoutOptions?.["elk.partitioning.partition"]).toBe("2");
  });

  test("non-lane nodes (no `lanes:`) get no partition option set", () => {
    const elk = loadAndDesugar("hierarchy.yaml");
    expect(elk.layoutOptions["elk.partitioning.activate"]).toBeUndefined();
    for (const c of elk.children ?? []) {
      expect(c.layoutOptions?.["elk.partitioning.partition"]).toBeUndefined();
    }
  });
});
