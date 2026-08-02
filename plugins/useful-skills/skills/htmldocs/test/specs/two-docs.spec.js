import { test, expect } from '@playwright/test';
import { seedInline, interceptComments } from '../helpers/comments-route.js';

// Two docs in a folder. Even though serve.mjs is single-doc at runtime, each
// Playwright page boots independently. The widget's HttpCommentsStore POSTs its
// create op to the CURRENT doc's `?comments` collection URL (derived from
// location, not from a stale seed), so each doc's save targets its own doc path
// — the server scopes it to the right sidecar. This guards against a save
// leaking across docs.

async function saveOn(page, fixtureUrl, body) {
  await seedInline(page);
  const api = await interceptComments(page);
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
  return api;
}

test('a.html save POSTs a create op to the a.html ?comments collection', async ({ page }) => {
  const api = await saveOn(page, '/test/fixtures/two-docs/a.html?test=1', 'on doc A');
  const post = api.getCalls().find((c) => c.method === 'POST');
  expect(post).toBeTruthy();
  expect(post.url).toBe('/test/fixtures/two-docs/a.html');
  expect(post.body.op).toBe('create');
  expect(api.getThreads()).toHaveLength(1);
  expect(api.getThreads()[0].root.body).toBe('on doc A');
});

test('b.html save POSTs a create op to the b.html ?comments collection', async ({ page }) => {
  const api = await saveOn(page, '/test/fixtures/two-docs/b.html?test=1', 'on doc B');
  const post = api.getCalls().find((c) => c.method === 'POST');
  expect(post).toBeTruthy();
  expect(post.url).toBe('/test/fixtures/two-docs/b.html');
  expect(api.getThreads()[0].root.body).toBe('on doc B');
});
