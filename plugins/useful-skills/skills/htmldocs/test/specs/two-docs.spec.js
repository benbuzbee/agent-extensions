import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// Two docs in a folder. Even though serve.mjs is single-doc at runtime,
// each Playwright page boots independently — the route handler captures
// whichever basename the widget stamps into its PUT body. This guards
// against a stale or seeded model.doc redirecting saves: the widget must
// re-stamp `doc:` from `currentBasename()` on every write.

async function saveOn(page, fixtureUrl, body) {
  await seedInline(page, { doc: 'starts-stale.html', schema: 1, comments: [] });
  const sidecar = await interceptSidecar(page);
  await page.goto(fixtureUrl);
  await page.evaluate(() => window.__htmldocsComments.whenReady());
  await page.evaluate(async (txt) => {
    const article = document.querySelector('article');
    const text = article.querySelector('p').firstChild;
    const r = document.createRange();
    r.setStart(text, 0);
    r.setEnd(text, 5);
    await window.__htmldocsComments.saveComment(r, txt);
  }, body);
  return sidecar.getState();
}

test('two-docs/a.html writes a body with doc:"a.html"', async ({ page }) => {
  const written = await saveOn(page, '/test/fixtures/two-docs/a.html?test=1', 'on doc A');
  expect(written.doc).toBe('a.html');
  expect(written.comments).toHaveLength(1);
});

test('two-docs/b.html writes a body with doc:"b.html"', async ({ page }) => {
  const written = await saveOn(page, '/test/fixtures/two-docs/b.html?test=1', 'on doc B');
  expect(written.doc).toBe('b.html');
});
