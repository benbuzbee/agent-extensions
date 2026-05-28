import type { FillColor, StrokeColor } from "../grammar/schema.ts";

// Light-mode palette — also serves as the SVG presentation-attribute fallback
// when CSS variables aren't available (e.g. an SVG snippet pasted without its
// <style> block, or a browser too old for color-mix()).
export const STROKE_HEX: Record<StrokeColor, string> = {
  black: "#1e1e1e",
  gray: "#5c5f66",
  red: "#e03131",
  orange: "#f08c00",
  yellow: "#f59f00",
  green: "#2f9e44",
  teal: "#0c8599",
  blue: "#1971c2",
  violet: "#6741d9",
  pink: "#c2255c",
};

// Dark-mode counterparts — same hues lifted in lightness so they read against
// a dark page background. Tuned by eye against the gallery in dark mode.
export const STROKE_HEX_DARK: Record<StrokeColor, string> = {
  black: "#e6e6e6",
  gray: "#9aa0a6",
  red: "#ff8585",
  orange: "#ffb066",
  yellow: "#ffd966",
  green: "#7fd28f",
  teal: "#6dd5e6",
  blue: "#7fb1ff",
  violet: "#bda3ff",
  pink: "#ff8fb6",
};

// Solid pastel fills — kept for the Excalidraw emitter, which has no CSS layer
// and must bake colours into element fields. The SVG emitter no longer uses
// these directly; it derives translucent fills from STROKE_HEX via color-mix.
export const FILL_HEX: Record<FillColor, string> = {
  transparent: "transparent",
  "gray-light": "#e9ecef",
  "red-light": "#ffc9c9",
  "orange-light": "#ffd8a8",
  "yellow-light": "#ffec99",
  "green-light": "#b2f2bb",
  "teal-light": "#99e9f2",
  "blue-light": "#a5d8ff",
  "violet-light": "#d0bfff",
  "pink-light": "#fcc2d7",
};

export const DEFAULT_STROKE = STROKE_HEX.black;
export const DEFAULT_FILL = FILL_HEX.transparent;

// Light fill keys map to their stroke counterpart for color-mix derivation.
const LIGHT_TO_STROKE: Record<Exclude<FillColor, "transparent">, StrokeColor> = {
  "gray-light": "gray",
  "red-light": "red",
  "orange-light": "orange",
  "yellow-light": "yellow",
  "green-light": "green",
  "teal-light": "teal",
  "blue-light": "blue",
  "violet-light": "violet",
  "pink-light": "pink",
};

// Translucency for *-light fills, expressed as the stroke colour's share in
// the color-mix against transparent. 18% reads as a clear hue wash without
// muddying the stroke.
const FILL_MIX_PCT = 18;

export const STROKE_CLASS: Record<StrokeColor, string> = {
  black: "tg-stroke-black",
  gray: "tg-stroke-gray",
  red: "tg-stroke-red",
  orange: "tg-stroke-orange",
  yellow: "tg-stroke-yellow",
  green: "tg-stroke-green",
  teal: "tg-stroke-teal",
  blue: "tg-stroke-blue",
  violet: "tg-stroke-violet",
  pink: "tg-stroke-pink",
};

export const TEXT_CLASS: Record<StrokeColor, string> = {
  black: "tg-text-black",
  gray: "tg-text-gray",
  red: "tg-text-red",
  orange: "tg-text-orange",
  yellow: "tg-text-yellow",
  green: "tg-text-green",
  teal: "tg-text-teal",
  blue: "tg-text-blue",
  violet: "tg-text-violet",
  pink: "tg-text-pink",
};

export const FILL_CLASS: Record<FillColor, string> = {
  transparent: "tg-fill-transparent",
  "gray-light": "tg-fill-gray-light",
  "red-light": "tg-fill-red-light",
  "orange-light": "tg-fill-orange-light",
  "yellow-light": "tg-fill-yellow-light",
  "green-light": "tg-fill-green-light",
  "teal-light": "tg-fill-teal-light",
  "blue-light": "tg-fill-blue-light",
  "violet-light": "tg-fill-violet-light",
  "pink-light": "tg-fill-pink-light",
};

export const DEFAULT_STROKE_CLASS = STROKE_CLASS.black;
export const DEFAULT_TEXT_CLASS = TEXT_CLASS.black;
// Default fill for leaf nodes: none, so the host page background shows
// through. Containers also default to transparent (children paint over).
export const DEFAULT_LEAF_FILL_CLASS = "tg-fill-none";
export const DEFAULT_CONTAINER_FILL_CLASS = "tg-fill-transparent";
// Halo class (edge-label background + outline-marker inner fill). Resolves to
// the page background in dark mode so edge labels and outlined arrowheads
// stop reading as white blobs.
export const HALO_STROKE_CLASS = "tg-halo-stroke";
export const HALO_FILL_CLASS = "tg-halo-fill";

// Embedded inside each SVG so the output is self-themed even when copied
// standalone. Scoped under `.tg-svg` so neither variables nor utility classes
// leak to the host page. Presentation attributes (`stroke="#hex"`, etc.) stay
// on each element as a fallback for environments that strip <style> or
// pre-date color-mix() (Chrome <111 / Firefox <113 / Safari <16.2).
export function themeStyleBlock(): string {
  const lightStrokes = (Object.keys(STROKE_HEX) as StrokeColor[])
    .map((k) => `    --tg-stroke-${k}: ${STROKE_HEX[k]};`)
    .join("\n");
  const darkStrokes = (Object.keys(STROKE_HEX_DARK) as StrokeColor[])
    .map((k) => `      --tg-stroke-${k}: ${STROKE_HEX_DARK[k]};`)
    .join("\n");

  const strokeRules = (Object.keys(STROKE_HEX) as StrokeColor[])
    .map((k) => `  .tg-svg .tg-stroke-${k} { stroke: var(--tg-stroke-${k}); }`)
    .join("\n");
  const textRules = (Object.keys(STROKE_HEX) as StrokeColor[])
    .map((k) => `  .tg-svg .tg-text-${k} { fill: var(--tg-stroke-${k}); }`)
    .join("\n");
  const fillRules = (Object.keys(LIGHT_TO_STROKE) as Array<keyof typeof LIGHT_TO_STROKE>)
    .map((k) => {
      const stroke = LIGHT_TO_STROKE[k];
      return `  .tg-svg .tg-fill-${k} { fill: color-mix(in srgb, var(--tg-stroke-${stroke}) ${FILL_MIX_PCT}%, transparent); }`;
    })
    .join("\n");

  return [
    `<style>`,
    `  .tg-svg {`,
    // Tells the browser the SVG supports both schemes. Standalone-view side
    // effect: the viewport backdrop matches OS preference (dark backdrop in
    // OS-dark), so the dark palette stops getting painted on a forced-white
    // canvas. Embedded views are unchanged — the host page's color-scheme
    // still wins.
    `    color-scheme: light dark;`,
    lightStrokes,
    `    --tg-halo: #ffffff;`,
    `  }`,
    `  @media (prefers-color-scheme: dark) {`,
    `    .tg-svg {`,
    darkStrokes,
    `      --tg-halo: #0f1115;`,
    `    }`,
    `  }`,
    strokeRules,
    textRules,
    fillRules,
    `  .tg-svg .tg-fill-transparent { fill: transparent; }`,
    `  .tg-svg .tg-fill-none { fill: none; }`,
    `  .tg-svg .tg-halo-stroke { stroke: var(--tg-halo); }`,
    `  .tg-svg .tg-halo-fill { fill: var(--tg-halo); }`,
    `</style>`,
  ].join("\n");
}
