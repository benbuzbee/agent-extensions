// Root config: the TEST SPLIT lives here as two Vitest projects so `vitest run`
// drives both with one command.
//   - "core"   : plain Node-env unit tests for the portable src/core/ logic.
//   - "worker" : @cloudflare/vitest-pool-workers integration tests (KV + the
//                fetch handler) running inside the Workers runtime (Miniflare).
// `projects` is the Vitest 4 replacement for the old `workspace` field.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["./test/core/vitest.config.ts", "./test/worker/vitest.config.ts"],
  },
});
