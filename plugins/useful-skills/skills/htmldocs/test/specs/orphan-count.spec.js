import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// getOrphanCount() reports the count of seeded comments whose anchors no
// longer resolve in the live DOM. v1 doesn't render orphans (no UI), but
// exposing the count keeps resolver regressions catchable — a silently
// dropped highlight would otherwise be invisible.

test('mixed resolvable + orphan comments → highlights one, orphan count one', async ({ page }) => {
  const seed = {
    doc: 'index.html',
    schema: 1,
    comments: [
      {
        id: 'c1',
        anchor: { sections: ['alpha'], prefix: 'The ', exact: 'quick brown fox', suffix: ' jumps over' },
        body: 'resolvable',
        author: 'user',
        created_at: '2026-05-25T00:00:00Z',
      },
      {
        id: 'c2',
        anchor: { sections: ['alpha'], prefix: '', exact: 'text that does not exist anywhere', suffix: '' },
        body: 'orphaned — exact not present',
        author: 'user',
        created_at: '2026-05-25T00:00:00Z',
      },
    ],
  };
  await seedInline(page, seed);
  await interceptSidecar(page, { initial: seed });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const out = await page.evaluate(() => ({
    highlightIds: [...window.__htmldocsComments.getHighlights().keys()],
    orphans: window.__htmldocsComments.getOrphanCount(),
    total: window.__htmldocsComments.getModel().comments.length,
  }));
  expect(out.total).toBe(2);
  expect(out.highlightIds).toEqual(['c1']);
  expect(out.orphans).toBe(1);
});

test('empty model reports zero orphans (with the store actually bound)', async ({ page }) => {
  // Without a model-loaded assertion, this test would false-green if init
  // silently skipped the load path — getOrphanCount returns 0 for a null
  // model. The expect(model).not.toBeNull pins the test to the load path
  // it claims to cover.
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
  const out = await page.evaluate(() => ({
    model: window.__htmldocsComments.getModel(),
    orphans: window.__htmldocsComments.getOrphanCount(),
  }));
  expect(out.model).not.toBeNull();
  expect(out.model.comments).toEqual([]);
  expect(out.orphans).toBe(0);
});
