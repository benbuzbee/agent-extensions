import { test, expect } from '@playwright/test';
import { seedInline, interceptComments } from '../helpers/comments-route.js';

// SVG <text> labels inside an <article> participate in the same TreeWalker
// stream as prose, so they should anchor without any special handling.
// Diagrams that live OUTSIDE any article must stay non-commentable —
// the popover gate requires the selection to intersect an article.

test('SVG <text> label inside <article> round-trips through anchor', async ({ page }) => {
  await seedInline(page);
  await interceptComments(page);
  await page.goto('/test/fixtures/diagram/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const out = await page.evaluate(() => {
    const labels = document.querySelectorAll('#overview svg text');
    // Pick the unique "User to DB" label so prefix/suffix has surrounding
    // context from the other labels.
    const label = Array.from(labels).find((t) => t.textContent === 'User to DB');
    const r = document.createRange();
    r.selectNodeContents(label);
    const a = window.__htmldocsComments.__anchor.fromRange(r);
    const r2 = window.__htmldocsComments.__anchor.toRange(a);
    return { anchor: a, decoded: r2 ? r2.toString() : null };
  });
  expect(out.anchor.sections).toEqual(['overview']);
  expect(out.anchor.exact).toBe('User to DB');
  expect(out.decoded).toBe('User to DB');
});

test('orphan SVG (no enclosing <article>) NOW surfaces the popover (gate removed)', async ({ page }) => {
  await seedInline(page);
  await interceptComments(page);
  await page.goto('/test/fixtures/orphan-svg/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  await page.evaluate(() => {
    const label = document.querySelector('figure svg text');
    const r = document.createRange();
    r.selectNodeContents(label);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await expect(page.locator('.htmldocs-cmt-popover')).toBeVisible();
});
