import { test, expect } from '@playwright/test';
import { seedInline, interceptComments, thread } from '../helpers/comments-route.js';

// A pre-existing thread (the internal { threads } seed shape, mirroring what the
// GET ?comments response carries) resolves to the right Range on page load AND
// registers the highlight in the CSS Custom Highlight registry (not just
// the JS-side Map). The CSS-side check guards against regressions where
// rebuildHighlights's feature-detect or guard wrongly skips the .set().

const seed = {
  threads: [thread({
    id: 'c1',
    exact: 'quick brown fox',
    prefix: 'talks about the ',
    suffix: ' and then continues',
    sections: ['alpha'],
    body: 'Is this still the right metaphor here?',
  })],
};

test('a seeded thread resolves to a Range and registers the CSS highlight', async ({ page }) => {
  await seedInline(page, seed);
  await interceptComments(page, { threads: seed.threads });
  await page.goto('/test/fixtures/drift-exact-preserved/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const result = await page.evaluate(() => {
    const highlights = window.__htmldocsComments.getHighlights();
    const range = highlights.get('c1');
    const cssHighlightSize = (CSS.highlights && CSS.highlights.get('htmldocs-cmt'))
      ? CSS.highlights.get('htmldocs-cmt').size
      : 0;
    return {
      ids: [...highlights.keys()],
      text: range ? range.toString() : null,
      cssHighlightSize,
    };
  });

  expect(result.ids).toEqual(['c1']);
  expect(result.text).toBe('quick brown fox');
  expect(result.cssHighlightSize).toBe(1);
});
