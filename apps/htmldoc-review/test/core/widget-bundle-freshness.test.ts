// The Worker serves a checked-in copy of the skill's widget bundle
// (src/worker/comments.mjs.txt, imported as a Text module by inject.ts). This
// gate pins it byte-for-byte to the skill's committed dist/comments.mjs, so a
// widget rebuild can never ship stale bytes silently — the fix is one command:
// `npm run sync:widget`. Runs in the core (plain Node) project because it needs
// fs, not the Workers runtime.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// .href: fileURLToPath is typed against node:url's URL, not the global.
const appTxt = new URL("../../src/worker/comments.mjs.txt", import.meta.url).href;
const skillDist = new URL(
  "../../../../plugins/useful-skills/skills/htmldocs/dist/comments.mjs",
  import.meta.url,
).href;

describe("widget bundle freshness", () => {
  it("src/worker/comments.mjs.txt byte-equals the skill's dist/comments.mjs", () => {
    const app = readFileSync(fileURLToPath(appTxt), "utf8");
    const skill = readFileSync(fileURLToPath(skillDist), "utf8");
    expect(
      app === skill,
      "src/worker/comments.mjs.txt is out of date with the skill's dist/comments.mjs — run `npm run sync:widget` and commit the result",
    ).toBe(true);
  });
});
