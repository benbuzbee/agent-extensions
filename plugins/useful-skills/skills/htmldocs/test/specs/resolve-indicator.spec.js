import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// Resolve shows a GREEN indicator (the .htmldocs-cmt-bubble--resolved class on
// the gutter bubble) with the comment STILL VISIBLE — never hidden.
//
// The two tests together prove the soft-close is delivered end to end:
//   1. resolving through the store persists `resolved_at` to the sidecar wire;
//   2. a doc whose sidecar carries `resolved_at` (the state serve.ts injects
//      inline on the next load) renders the bubble with the resolved class.

test('resolve persists resolved_at to the sidecar wire', async ({ page }) => {
  const model = {
    doc: 'index.html',
    schema: 1,
    comments: [
      {
        id: 'c-test-resolve',
        anchor: { sections: ['alpha'], prefix: 'The ', exact: 'quick brown fox', suffix: ' jumps over' },
        body: 'test resolve comment',
        author: 'user',
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
  };
  await seedInline(page, model);
  const sidecar = await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  await page.evaluate(async () => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    const store = new Store(); // constructor loads the same inline seed
    const doc = { repo: '', ref: 'default', path: location.pathname };
    await store.resolve(doc, { op: 'resolve', threadId: 'c-test-resolve' }, { login: 'user', name: null });
  });

  const written = sidecar.getState();
  expect(written.comments).toHaveLength(1);
  // The soft-close survives persistence as an ISO resolved_at (mirrors created_at).
  expect(typeof written.comments[0].resolved_at).toBe('string');
  expect(written.comments[0].resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('a resolved comment renders a green bubble that stays visible', async ({ page }) => {
  // Seed the state a reload would see after a resolve was persisted: the
  // sidecar carries resolved_at. This is the exact shape serve.ts injects
  // inline on the next page load.
  const model = {
    doc: 'index.html',
    schema: 1,
    comments: [
      {
        id: 'c-test-resolve',
        anchor: { sections: ['alpha'], prefix: 'The ', exact: 'quick brown fox', suffix: ' jumps over' },
        body: 'test resolve comment',
        author: 'user',
        created_at: '2026-01-01T00:00:00Z',
        resolved_at: '2026-01-02T00:00:00Z',
      },
    ],
  };
  await seedInline(page, model);
  await interceptSidecar(page);
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
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
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
