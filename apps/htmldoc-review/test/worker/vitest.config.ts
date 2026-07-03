// Worker integration tests: run INSIDE the Workers runtime (Miniflare) via
// @cloudflare/vitest-pool-workers, so they get real KV + D1 + the fetch handler.
//
// 0.16 config API (verified against the installed package's exported types and
// the package's own vitest-v3-to-v4 codemod): the old `defineWorkersConfig` /
// `test.poolOptions.workers` form is GONE. You now add the `cloudflareTest()`
// Vite plugin to a normal `defineConfig`, passing it the same options object
// that used to live under `poolOptions.workers`.
//   docs: https://developers.cloudflare.com/workers/testing/vitest-integration/
//
// D1 schema for the store tests: `readD1Migrations` runs Node-side (config time)
// to read migrations/*.sql, and the resulting D1Migration[] is passed into the
// Worker as a plain-JSON Miniflare binding `TEST_MIGRATIONS`. The test's
// beforeAll then applies it into Miniflare's local D1 with `applyD1Migrations`
// (from `cloudflare:test`). `readD1Migrations` is exported from the package root
// in 0.16 — the "/config" subpath the doc-comment mentions does not exist here.
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      // Relative to the process cwd, which is the app root (where `npm test`
      // runs and the root vitest.config.ts lives) — so this points at
      // apps/htmldoc-review/migrations. readD1Migrations reads it Node-side.
      const migrations = await readD1Migrations("migrations");
      return {
        // Inherit the SAME bindings the Worker runs with (KV SESSIONS, D1
        // COMMENTS_DB, REPO_ORG, ...) from wrangler.toml.
        wrangler: { configPath: "../../wrangler.toml" },
        // Carry the parsed migrations to the Worker as a JSON binding the test
        // applies into COMMENTS_DB in beforeAll.
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
        // isolatedStorage defaults true -> local KV is reset between tests. NB:
        // D1 rows are NOT rolled back by isolatedStorage, so the D1 store test
        // wipes the comments table in its own beforeEach (see
        // d1-store.workers.test.ts) rather than relying on this.
      };
    }),
  ],
  test: {
    name: "worker",
    include: ["**/*.test.ts"],
  },
});
