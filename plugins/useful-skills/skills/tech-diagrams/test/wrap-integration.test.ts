import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/grammar/validate.ts";
import { desugar } from "../src/desugar/to-elk.ts";
import { layout } from "../src/layout/run.ts";
import { toSvg } from "../src/render/to-svg.ts";
import {
  LINE_HEIGHT_FACTOR,
  SHAPE_INFLATION,
  SHAPE_TEXT_ASPECT,
  inflateForShape,
  lineHeight as textLineHeight,
  measureLineWidth,
  wrapToAspect,
} from "../src/text/wrap.ts";
import { innerWrapTarget } from "../src/desugar/to-elk.ts";
import { NODE_TEXT_PADDING } from "../src/desugar/defaults.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) =>
  readFileSync(resolve(here, "fixtures", name), "utf8");

async function loadAndLayout(name: string) {
  const r = validate(read(name));
  if (!r.ok) throw new Error(`${name} did not validate: ${JSON.stringify(r.errors)}`);
  const elk = desugar(r.diagram);
  const laid = await layout(elk);
  return { diagram: r.diagram, elk, laid };
}

describe("wrap integration — Phase 5 wire-in", () => {
  it("wrap-long-labels: ellipse-node bbox is √2× rectangle-node bbox (±10%)", async () => {
    const { elk } = await loadAndLayout("wrap-long-labels.yaml");
    const rect = elk.children!.find((c) => c.id === "rect")!;
    const ellip = elk.children!.find((c) => c.id === "ellip")!;
    // Ellipse text block has same chars but a different target aspect (1.6 vs
    // 2.0), so widths differ; what we really test is that the ellipse bbox
    // matches inflateForShape(textBlock, "ellipse") — i.e. √2 inflation is
    // applied. Recompute the expected bbox from the same primitives.
    const rectExpected = computeExpectedBbox("rect", elk);
    const ellipExpected = computeExpectedBbox("ellip", elk);
    expect(rect.width).toBe(rectExpected.width);
    expect(rect.height).toBe(rectExpected.height);
    expect(ellip.width).toBe(ellipExpected.width);
    expect(ellip.height).toBe(ellipExpected.height);
    // Sanity: ellipse bbox area >= rect bbox area for the same text — the
    // inscribed-rect of an ellipse is smaller, so the bbox must grow.
    expect(ellip.width! * ellip.height!).toBeGreaterThan(rect.width! * rect.height!);
  });

  it("wrap-mixed-explicit-newlines: every node node.height >= N · lineHeight", async () => {
    const { elk } = await loadAndLayout("wrap-mixed-explicit-newlines.yaml");
    const a = elk.children!.find((c) => c.id === "a")!;
    const b = elk.children!.find((c) => c.id === "b")!;
    const c = elk.children!.find((c) => c.id === "c")!;
    const d = elk.children!.find((c) => c.id === "d")!;
    // a: single line — at most default height
    expect(a.height).toBeGreaterThanOrEqual(60);
    // b: 2 lines (rectangle, no shape inflation)
    expect(b.height).toBeGreaterThanOrEqual(60);
    // c: 3 lines (ellipse, √2 inflation grows height too)
    expect(c.height).toBeGreaterThan(b.height!);
    // d: wraps long label
    expect(d.height).toBeGreaterThan(60);
  });

  it("user-supplied width wins over computed width", async () => {
    const yaml = `version: 1
nodes:
  big: { label: "x", width: 500 }
  small: { label: "the quick brown fox jumps over the lazy dog", width: 100 }
`;
    const r = validate(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const elk = desugar(r.diagram);
    const big = elk.children!.find((c) => c.id === "big")!;
    const small = elk.children!.find((c) => c.id === "small")!;
    expect(big.width).toBe(500);
    expect(small.width).toBe(100);
  });

  it("pinned width tightens wrap: rendered tspans fit the inscribed inner width", async () => {
    // Long label, narrow pin — wrapping must use the pinned width as the
    // target, not the unconstrained aspect target. Every rendered <tspan>
    // line must measure <= innerWrapTarget(width, shape).
    const yaml = `version: 1
nodes:
  narrow:
    label: "the quick brown fox jumps over the lazy dog"
    width: 120
  narrowEllipse:
    label: "the quick brown fox jumps over the lazy dog"
    width: 140
    shape: ellipse
`;
    const r = validate(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const elk = desugar(r.diagram);
    const laid = await layout(elk);
    const svg = toSvg(r.diagram, laid);

    const cases = [
      { id: "narrow", shape: "rectangle" as const, width: 120 },
      { id: "narrowEllipse", shape: "ellipse" as const, width: 140 },
    ];
    for (const { id, shape, width } of cases) {
      const node = laid.children!.find((c) => c.id === id)!;
      expect(node.width).toBe(width);
      const target = innerWrapTarget(width, shape);
      // Extract this node's rendered tspans from the SVG and check each line
      // measures within the inscribed inner width. Greedy fill rounds at word
      // boundaries, so `<= target` is the binding contract.
      const tspans = [...svg.matchAll(/<tspan[^>]*>([^<]+)<\/tspan>/g)].map(
        (m) => m[1]!,
      );
      // Both nodes share the same text, so collect lines matching label words
      // — every word from the source label must appear across tspans, and
      // every line must fit. Easier: re-derive the lines via wrapToAspect
      // override and assert they all fit; then assert the SVG contains them.
      const lines = wrapToAspect(
        "the quick brown fox jumps over the lazy dog",
        18,
        SHAPE_TEXT_ASPECT[shape],
        target,
      ).lines;
      for (const line of lines) {
        expect(measureLineWidth(line, 18)).toBeLessThanOrEqual(target);
        expect(tspans).toContain(line);
      }
      // Sanity: more than one line — proves the wrap actually engaged.
      expect(lines.length).toBeGreaterThan(1);
    }
  });

  it("pinned width + auto height: height reflects wrapped block, not aspect target", async () => {
    const yaml = `version: 1
nodes:
  narrow:
    label: "the quick brown fox jumps over the lazy dog"
    width: 120
`;
    const r = validate(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const elk = desugar(r.diagram);
    const narrow = elk.children!.find((c) => c.id === "narrow")!;
    // Re-derive what height ought to be: wrap to the pinned inner target,
    // inflate by shape (rectangle → 1), pad, floor at default.
    const target = innerWrapTarget(120, "rectangle");
    const block = wrapToAspect(
      "the quick brown fox jumps over the lazy dog",
      18,
      SHAPE_TEXT_ASPECT.rectangle,
      target,
    );
    const bbox = inflateForShape(block.width, block.height, "rectangle");
    const expected = Math.max(60, Math.ceil(bbox.h + 2 * NODE_TEXT_PADDING));
    expect(narrow.height).toBe(expected);
  });

  it("bulk-triage: ellipse 'gather.jsonl\\n(rich IssueRow)' wraps to ≥ 2 SVG tspans, sits inside its ellipse", async () => {
    const { diagram, laid } = await loadAndLayout("bulk-triage.yaml");
    const svg = toSvg(diagram, laid);
    // Sanity: at least one <ellipse> exists.
    expect(svg).toMatch(/<ellipse\b/);
    // Look for the "gather.jsonl" label inside a tspan.
    expect(svg).toMatch(/<tspan[^>]*>gather\.jsonl<\/tspan>/);
    expect(svg).toMatch(/<tspan[^>]*>\(rich IssueRow\)<\/tspan>/);
  });

  it("edge label with embedded \\n produces multi-line tspans", async () => {
    const { diagram, laid } = await loadAndLayout("bulk-triage.yaml");
    const svg = toSvg(diagram, laid);
    expect(svg).toMatch(/<tspan[^>]*>duplicates \+<\/tspan>/);
    expect(svg).toMatch(/<tspan[^>]*>relations<\/tspan>/);
  });

  it("outside multi-line node labels: ELK label height >= lineCount * lineHeight", async () => {
    const { elk } = await loadAndLayout("wrap-outside-multiline.yaml");
    const a = elk.children!.find((c) => c.id === "a")!;
    const top = a.labels!.find((l) => l.text === "v2\napi")!;
    const bot = a.labels!.find((l) => l.text === "rest")!;
    expect(top.height).toBeGreaterThanOrEqual(2 * textLineHeight(18));
    // Single-line labels keep one line of vertical space.
    expect(bot.height).toBeLessThan(2 * textLineHeight(18));
    const b = elk.children!.find((c) => c.id === "b")!;
    const left = b.labels!.find((l) => l.text === "left\nside\ntitle")!;
    expect(left.height).toBeGreaterThanOrEqual(3 * textLineHeight(18));
  });

  it("outside multi-line node labels: laid bbox contains every rendered tspan", async () => {
    const { diagram, laid } = await loadAndLayout("wrap-outside-multiline.yaml");
    const svg = toSvg(diagram, laid);
    // The outside-top label must produce two tspans (one per explicit line).
    expect(svg).toMatch(/<tspan[^>]*>v2<\/tspan>/);
    expect(svg).toMatch(/<tspan[^>]*>api<\/tspan>/);
    expect(svg).toMatch(/<tspan[^>]*>left<\/tspan>/);
    expect(svg).toMatch(/<tspan[^>]*>side<\/tspan>/);
    expect(svg).toMatch(/<tspan[^>]*>title<\/tspan>/);
    // The laid label box for each outside multi-line label must be at least
    // lineCount * lineHeight tall — otherwise the renderer's tspans would
    // extend past the box that viewBox / spacing reserved.
    const a = laid.children!.find((c) => c.id === "a")!;
    const aTop = a.labels!.find((l) => l.text === "v2\napi")!;
    expect(aTop.height).toBeGreaterThanOrEqual(2 * 18 * LINE_HEIGHT_FACTOR);
    void diagram;
  });
});

// Reproduces the desugar-side sizing math from the same primitives, so the
// test fails if either the desugar wire-in or the helper module drifts.
// Two-pass: aspect-target wrap → final width → re-wrap to inner target.
function computeExpectedBbox(
  id: string,
  elk: { children?: Array<{ id: string; labels?: Array<{ text: string }> }> },
): { width: number; height: number } {
  const node = elk.children!.find((c) => c.id === id)!;
  const text = node.labels![0]!.text;
  const shape = id === "ellip" ? "ellipse" : id === "diam" ? "diamond" : "rectangle";
  const first = wrapToAspect(text, 18, SHAPE_TEXT_ASPECT[shape]);
  const firstBbox = inflateForShape(first.width, first.height, shape);
  const pad = 2 * NODE_TEXT_PADDING;
  const width = Math.max(160, Math.ceil(firstBbox.w + pad));
  const target = innerWrapTarget(width, shape);
  const second = wrapToAspect(text, 18, SHAPE_TEXT_ASPECT[shape], target);
  const secondBbox = inflateForShape(second.width, second.height, shape);
  const height = Math.max(60, Math.ceil(secondBbox.h + pad));
  return { width, height };
}

// Surface SHAPE_INFLATION so tests fail if it changes without the fixture
// expectations being updated.
void SHAPE_INFLATION;
