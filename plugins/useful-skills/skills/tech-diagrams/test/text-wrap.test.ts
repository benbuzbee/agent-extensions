import { describe, expect, it } from "vitest";
import {
  CHAR_WIDTH_FACTOR,
  EDGE_LABEL_ASPECT,
  LINE_HEIGHT_FACTOR,
  SHAPE_INFLATION,
  SHAPE_TEXT_ASPECT,
  charWidth,
  inflateForShape,
  lineHeight,
  measureLineWidth,
  targetWidthForAspect,
  wrapToAspect,
  wrapToWidth,
} from "../src/text/wrap.ts";
import type { Shape } from "../src/grammar/schema.ts";

const SHAPES: readonly Shape[] = ["rectangle", "ellipse", "diamond"];

describe("text/wrap — primitives", () => {
  describe("charWidth / lineHeight", () => {
    it("charWidth scales by CHAR_WIDTH_FACTOR for arbitrary font sizes", () => {
      for (const fs of [12, 14, 16, 18, 24, 32]) {
        expect(charWidth(fs)).toBe(fs * CHAR_WIDTH_FACTOR);
      }
    });

    it("lineHeight scales by LINE_HEIGHT_FACTOR for arbitrary font sizes", () => {
      for (const fs of [12, 14, 16, 18, 24, 32]) {
        expect(lineHeight(fs)).toBe(fs * LINE_HEIGHT_FACTOR);
      }
    });

    it("constants are positive and well-formed", () => {
      expect(CHAR_WIDTH_FACTOR).toBeGreaterThan(0);
      expect(LINE_HEIGHT_FACTOR).toBeGreaterThan(0);
      expect(EDGE_LABEL_ASPECT).toBeGreaterThan(0);
    });
  });

  describe("measureLineWidth", () => {
    it("returns 0 for empty string", () => {
      expect(measureLineWidth("", 18)).toBe(0);
    });

    it("scales linearly with string length for ASCII input", () => {
      const fs = 18;
      for (const s of ["a", "hello", "hello world", "supercalifragilistic"]) {
        expect(measureLineWidth(s, fs)).toBe(s.length * charWidth(fs));
      }
    });

    it("is monotonic in font size for fixed string", () => {
      const s = "hello";
      expect(measureLineWidth(s, 12)).toBeLessThan(measureLineWidth(s, 18));
      expect(measureLineWidth(s, 18)).toBeLessThan(measureLineWidth(s, 24));
    });
  });

  describe("inflateForShape", () => {
    it("scales (w, h) by SHAPE_INFLATION[shape] for each shape", () => {
      for (const shape of SHAPES) {
        const w = 100;
        const h = 50;
        const out = inflateForShape(w, h, shape);
        expect(out.w).toBe(w * SHAPE_INFLATION[shape]);
        expect(out.h).toBe(h * SHAPE_INFLATION[shape]);
      }
    });

    it("rectangle is identity (inflation === 1)", () => {
      const out = inflateForShape(123, 45, "rectangle");
      expect(out.w).toBe(123);
      expect(out.h).toBe(45);
    });

    it("ellipse inflation is √2", () => {
      expect(SHAPE_INFLATION.ellipse).toBe(Math.SQRT2);
    });

    it("diamond inflation is 2.0", () => {
      expect(SHAPE_INFLATION.diamond).toBe(2);
    });

    it("ellipse inscribed-rect containment: text block at ±w/2, ±h/2 satisfies (x/rx)² + (y/ry)² ≤ 1", () => {
      // Given a text block of size (w, h), the ellipse bbox is the inflated
      // (w·√2, h·√2). Then rx = bw/2 = w·√2/2, ry = bh/2 = h·√2/2. The four
      // corners of the text block sit at (±w/2, ±h/2); check they lie on or
      // inside the ellipse defined by (x/rx)² + (y/ry)² ≤ 1.
      for (const [w, h] of [[100, 50], [200, 100], [80, 80], [40, 120]] as const) {
        const bbox = inflateForShape(w, h, "ellipse");
        const rx = bbox.w / 2;
        const ry = bbox.h / 2;
        const corners: [number, number][] = [
          [w / 2, h / 2],
          [-w / 2, h / 2],
          [w / 2, -h / 2],
          [-w / 2, -h / 2],
        ];
        for (const [x, y] of corners) {
          const v = (x / rx) ** 2 + (y / ry) ** 2;
          // Equality at corners (max inscribed rect) — allow tiny FP slop.
          expect(v).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    });
  });

  describe("SHAPE_TEXT_ASPECT", () => {
    it("has an entry for every Shape variant", () => {
      for (const shape of SHAPES) {
        expect(SHAPE_TEXT_ASPECT[shape]).toBeGreaterThan(0);
      }
    });

    it("rectangle is widest, diamond narrowest (per design)", () => {
      expect(SHAPE_TEXT_ASPECT.rectangle).toBeGreaterThan(SHAPE_TEXT_ASPECT.ellipse);
      expect(SHAPE_TEXT_ASPECT.ellipse).toBeGreaterThan(SHAPE_TEXT_ASPECT.diamond);
    });
  });
});

describe("text/wrap — wrapToWidth", () => {
  const fs = 18;

  it("empty string → [\"\"]", () => {
    expect(wrapToWidth("", fs, 100)).toEqual([""]);
  });

  it("two short words at a tight target: 2 lines; each line fits", () => {
    // Pick a target between measureLineWidth("hello", fs) and
    // measureLineWidth("hello world", fs) so the greedy split must break
    // after "hello". Computing the threshold instead of hardcoding keeps
    // the test honest against future CHAR_WIDTH_FACTOR changes.
    const oneWord = measureLineWidth("hello", fs);
    const both = measureLineWidth("hello world", fs);
    const target = (oneWord + both) / 2;
    const lines = wrapToWidth("hello world", fs, target);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(measureLineWidth(line, fs)).toBeLessThanOrEqual(target);
    }
  });

  it("hard \\n wins over a huge target", () => {
    const lines = wrapToWidth("hello\nworld", fs, 9999);
    expect(lines).toEqual(["hello", "world"]);
  });

  it("single oversized word lands solo (no in-word break)", () => {
    const word = "supercalifragilistic";
    const target = measureLineWidth(word, fs) / 2; // half the word's width
    const lines = wrapToWidth(word, fs, target);
    expect(lines).toEqual([word]);
  });

  it("multi-word paragraph: every multi-word line fits the target", () => {
    const target = measureLineWidth("a b c", fs);
    const lines = wrapToWidth("a b c d e f g h i j", fs, target);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      if (line.includes(" ")) {
        expect(measureLineWidth(line, fs)).toBeLessThanOrEqual(target);
      }
    }
  });

  it("preserves paragraph order across hard breaks", () => {
    const lines = wrapToWidth("foo bar baz\nqux quux", fs, 9999);
    expect(lines).toEqual(["foo bar baz", "qux quux"]);
  });

  it("is deterministic: identical inputs → identical outputs", () => {
    const a = wrapToWidth("the quick brown fox jumps over the lazy dog", fs, 80);
    const b = wrapToWidth("the quick brown fox jumps over the lazy dog", fs, 80);
    expect(a).toEqual(b);
  });

  it("preserves a two-line label exactly when target is huge", () => {
    expect(wrapToWidth("gather.jsonl\n(rich IssueRow)", fs, 9999)).toEqual([
      "gather.jsonl",
      "(rich IssueRow)",
    ]);
  });

  it("whitespace-only paragraph collapses to single empty line", () => {
    expect(wrapToWidth("   ", fs, 100)).toEqual([""]);
  });

  it("bare \\n yields two empty lines (height-pinning behavior)", () => {
    expect(wrapToWidth("\n", fs, 100)).toEqual(["", ""]);
  });

  it("non-positive targetWidth still terminates; each word lands solo", () => {
    const lines = wrapToWidth("a b c", fs, 0);
    expect(lines).toEqual(["a", "b", "c"]);
  });
});

