import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// Anchor encode/decode across block boundaries, inline boundaries,
// and out-of-article body text.

test('anchor round-trips across block boundaries (p + blockquote)', async ({ page }) => {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
  await page.goto('/test/fixtures/no-article/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const result = await page.evaluate(() => {
    // Select text spanning from the <p> into the <blockquote>
    const p = document.querySelectorAll('p')[1]; // "The quick brown fox..."
    const bq = document.querySelector('blockquote');
    const r = document.createRange();
    r.setStart(p.firstChild, 20); // "over the lazy dog."
    r.setEnd(bq.firstChild, 12); // "A blockquote"
    const exact = r.toString();
    const a = window.__htmldocsComments.__anchor.fromRange(r);
    const r2 = window.__htmldocsComments.__anchor.toRange(a);
    return { exact, decoded: r2 ? r2.toString() : null, anchor: a };
  });
  expect(result.decoded).toBe(result.exact);
});

test('anchor round-trips across inline boundaries (em inside blockquote)', async ({ page }) => {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
  await page.goto('/test/fixtures/no-article/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const result = await page.evaluate(() => {
    // Select text crossing the <em> inside the blockquote
    const bq = document.querySelector('blockquote');
    const textBefore = bq.firstChild; // "A blockquote with "
    const em = bq.querySelector('em');
    const r = document.createRange();
    r.setStart(textBefore, 15); // "with "
    r.setEnd(em.firstChild, 10); // "emphasized"
    const exact = r.toString();
    const a = window.__htmldocsComments.__anchor.fromRange(r);
    const r2 = window.__htmldocsComments.__anchor.toRange(a);
    return { exact, decoded: r2 ? r2.toString() : null };
  });
  expect(result.decoded).toBe(result.exact);
});

test('anchor for out-of-article body text encodes with sections:[] and decodes correctly', async ({ page }) => {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
  await page.goto('/test/fixtures/no-article/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const result = await page.evaluate(() => {
    const p = document.querySelectorAll('p')[0]; // "This document has no article tags..."
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, 13); // "This document"
    const a = window.__htmldocsComments.__anchor.fromRange(r);
    const r2 = window.__htmldocsComments.__anchor.toRange(a);
    return { sections: a.sections, exact: a.exact, decoded: r2 ? r2.toString() : null };
  });
  expect(result.sections).toEqual([]);
  expect(result.exact).toBe('This document');
  expect(result.decoded).toBe('This document');
});
