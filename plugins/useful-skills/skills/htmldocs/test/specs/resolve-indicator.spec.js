import { test, expect } from '@playwright/test';
import { seedInline, interceptComments, thread } from '../helpers/comments-route.js';

// Resolve shows a GREEN indicator (the .htmldocs-cmt-bubble--resolved class on
// the gutter bubble) with the comment STILL VISIBLE — never hidden.
//
// The two tests together prove the soft-close is delivered end to end:
//   1. resolving through the store POSTs a resolve op over ?comments and the
//      returned thread carries resolvedAt;
//   2. a doc whose seed carries a resolved thread (the state the server injects
//      inline on the next load) renders the bubble with the resolved class.

test('resolve POSTs a resolve op and returns a soft-closed thread', async ({ page }) => {
  const seed = {
    threads: [thread({
      id: 'c-test-resolve', exact: 'quick brown fox', prefix: 'The ', suffix: ' jumps over',
      sections: ['alpha'], body: 'test resolve comment',
    })],
  };
  await seedInline(page, seed);
  const api = await interceptComments(page, { threads: seed.threads });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const resolvedAt = await page.evaluate(async () => {
    const store = window.__htmldocsComments.getStore();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const thread = await store.resolve(doc, { op: 'resolve', threadId: 'c-test-resolve' }, { login: 'user', name: null });
    return thread.resolvedAt;
  });

  // The resolve went out as an {op:'resolve', threadId} envelope over ?comments.
  const resolvePost = api.getCalls().find((c) => c.method === 'POST' && c.body && c.body.op === 'resolve');
  expect(resolvePost).toBeTruthy();
  expect(resolvePost.body.threadId).toBe('c-test-resolve');
  // The soft-close is stamped as a numeric epoch-ms Timestamp.
  expect(typeof resolvedAt).toBe('number');
  expect(resolvedAt).toBeGreaterThan(0);
});

test('a resolved comment renders a green bubble that stays visible', async ({ page }) => {
  // Seed the state a reload would see after a resolve was persisted: the thread
  // carries a resolvedAt. This is the shape the server injects inline on load.
  const seed = {
    threads: [thread({
      id: 'c-test-resolve', exact: 'quick brown fox', prefix: 'The ', suffix: ' jumps over',
      sections: ['alpha'], body: 'test resolve comment', resolvedAt: 2000,
    })],
  };
  await seedInline(page, seed);
  await interceptComments(page, { threads: seed.threads });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  // The comment stays visible (soft-close never hides) …
  const bubble = page.locator('.htmldocs-cmt-bubble');
  await expect(bubble.first()).toBeVisible();
  expect(await bubble.count()).toBe(1);

  // … and it carries the green resolved-state class.
  const resolvedBubble = page.locator('.htmldocs-cmt-bubble.htmldocs-cmt-bubble--resolved');
  await expect(resolvedBubble.first()).toBeVisible();
  expect(await resolvedBubble.count()).toBe(1);
});

test('green styling CSS exists for resolved bubbles', async ({ page }) => {
  await seedInline(page);
  await interceptComments(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const hasResolvedRule = await page.evaluate(() => {
    for (const sheet of document.adoptedStyleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && rule.selectorText.includes('htmldocs-cmt-bubble--resolved')) {
          return true;
        }
      }
    }
    return false;
  });
  expect(hasResolvedRule).toBe(true);
});
