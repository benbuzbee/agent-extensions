import { test, expect } from '@playwright/test';
import { seedInline, interceptComments, thread } from '../helpers/comments-route.js';

// getOrphanCount() reports the count of seeded threads whose anchors no
// longer resolve in the live DOM. v1 doesn't render orphans (no UI), but
// exposing the count keeps resolver regressions catchable — a silently
// dropped highlight would otherwise be invisible.

test('mixed resolvable + orphan threads → highlights one, orphan count one', async ({ page }) => {
  const seed = {
    threads: [
      thread({ id: 'c1', exact: 'quick brown fox', prefix: 'The ', suffix: ' jumps over', sections: ['alpha'], body: 'resolvable' }),
      thread({ id: 'c2', exact: 'text that does not exist anywhere', sections: ['alpha'], body: 'orphaned — exact not present' }),
    ],
  };
  await seedInline(page, seed);
  await interceptComments(page, { threads: seed.threads });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const out = await page.evaluate(() => ({
    highlightIds: [...window.__htmldocsComments.getHighlights().keys()],
    orphans: window.__htmldocsComments.getOrphanCount(),
    total: window.__htmldocsComments.getModel().threads.length,
  }));
  expect(out.total).toBe(2);
  expect(out.highlightIds).toEqual(['c1']);
  expect(out.orphans).toBe(1);
});

test('empty seed reports zero orphans (with the store actually bound)', async ({ page }) => {
  // Without a loaded assertion, this test would false-green if init silently
  // skipped the load path — getOrphanCount returns 0 for a never-mounted
  // widget. The expect(model).not.toBeNull pins the test to the load path.
  await seedInline(page);
  await interceptComments(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
  const out = await page.evaluate(() => ({
    model: window.__htmldocsComments.getModel(),
    orphans: window.__htmldocsComments.getOrphanCount(),
  }));
  expect(out.model).not.toBeNull();
  expect(out.model.threads).toEqual([]);
  expect(out.orphans).toBe(0);
});
