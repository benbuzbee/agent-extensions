import type { Shape } from "../grammar/schema.ts";

// 0.55 ≈ Tahoma/Verdana ratio from get-text-width's per-font table; chosen
// slightly generous (Arial is 0.52) so misestimates overcount — boxes grow
// a touch wider rather than overflowing.
// https://www.npmjs.com/package/get-text-width
export const CHAR_WIDTH_FACTOR = 0.55;

export const LINE_HEIGHT_FACTOR = 1.25;

export const SHAPE_TEXT_ASPECT: Record<Shape, number> = {
  rectangle: 2.0,
  ellipse: 1.6,
  diamond: 1.5,
};

// Text block must fit the *inscribed* rectangle of each shape:
//   ellipse → √2  (max inscribed rect of an ellipse is bbox/√2)
//   diamond → 2.0 (max inscribed rect of a square rotated 45° is bbox/2)
// https://math.stackexchange.com/questions/240126
export const SHAPE_INFLATION: Record<Shape, number> = {
  rectangle: 1.0,
  ellipse: Math.SQRT2,
  diamond: 2.0,
};

// Reserved for future edge auto-wrap; no current caller. Edge labels honor
// explicit \n only because aspect 3.0 over-wraps short ribbons like
// "FB: creates" into two lines.
export const EDGE_LABEL_ASPECT = 3.0;

export function charWidth(fontSize: number): number {
  return fontSize * CHAR_WIDTH_FACTOR;
}

export function lineHeight(fontSize: number): number {
  return fontSize * LINE_HEIGHT_FACTOR;
}

// ASCII-grade heuristic: CJK / emoji silently undercount — accepted; labels
// are agent-authored English in practice.
export function measureLineWidth(s: string, fontSize: number): number {
  return s.length * charWidth(fontSize);
}

export function inflateForShape(
  w: number,
  h: number,
  shape: Shape,
): { w: number; h: number } {
  const k = SHAPE_INFLATION[shape];
  return { w: w * k, h: h * k };
}

// Greedy word-wrap: never breaks mid-word; long single words overflow rather
// than split. Hard `\n` always wins. Loop cribbed from
// danilosampaio/greedy-wrap (MIT), swapping its DOM measurer for
// measureLineWidth so the rule is dual-derivable in desugar + render.
// https://github.com/danilosampaio/greedy-wrap
export function wrapToWidth(
  text: string,
  fontSize: number,
  targetWidth: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const w = words[i]!;
      const candidate = line + " " + w;
      if (measureLineWidth(candidate, fontSize) <= targetWidth) {
        line = candidate;
      } else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

// Closed-form target width for desired aspect R = w/h. Modelling the wrapped
// block as L lines of width t and total glyph width W ≈ L·t gives L ≈ W/t,
// so t / (L·lineHeight) ≈ t² / (W·lineHeight) = R, hence t ≈ √(R·W·lineHeight).
// Realised aspect drifts narrower than R because greedy fill rounds up at
// word boundaries.
export function targetWidthForAspect(
  text: string,
  fontSize: number,
  aspect: number,
): number {
  const W = measureLineWidth(text.replace(/\s+/g, ""), fontSize);
  const lh = lineHeight(fontSize);
  return Math.sqrt(aspect * W * lh);
}

export interface WrappedBlock {
  lines: string[];
  width: number;
  height: number;
}

export function wrapToAspect(
  text: string,
  fontSize: number,
  aspect: number,
  targetWidthOverride?: number,
): WrappedBlock {
  // Caller-supplied target wins outright — this is how the constraint-aware
  // path (User-pinned `width:` on a leaf, or the render-side reverse-derive
  // from `laid.width`) skips the closed-form aspect math and wraps to a
  // specific inner width. Both sides passing the same override → identical
  // lines, which is what the dual-derive invariant requires.
  const target = ((): number => {
    if (targetWidthOverride !== undefined) return targetWidthOverride;
    const computed = targetWidthForAspect(text, fontSize, aspect);
    // Floor the target at the widest explicit paragraph so author-supplied \n
    // hints aren't re-broken. Only applied when the text has multiple
    // paragraphs — a single long paragraph is free to wrap to aspect.
    const paragraphs = text.split("\n");
    if (paragraphs.length <= 1) return computed;
    const longest = paragraphs.reduce(
      (m, p) => Math.max(m, measureLineWidth(p, fontSize)),
      0,
    );
    return Math.max(computed, longest);
  })();
  const lines = wrapToWidth(text, fontSize, target);
  let width = 0;
  for (const line of lines) {
    const w = measureLineWidth(line, fontSize);
    if (w > width) width = w;
  }
  const height = lines.length * lineHeight(fontSize);
  return { lines, width, height };
}
