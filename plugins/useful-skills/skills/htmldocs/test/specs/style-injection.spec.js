import { test, expect } from '@playwright/test';
import { seedInline, interceptComments } from '../helpers/comments-route.js';

// Two cached stylesheets make init() safe to call repeatedly: one for the
// highlight sheet (main.ts), one for the UI sheet (ui.ts). Both modules
// cache the constructed sheet at module scope and re-adopt via an
// `includes` check, so the count stays at exactly two across re-init /
// re-mount. Verify (a) exactly two stylesheets land on first init in
// review mode, (b) re-init does not duplicate them.

test('adoptedStyleSheets grows by exactly 2 in review mode, idempotent on re-init', async ({ page }) => {
  await seedInline(page);
  await interceptComments(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const afterFirst = await page.evaluate(() => document.adoptedStyleSheets.length);
  expect(afterFirst).toBe(2);

  const cssText = await page.evaluate(() =>
    document.adoptedStyleSheets
      .map((s) => [...s.cssRules].map((r) => r.cssText).join('\n'))
      .join('\n')
  );
  // Probe a rule from each sheet so a silent swap (UI sheet replaces
  // highlight sheet, count stays at 2) doesn't slip through.
  expect(cssText).toContain('::highlight(htmldocs-cmt)');
  expect(cssText).toContain('.htmldocs-cmt-composer');
  expect(cssText).toMatch(/prefers-color-scheme.*dark/);

  await page.evaluate(() => window.__htmldocsComments.__init());
  await page.evaluate(() => window.__htmldocsComments.__init());
  const afterRepeats = await page.evaluate(() => document.adoptedStyleSheets.length);
  expect(afterRepeats).toBe(2);
});

test('no inline seed → vanilla page, no stylesheets adopted', async ({ page }) => {
  // No seedInline call. Widget bails in init() because reviewModeActive()
  // returns false. Vanilla docs (file://, plain static serve) must not
  // adopt stylesheets or mount UI.
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
  const out = await page.evaluate(() => ({
    sheetCount: document.adoptedStyleSheets.length,
    popoverCount: document.querySelectorAll('.htmldocs-cmt-popover').length,
    model: window.__htmldocsComments.getModel(),
  }));
  expect(out.sheetCount).toBe(0);
  expect(out.popoverCount).toBe(0);
  expect(out.model).toBeNull();
});
