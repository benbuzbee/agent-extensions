import { describe, expect, it } from "vitest";
import { validate } from "../src/grammar/validate.ts";
import { desugar } from "../src/desugar/to-elk.ts";
import { layout } from "../src/layout/run.ts";
import { toSvg } from "../src/render/to-svg.ts";
import { lineHeight as textLineHeight } from "../src/text/wrap.ts";

const FONT_SIZE = 18;

async function renderYaml(yaml: string): Promise<string> {
  const r = validate(yaml);
  if (!r.ok) throw new Error("yaml didn't validate: " + JSON.stringify(r.errors));
  return toSvg(r.diagram, await layout(desugar(r.diagram)));
}

function singleNodeYaml(
  label: string,
  shape: "rectangle" | "ellipse" | "diamond" = "rectangle",
): string {
  const lit = JSON.stringify(label);
  return `version: 1
nodes:
  n: { label: ${lit}, shape: ${shape} }
`;
}

function countTspans(svg: string): number {
  return (svg.match(/<tspan\b/g) ?? []).length;
}

describe("svg multi-line render", () => {
  it("single-line label emits no <tspan>", async () => {
    const svg = await renderYaml(singleNodeYaml("simple"));
    expect(countTspans(svg)).toBe(0);
    expect(svg).toContain(">simple</text>");
  });

  it("label with explicit \\n on a rectangle emits N tspans", async () => {
    const svg = await renderYaml(singleNodeYaml("line one\nline two", "rectangle"));
    expect(countTspans(svg)).toBe(2);
  });

  it("first tspan has no dy; subsequent tspans have dy=lineHeight(fs)", async () => {
    const svg = await renderYaml(singleNodeYaml("line one\nline two\nline three", "rectangle"));
    expect(countTspans(svg)).toBe(3);
    const tspans = [...svg.matchAll(/<tspan[^>]*>/g)].map((m) => m[0]);
    expect(tspans).toHaveLength(3);
    // First has no dy
    expect(tspans[0]).not.toMatch(/\bdy=/);
    // Rest have dy === lineHeight(FONT_SIZE)
    const expectedDy = textLineHeight(FONT_SIZE);
    expect(tspans[1]).toContain(`dy="${expectedDy}"`);
    expect(tspans[2]).toContain(`dy="${expectedDy}"`);
  });

  it("every tspan repeats dominant-baseline=\"central\" (WebKit fix)", async () => {
    const svg = await renderYaml(singleNodeYaml("a\nb\nc", "rectangle"));
    const tspans = svg.match(/<tspan\b[^>]*>/g) ?? [];
    expect(tspans).toHaveLength(3);
    for (const t of tspans) {
      expect(t).toContain('dominant-baseline="central"');
    }
  });

  it("ellipse with embedded \\n: tspans + ellipse element both present", async () => {
    // With the default 160×60 ellipse the inscribed inner width (≈102px) is
    // tighter than "(rich IssueRow)" (≈148px), so wrapping may re-split the
    // second paragraph and produce ≥ 2 lines.
    const svg = await renderYaml(singleNodeYaml("gather.jsonl\n(rich IssueRow)", "ellipse"));
    expect(svg).toContain("<ellipse");
    expect(countTspans(svg)).toBeGreaterThanOrEqual(2);
  });

  it("multi-line edge label emits N tspans", async () => {
    const yaml = `version: 1
nodes:
  a: { label: A }
  b: { label: B }
edges:
  - { from: a, to: b, label: "duplicates +\\nrelations" }
`;
    const svg = await renderYaml(yaml);
    // 1 from "A", 1 from "B" → 0 tspans. Plus 2 from edge label split.
    expect(countTspans(svg)).toBe(2);
  });

  it("parent <text y> for N≥2 lines is shifted by (N-1)·lineHeight/2 from center", async () => {
    // Use a long single-paragraph label with no \n on a rectangle wide enough
    // to wrap to ≥ 2 lines. Default 160px rectangle with 0.55 char-width and
    // 18pt font holds ~16 chars/line → long enough text guarantees a wrap.
    const longLabel = "the quick brown fox jumps over the lazy dog and then keeps running";
    const svg = await renderYaml(singleNodeYaml(longLabel, "rectangle"));
    const N = countTspans(svg);
    expect(N).toBeGreaterThanOrEqual(2);

    // Extract the rect to learn cy, and the parent <text> to read its y.
    const rectMatch = svg.match(/<rect[^>]*y="([-\d.]+)"[^>]*height="([-\d.]+)"/);
    expect(rectMatch).not.toBeNull();
    const ry = Number(rectMatch![1]);
    const rh = Number(rectMatch![2]);
    const cy = ry + rh / 2;

    // First <text> in the document containing tspans = the wrapped label.
    const labelMatch = svg.match(/<text[^>]*y="([-\d.]+)"[^>]*>\s*<tspan/);
    expect(labelMatch).not.toBeNull();
    const textY = Number(labelMatch![1]);

    const expectedStartY = cy - ((N - 1) * textLineHeight(FONT_SIZE)) / 2;
    expect(textY).toBeCloseTo(expectedStartY, 6);
  });

  it("escapes <, >, & inside tspans", async () => {
    const svg = await renderYaml(singleNodeYaml("Vec<String>\n& friends", "rectangle"));
    expect(svg).toContain("Vec&lt;String&gt;");
    expect(svg).toContain("&amp; friends");
    // Must not contain raw <String> inside a tspan body (would parse as a tag).
    expect(svg).not.toMatch(/<tspan[^>]*>[^<]*<String/);
  });
});
