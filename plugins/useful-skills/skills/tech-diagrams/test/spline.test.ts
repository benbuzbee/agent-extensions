// Validates `sampleSpline` against measured-ink data. To re-measure a case:
//   1. Build a one-element .excalidraw scene with the listed `points`,
//      strokeWidth: 2, roughness: 0, no arrowheads.
//   2. Render via `excalirender -b "#ff0000"` to PNG.
//   3. Decode the PNG and find the bbox of non-red pixels — the rendered ink.
//   4. Subtract excalirender's scene padding (20px each side, hard-coded in
//      excalirender's current release) to express ink relative to the
//      element's origin.
//
// Tolerance budget on the enclosure check: 2px = ~1px stroke half-width + ~1px
// anti-alias spillover. The drift check uses 3px to also absorb sampling
// step error (analytic peak vs. nearest of 16 samples per segment).

import { describe, expect, it } from "vitest";
import { aabb, sampleSpline } from "../src/render/spline.ts";

interface Case {
  name: string;
  points: [number, number][];
  // PNG-pixel ink bbox relative to element origin (after subtracting
  // excalirender's 20px scene padding from PNG pixel coords).
  measured: { minX: number; minY: number; maxX: number; maxY: number };
  // Whether the measured value on each axis was clipped at the PNG canvas
  // edge. Excalirender sizes the canvas from element x/y/w/h alone, so when
  // the curve bows past those bounds the ink hits the canvas edge and the
  // true extent is only known to be ≥ |measured|. Clipped axes still must
  // be enclosed by the prediction, but we can't measure tight drift on them.
  clipped: { minX: boolean; minY: boolean; maxX: boolean; maxY: boolean };
}

// 3-point sharp L: (0,100) → (0,0) → (200,0).
// PNG 240x140 (canvas edges at PNG x=0..239, y=0..139), ink (4,11)-(219,119);
// no axis at canvas edge → all measurements are real, not clipped.
// Element origin at PNG (20,20), so ink-relative-to-origin is
// (4-20, 11-20)-(219-20, 119-20) = (-16, -9)-(199, 99).
const CASE_L: Case = {
  name: "3-point L",
  points: [[0, 100], [0, 0], [200, 0]],
  measured: { minX: -16, minY: -9, maxX: 199, maxY: 99 },
  clipped: { minX: false, minY: false, maxX: false, maxY: false },
};

// 4-point hook: (0,200) → (0,0) → (300,0) → (300,50).
// PNG 340x240, ink (0,2)-(339,219) in PNG coords. PNG x=0 and x=339 hit the
// canvas left and right edges (clipped); PNG y=2 and y=219 are interior
// (real). After subtracting 20px padding the literals below are in
// element-space: -20 / 319 are the canvas extremes, -18 / 199 are real.
const CASE_HOOK: Case = {
  name: "4-point hook",
  points: [[0, 200], [0, 0], [300, 0], [300, 50]],
  measured: { minX: -20, minY: -18, maxX: 319, maxY: 199 },
  clipped: { minX: true, minY: false, maxX: true, maxY: false },
};

// 4-point U-loop, rough=0: (0,0) → (0,-100) → (150,-100) → (150,0). The
// declared element height is 0 (start and end both at y=0), so a single-
// element scene clips the entire upper bow at the canvas top. Two invisible
// 1×1 spacers at world (30,80) and (220,80) force a 231×160 PNG; the result
// is ink (28,26)-(201,139) at element origin (40,140), i.e. element-relative
// ink (-12,-114)-(161,-1). All four axes are then real.
const CASE_U: Case = {
  name: "4-point U-loop (full canvas via invisible spacers)",
  points: [[0, 0], [0, -100], [150, -100], [150, 0]],
  measured: { minX: -12, minY: -114, maxX: 161, maxY: -1 },
  clipped: { minX: false, minY: false, maxX: false, maxY: false },
};

const CASES = [CASE_L, CASE_HOOK, CASE_U];

describe("sampleSpline", () => {
  it("returns points unchanged for 0/1/2 control points (degenerate or straight)", () => {
    expect(sampleSpline([])).toEqual([]);
    expect(sampleSpline([[10, 20]])).toEqual([[10, 20]]);
    expect(sampleSpline([[0, 0], [100, 50]])).toEqual([[0, 0], [100, 50]]);
  });

  // See file header re: tolerance budget (TOL=2, TIGHT=3).
  it.each(CASES)("predicted bbox encloses measured ink for $name", (c) => {
    const samples = sampleSpline(c.points);
    const [minX, minY, maxX, maxY] = aabb(samples);
    const TOL = 2;
    expect(minX, `minX: predicted ${minX} should be ≤ measured ${c.measured.minX} + ${TOL}`)
      .toBeLessThanOrEqual(c.measured.minX + TOL);
    expect(minY, `minY: predicted ${minY} should be ≤ measured ${c.measured.minY} + ${TOL}`)
      .toBeLessThanOrEqual(c.measured.minY + TOL);
    expect(maxX, `maxX: predicted ${maxX} should be ≥ measured ${c.measured.maxX} - ${TOL}`)
      .toBeGreaterThanOrEqual(c.measured.maxX - TOL);
    expect(maxY, `maxY: predicted ${maxY} should be ≥ measured ${c.measured.maxY} - ${TOL}`)
      .toBeGreaterThanOrEqual(c.measured.maxY - TOL);
  });

  it("prediction is close (≤3px) to measured ink on un-clipped axes — guards against algorithm drift", () => {
    const TIGHT = 3;
    const checkAxis = (name: string, predicted: number, measured: number, isClipped: boolean) => {
      if (isClipped) return; // clipped axes give a bound, not the truth
      expect(Math.abs(predicted - measured), `${name} drift`).toBeLessThanOrEqual(TIGHT);
    };
    for (const c of CASES) {
      const [minX, minY, maxX, maxY] = aabb(sampleSpline(c.points));
      checkAxis(`${c.name} minX`, minX, c.measured.minX, c.clipped.minX);
      checkAxis(`${c.name} minY`, minY, c.measured.minY, c.clipped.minY);
      checkAxis(`${c.name} maxX`, maxX, c.measured.maxX, c.clipped.maxX);
      checkAxis(`${c.name} maxY`, maxY, c.measured.maxY, c.clipped.maxY);
    }
  });

  it("interior corner bow exceeds control-polygon bbox", () => {
    // Sanity: for a sharp 3-point L, the spline should bow OUT of the
    // control-polygon bbox. Otherwise the whole exercise is moot.
    const [minX, minY] = aabb(sampleSpline(CASE_L.points));
    expect(minX).toBeLessThan(0); // bows left of x=0
    expect(minY).toBeLessThan(0); // bows above y=0
  });
});

describe("aabb", () => {
  it("returns zeros for empty input", () => {
    expect(aabb([])).toEqual([0, 0, 0, 0]);
  });

  it("computes the tight bbox", () => {
    expect(aabb([[1, 2], [-3, 4], [5, -6]])).toEqual([-3, -6, 5, 4]);
  });
});
