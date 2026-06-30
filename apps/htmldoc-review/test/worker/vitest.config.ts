// Worker integration tests: run INSIDE the Workers runtime (Miniflare) via
// @cloudflare/vitest-pool-workers, so they get real KV + the fetch handler.
//
// 0.16 config API (verified against the installed package's exported types and
// the package's own vitest-v3-to-v4 codemod): the old `defineWorkersConfig` /
// `test.poolOptions.workers` form is GONE. You now add the `cloudflareTest()`
// Vite plugin to a normal `defineConfig`, passing it the same options object
// that used to live under `poolOptions.workers`.
//   docs: https://developers.cloudflare.com/workers/testing/vitest-integration/
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Inherit the SAME bindings the Worker runs with (KV SESSIONS, DOC_OWNER, ...).
      wrangler: { configPath: "../../wrangler.toml" },
      // isolatedStorage defaults true -> local KV resets between tests automatically.
    }),
  ],
  test: {
    name: "worker",
    include: ["**/*.test.ts"],
  },
});
