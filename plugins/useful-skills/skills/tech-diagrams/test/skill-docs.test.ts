import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/grammar/validate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examplesMd = resolve(here, "..", "references", "examples.md");

function extractFencedYaml(source: string): string[] {
  const out: string[] = [];
  const re = /```yaml\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

describe("schema/docs sync — every YAML example in references/examples.md validates", () => {
  const md = readFileSync(examplesMd, "utf8");
  const blocks = extractFencedYaml(md);

  test("references/examples.md contains at least 3 example YAML blocks", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  blocks.forEach((yaml, i) => {
    test(`block ${i} validates against the grammar`, () => {
      // Skip the grammar reference block (it has placeholder <id> tokens)
      if (yaml.includes("<id>") || yaml.includes("...")) return;
      const result = validate(yaml);
      if (!result.ok) {
        // surface the actual error so a failing test points at the bad block
        throw new Error(
          `block ${i} failed validation:\n${yaml}\nerrors: ${JSON.stringify(result.errors, null, 2)}`,
        );
      }
      expect(result.ok).toBe(true);
    });
  });
});
