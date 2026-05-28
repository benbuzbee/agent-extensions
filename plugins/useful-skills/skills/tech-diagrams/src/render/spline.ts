// Sample the smooth curve that Excalidraw draws through a multi-point
// linear / arrow element's control points.
//
// Verbatim port of rough.js's `_curve` (Catmull-Rom → cubic Bezier) plus
// the phantom-endpoint handling from `_curveWithOffset`. Excalidraw routes
// rounded linear/arrow elements straight to `roughGenerator.curve`, so
// matching rough.js exactly is what makes the predicted bbox match the
// rendered ink.
//
// Key invariant: phantom endpoints are *duplicates* of the first/last
// user points (rough.js's choice), not reflections — this yields zero
// tangent at the endpoints, where Excalidraw's arrowhead sits.

// 16 samples is well past the visual-noise floor (stroke AA, font hinting)
// for typical segment lengths in our diagrams.
export const CURVE_SAMPLES_PER_SEGMENT = 16;

// Sample `pts` along the rough.js curve. With <3 input points the input is
// returned as-is — rough.js's curve degenerates to a straight line for 2
// points, so there is no off-line bow to capture.
export function sampleSpline(
  pts: readonly (readonly [number, number])[],
  samplesPerSegment: number = CURVE_SAMPLES_PER_SEGMENT,
): [number, number][] {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]]);

  // Ref: rough.js `_curveWithOffset` duplicates points[0] and points[N-1]
  // before calling `_curve`.
  // https://github.com/rough-stuff/rough/blob/master/src/renderer.ts
  const ext: [number, number][] = [
    [pts[0]![0], pts[0]![1]],
    ...pts.map<[number, number]>((p) => [p[0], p[1]]),
    [pts[pts.length - 1]![0], pts[pts.length - 1]![1]],
  ];

  const out: [number, number][] = [];
  // rough.js's `_curve` emits one cubic Bezier per iteration from ext[i]
  // to ext[i+1] using ext[i-1] and ext[i+2] as Catmull-Rom neighbors. With
  // Excalidraw's default curveTightness=0 the converted control points are
  //   B1 = P1 + (P2 - P0)/6
  //   B2 = P2 + (P1 - P3)/6
  // Ref: rough.js src/renderer.ts, function `_curve`.
  for (let i = 1; i + 2 < ext.length; i++) {
    const [P0x, P0y] = ext[i - 1]!;
    const [P1x, P1y] = ext[i]!;
    const [P2x, P2y] = ext[i + 1]!;
    const [P3x, P3y] = ext[i + 2]!;
    const B1x = P1x + (P2x - P0x) / 6;
    const B1y = P1y + (P2y - P0y) / 6;
    const B2x = P2x + (P1x - P3x) / 6;
    const B2y = P2y + (P1y - P3y) / 6;
    for (let s = 0; s <= samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const u = 1 - t;
      const x = u * u * u * P1x + 3 * u * u * t * B1x + 3 * u * t * t * B2x + t * t * t * P2x;
      const y = u * u * u * P1y + 3 * u * u * t * B1y + 3 * u * t * t * B2y + t * t * t * P2y;
      out.push([x, y]);
    }
  }
  return out;
}

// Empty input → all zeros.
export function aabb(points: readonly (readonly [number, number])[]): [number, number, number, number] {
  if (points.length === 0) return [0, 0, 0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
