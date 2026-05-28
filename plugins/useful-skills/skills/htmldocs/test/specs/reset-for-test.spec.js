import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// __resetForTest's contract: swap `activeWidget` for a fresh
// CommentsWidget so a single page can exercise re-mount flows without
// reloading. Without this spec the resetActiveWidget shim's unmount +
// reconstruct path is dead code that a future cleanup would silently
// break.

test('__resetForTest clears state; subsequent __init re-mounts UI and reloads the seed', async ({ page }) => {
  const seedA = {
    doc: 'index.html', schema: 1, comments: [{
      id: 'c1',
      anchor: { sections: ['alpha'], prefix: 'The ', exact: 'quick brown fox', suffix: ' jumps over' },
      body: 'first run',
      author: 'user',
      created_at: '2026-05-25T00:00:00Z',
    }],
  };
  await seedInline(page, seedA);
  await interceptSidecar(page, { initial: seedA });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const before = await page.evaluate(() => ({
    commentBodies: window.__htmldocsComments.getModel().comments.map((c) => c.body),
    bubbleCount: document.querySelectorAll('.htmldocs-cmt-bubble').length,
    popoverCount: document.querySelectorAll('.htmldocs-cmt-popover').length,
    composerCount: document.querySelectorAll('.htmldocs-cmt-composer').length,
    gutterCount: document.querySelectorAll('.htmldocs-cmt-gutter').length,
  }));
  expect(before.commentBodies).toEqual(['first run']);
  expect(before.bubbleCount).toBe(1);
  expect(before.popoverCount).toBe(1);
  expect(before.composerCount).toBe(1);
  expect(before.gutterCount).toBe(1);

  await page.evaluate(() => window.__htmldocsComments.__resetForTest());
  const afterReset = await page.evaluate(() => ({
    model: window.__htmldocsComments.getModel(),
    bubbleCount: document.querySelectorAll('.htmldocs-cmt-bubble').length,
    popoverCount: document.querySelectorAll('.htmldocs-cmt-popover').length,
    composerCount: document.querySelectorAll('.htmldocs-cmt-composer').length,
    gutterCount: document.querySelectorAll('.htmldocs-cmt-gutter').length,
  }));
  expect(afterReset.model).toBeNull();
  expect(afterReset.bubbleCount).toBe(0);
  expect(afterReset.popoverCount).toBe(0);
  expect(afterReset.composerCount).toBe(0);
  expect(afterReset.gutterCount).toBe(0);

  // Re-init reads the same inline seed (still in DOM) and remounts UI.
  // whenReady must wait for the NEW init, not the prior run's
  // already-resolved promise.
  await page.evaluate(async () => {
    window.__htmldocsComments.__init();
    await window.__htmldocsComments.whenReady();
  });
  const afterRebind = await page.evaluate(() => ({
    model: window.__htmldocsComments.getModel(),
    popoverCount: document.querySelectorAll('.htmldocs-cmt-popover').length,
    composerCount: document.querySelectorAll('.htmldocs-cmt-composer').length,
    gutterCount: document.querySelectorAll('.htmldocs-cmt-gutter').length,
  }));
  expect(afterRebind.model.comments).toHaveLength(1);
  expect(afterRebind.popoverCount).toBe(1);
  expect(afterRebind.composerCount).toBe(1);
  expect(afterRebind.gutterCount).toBe(1);
});
