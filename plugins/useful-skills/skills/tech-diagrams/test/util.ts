import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/grammar/validate.ts";
import { desugar } from "../src/desugar/to-elk.ts";
import { layout, type LaidOut } from "../src/layout/run.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "fixtures");

export function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

const cache = new Map<string, Promise<LaidOut>>();

export function laidOutOf(name: string): Promise<LaidOut> {
  let p = cache.get(name);
  if (!p) {
    p = (async () => {
      const result = validate(readFixture(name));
      if (!result.ok) throw new Error(`fixture ${name} did not validate`);
      return await layout(desugar(result.diagram));
    })();
    cache.set(name, p);
  }
  return p;
}
