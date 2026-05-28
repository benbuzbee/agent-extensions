import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// One gutter bubble per resolved highlight, each vertically aligned to the
// midline of its highlight's bounding rect. Driven off the seeded
// drift-exact-preserved fixture (one comment).

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(
  readFileSync(path.resolve(here, '../fixtures/drift-exact-preserved/index.comments.json'), 'utf8'),
);

test('one bubble per resolved highlight; bubble aligns to highlight midline', async ({ page }) => {
  await seedInline(page, seed);
  await interceptSidecar(page, { initial: seed });
  await page.goto('/test/fixtures/drift-exact-preserved/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const out = await page.evaluate(() => {
    const range = window.__htmldocsComments.getHighlights().get('c1');
    const rect = range.getBoundingClientRect();
    const bubbles = [...document.querySelectorAll('.htmldocs-cmt-bubble')];
    return {
      bubbleCount: bubbles.length,
      bubbleCommentId: bubbles[0]?.dataset.commentId,
      bubbleTopPx: bubbles[0] ? parseFloat(bubbles[0].style.top) : null,
      rangeTopPage: rect.top + window.scrollY,
      rangeBottomPage: rect.bottom + window.scrollY,
    };
  });

  expect(out.bubbleCount).toBe(1);
  expect(out.bubbleCommentId).toBe('c1');
  expect(out.bubbleTopPx).toBeGreaterThanOrEqual(out.rangeTopPage - 1);
  expect(out.bubbleTopPx).toBeLessThanOrEqual(out.rangeBottomPage + 1);
});

test('after a save the gutter rerenders with one bubble per highlight', async ({ page }) => {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  expect(await page.locator('.htmldocs-cmt-bubble').count()).toBe(0);

  await page.evaluate(async () => {
    const alphaText = document.querySelector('#alpha p').firstChild;
    const r1 = document.createRange();
    r1.setStart(alphaText, 4); r1.setEnd(alphaText, 19);
    await window.__htmldocsComments.saveComment(r1, 'alpha note');

    const betaText = document.querySelector('#beta p').firstChild;
    const r2 = document.createRange();
    r2.setStart(betaText, 0); r2.setEnd(betaText, 4);
    await window.__htmldocsComments.saveComment(r2, 'beta note');
  });

  expect(await page.locator('.htmldocs-cmt-bubble').count()).toBe(2);
});
