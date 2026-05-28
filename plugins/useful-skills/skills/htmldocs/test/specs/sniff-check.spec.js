import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Production load (no ?test=1) must not leak the privileged test handle.
// Regressions here mean someone moved the assignment outside the TEST_MODE
// gate in comments.mjs. Parameterized over every fixture so PR-2 fixtures
// inherit coverage without touching this file.
//
// `__htmldocsModuleLoaded` is a module-top sentinel set before the
// TEST_MODE branch — it's the positive load proof. Without it the negative
// `__htmldocsComments === undefined` would false-green on a script 404.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(here, '../fixtures');
const fixtures = readdirSync(fixturesRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `/test/fixtures/${e.name}/index.html`);

for (const fixturePath of fixtures) {
  test(`__htmldocsComments undefined without ?test=1 — ${fixturePath}`, async ({ page }) => {
    await page.goto(fixturePath);
    await page.waitForLoadState('networkidle');
    const out = await page.evaluate(() => ({
      moduleLoaded: window.__htmldocsModuleLoaded === true,
      exposed: typeof window.__htmldocsComments,
    }));
    expect(out.moduleLoaded).toBe(true);
    expect(out.exposed).toBe('undefined');
  });
}

test('__htmldocsComments is present with ?test=1', async ({ page }) => {
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
  const exposed = await page.evaluate(() => typeof window.__htmldocsComments);
  expect(exposed).toBe('object');
});
