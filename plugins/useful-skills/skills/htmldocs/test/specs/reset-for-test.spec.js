import { test, expect } from '@playwright/test';
import { seedInline, interceptComments, thread } from '../helpers/comments-route.js';

// __resetForTest's contract: swap `activeWidget` for a fresh
// CommentsWidget so a single page can exercise re-mount flows without
// reloading. Without this spec the resetActiveWidget shim's unmount +
// reconstruct path is dead code that a future cleanup would silently
// break.

test('__resetForTest clears state; subsequent __init re-mounts UI and reloads the seed', async ({ page }) => {
  const seedA = {
    threads: [thread({ id: 'c1', exact: 'quick brown fox', prefix: 'The ', suffix: ' jumps over', sections: ['alpha'], body: 'first run' })],
  };
  await seedInline(page, seedA);
  await interceptComments(page, { threads: seedA.threads });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const before = await page.evaluate(() => ({
    commentBodies: window.__htmldocsComments.getModel().threads.map((t) => t.root.body),
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
  expect(afterRebind.model.threads).toHaveLength(1);
  expect(afterRebind.popoverCount).toBe(1);
  expect(afterRebind.composerCount).toBe(1);
  expect(afterRebind.gutterCount).toBe(1);
});
