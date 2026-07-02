// Vitest config for the skill's Node-side unit + integration suites. Plain
// node environment (matches the Worker app's "core" project and PR3's
// vitest-pool-workers). Playwright owns ./specs and never overlaps: this config
// only collects test/unit + test/integration, and playwright.config.js's
// testDir is ./specs — so the two runners never double-collect.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
  },
});
