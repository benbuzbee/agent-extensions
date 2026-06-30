// Pure-unit tests for src/core/ -- the portable logic that never touches a
// Cloudflare type. These run in a plain Node environment via vanilla Vitest
// (NO Workers pool), so they are fast and need no Miniflare. Anything that
// needs real KV or the fetch handler belongs in the `worker` project instead.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "core",
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
