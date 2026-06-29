import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // inherit the SAME bindings the Worker runs with (KV SESSIONS, DOC_OWNER, ...)
        wrangler: { configPath: "./wrangler.toml" },
        // isolatedStorage defaults true -> local KV resets between tests automatically
      },
    },
  },
});
// 0.8.x API. If you ever move to vitest 4 / pool 0.16, this becomes the cloudflareTest() plugin instead.
