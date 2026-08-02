import { test, expect } from '@playwright/test';
import { seedInline, interceptComments } from '../helpers/comments-route.js';

// The floating "💬" popover appears when text inside an <article> is
// selected and disappears otherwise. Programmatic selection (no synthetic
// mouse events) is enough to fire `selectionchange`, which is what the UI
// layer listens to.

test.beforeEach(async ({ page }) => {
  await seedInline(page);
  await interceptComments(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
});

async function selectQuickBrownFox(page) {
  await page.evaluate(() => {
    const text = document.querySelector('#alpha p').firstChild;
    const r = document.createRange();
    r.setStart(text, 4);
    r.setEnd(text, 19);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
}

test('selection inside <article> shows the popover; clearing it hides', async ({ page }) => {
  const popover = page.locator('.htmldocs-cmt-popover');
  await expect(popover).toBeAttached();
  await expect(popover).toBeHidden();

  await selectQuickBrownFox(page);
  await expect(popover).toBeVisible();

  await page.evaluate(() => document.getSelection().removeAllRanges());
  await expect(popover).toBeHidden();
});

test('collapsed selection inside <article> keeps popover hidden', async ({ page }) => {
  await selectQuickBrownFox(page);
  await expect(page.locator('.htmldocs-cmt-popover')).toBeVisible();

  await page.evaluate(() => {
    const text = document.querySelector('#alpha p').firstChild;
    const r = document.createRange();
    r.setStart(text, 4);
    r.collapse(true);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await expect(page.locator('.htmldocs-cmt-popover')).toBeHidden();
});

test('selection in body but outside article shows popover (gate removed)', async ({ page }) => {
  await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const r = document.createRange();
    r.setStart(h1.firstChild, 0);
    r.setEnd(h1.firstChild, 5);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await expect(page.locator('.htmldocs-cmt-popover')).toBeVisible();
});

test('selection inside widget UI keeps popover hidden', async ({ page }) => {
  // The gutter has class htmldocs-cmt-gutter, so selecting inside it
  // should NOT show the popover.
  await page.evaluate(() => {
    const gutter = document.querySelector('.htmldocs-cmt-gutter');
    if (!gutter) return;
    // Insert some text into the gutter to select
    const textNode = document.createTextNode('test text');
    gutter.appendChild(textNode);
    const r = document.createRange();
    r.setStart(textNode, 0);
    r.setEnd(textNode, 4);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await expect(page.locator('.htmldocs-cmt-popover')).toBeHidden();
});