describe("text/wrap — wrapToAspect", () => {
  const fs = 18;

  it("targetWidthForAspect is positive for non-empty text", () => {
    expect(targetWidthForAspect("hello world", fs, 2.0)).toBeGreaterThan(0);
  });

  it("targetWidthForAspect scales as √(R·W·lineHeight)", () => {
    // Doubling R should multiply the target by √2.
    const a = targetWidthForAspect("the quick brown fox", fs, 2.0);
    const b = targetWidthForAspect("the quick brown fox", fs, 4.0);
    expect(b / a).toBeCloseTo(Math.SQRT2, 6);
  });

  it("single-word text → one line, width = measureLineWidth(word)", () => {
    const block = wrapToAspect("supercalifragilistic", fs, 2.0);
    expect(block.lines).toEqual(["supercalifragilistic"]);
    expect(block.width).toBe(measureLineWidth("supercalifragilistic", fs));
    expect(block.height).toBe(lineHeight(fs));
  });

  it("width === max measureLineWidth(line); height === N · lineHeight(fs)", () => {
    const block = wrapToAspect(
      "the quick brown fox jumps over the lazy dog and then keeps running",
      fs,
      2.0,
    );
    const expectedWidth = Math.max(
      ...block.lines.map((l) => measureLineWidth(l, fs)),
    );
    expect(block.width).toBe(expectedWidth);
    expect(block.height).toBe(block.lines.length * lineHeight(fs));
  });

  it("realised aspect for ≥ 2-line text is within ±50% of target R", () => {
    // Long enough to definitely wrap to ≥ 2 lines at R = 2.0.
    const text =
      "the quick brown fox jumps over the lazy dog and then keeps running through the night";
    const R = 2.0;
    const block = wrapToAspect(text, fs, R);
    expect(block.lines.length).toBeGreaterThanOrEqual(2);
    const realised = block.width / block.height;
    expect(realised).toBeGreaterThanOrEqual(R * 0.5);
    expect(realised).toBeLessThanOrEqual(R * 1.5);
  });

  it("deterministic: identical inputs → identical outputs", () => {
    const a = wrapToAspect("hello world goodbye sky", fs, 2.0);
    const b = wrapToAspect("hello world goodbye sky", fs, 2.0);
    expect(a).toEqual(b);
  });

  it("empty string → one empty line, width=0, height=lineHeight(fs)", () => {
    const block = wrapToAspect("", fs, 2.0);
    expect(block.lines).toEqual([""]);
    expect(block.width).toBe(0);
    expect(block.height).toBe(lineHeight(fs));
  });

  it("reports realised aspect across short/medium/long inputs (visibility)", () => {
    const cases: Array<[string, string]> = [
      ["short", "hello world"],
      ["medium", "the quick brown fox jumps over the lazy dog"],
      [
        "long",
        "the quick brown fox jumps over the lazy dog and then keeps running through the night without stopping for breath",
      ],
    ];
    const R = 2.0;
    // eslint-disable-next-line no-console
    const lines = cases.map(([name, text]) => {
      const block = wrapToAspect(text, fs, R);
      const realised = block.width / block.height;
      return `${name}: lines=${block.lines.length}, w=${block.width.toFixed(1)}, h=${block.height.toFixed(1)}, realised=${realised.toFixed(2)} (R=${R})`;
    });
    // Surface to test output so drift is visible during regression review.
    // eslint-disable-next-line no-console
    console.log("\n[wrapToAspect realised aspect]\n" + lines.join("\n"));
    expect(lines.length).toBe(3); // sanity guard
  });
});
