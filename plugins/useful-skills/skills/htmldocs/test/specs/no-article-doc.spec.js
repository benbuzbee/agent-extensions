import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// Documents with no <article> at all are an edge case: the popover gate
// will never fire (no article to touch), so production users can't
// reach fromRange. But unit-style callers (and any future programmatic
// flow) need fromRange to be total — never throw. The encoder returns
// sections: [] in that case, and the decoder still resolves via
// prefix/suffix on full-doc text.

test('encoder returns sections: [] when no <article> exists in the doc', async ({ page }) => {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const anchor = await page.evaluate(() => {
    // Strip every article so the doc has plain prose only.
    document.querySelectorAll('article').forEach((a) => a.remove());
    const para = document.createElement('p');
    para.textContent = 'lone paragraph: standalone phrase here';
    document.body.appendChild(para);
    const text = para.firstChild.data;
    const start = text.indexOf('standalone phrase');
    const r = document.createRange();
    r.setStart(para.firstChild, start);
    r.setEnd(para.firstChild, start + 'standalone phrase'.length);
    return window.__htmldocsComments.__anchor.fromRange(r);
  });
  expect(anchor.sections).toEqual([]);
  expect(anchor.exact).toBe('standalone phrase');
});
