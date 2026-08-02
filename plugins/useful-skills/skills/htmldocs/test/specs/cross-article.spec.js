import { test, expect } from '@playwright/test';
import { seedInline, interceptComments } from '../helpers/comments-route.js';

// Cross-article selections were silently impossible before: the popover
// gate required the selection's common ancestor to be inside an <article>,
// so a Range spanning two articles failed because the common ancestor was
// the wrapper above. These specs prove the relaxed contract:
//
//   - Selection that intersects two articles surfaces the popover.
//   - Encoder records both article ids in anchor.sections.
//   - Decoder ignores sections (metadata only) and resolves the Range
//     using prefix/suffix on full-doc text.
//   - Round-trip: save → reload-via-seed → reanchor → same Range text.

test.describe('cross-article selection', () => {
  test('popover surfaces when selection spans two adjacent articles', async ({ page }) => {
    await seedInline(page);
    await interceptComments(page);
    await page.goto('/test/fixtures/cross-article/index.html?test=1');
    await page.evaluate(() => window.__htmldocsComments.whenReady());

    await page.evaluate(() => {
      const startText = document.querySelector('#components p').firstChild;
      const endText = document.querySelector('#data-flow h2').firstChild;
      const r = document.createRange();
      r.setStart(startText, 4);
      r.setEnd(endText, endText.data.length);
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });

    await expect(page.locator('.htmldocs-cmt-popover')).toBeVisible();
  });

  test('encoder records every touched article id in anchor.sections', async ({ page }) => {
    await seedInline(page);
    await interceptComments(page);
    await page.goto('/test/fixtures/cross-article/index.html?test=1');
    await page.evaluate(() => window.__htmldocsComments.whenReady());

    const anchor = await page.evaluate(() => {
      const startText = document.querySelector('#components p').firstChild;
      const endText = document.querySelector('#data-flow p').firstChild;
      const r = document.createRange();
      r.setStart(startText, 4);
      r.setEnd(endText, 10);
      return window.__htmldocsComments.__anchor.fromRange(r);
    });
    expect(anchor.sections).toEqual(['components', 'data-flow']);
    expect(anchor.exact.length).toBeGreaterThan(0);
  });

  test('save → reload → anchor resolves to the same span', async ({ page }) => {
    await seedInline(page);
    const api = await interceptComments(page);
    await page.goto('/test/fixtures/cross-article/index.html?test=1');
    await page.evaluate(() => window.__htmldocsComments.whenReady());

    const originalText = await page.evaluate(async () => {
      const startText = document.querySelector('#components p').firstChild;
      const endText = document.querySelector('#data-flow p').firstChild;
      const r = document.createRange();
      r.setStart(startText, 4);
      r.setEnd(endText, 10);
      const text = r.toString();
      await window.__htmldocsComments.saveComment(r, 'cross-article note');
      return text;
    });

    // The create went over ?comments as an op envelope carrying both section
    // ids; the persisted thread is what a reload's seed would carry.
    const persisted = api.getThreads();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].anchor.sections).toEqual(['components', 'data-flow']);

    // Re-seed with the persisted { threads } and re-init; the resolved Range
    // must match the original selection's text.
    await page.evaluate((threads) => {
      document.getElementById('__htmldocs_comments').textContent = JSON.stringify({ threads });
      window.__htmldocsComments.__resetForTest();
      window.__htmldocsComments.__init();
      return window.__htmldocsComments.whenReady();
    }, persisted);

    const reloadedText = await page.evaluate(() => {
      const highlights = window.__htmldocsComments.getHighlights();
      const r = highlights.get(highlights.keys().next().value);
      return r ? r.toString() : null;
    });
    expect(reloadedText).toBe(originalText);
  });
});
