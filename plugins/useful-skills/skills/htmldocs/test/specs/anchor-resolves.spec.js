import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// Pre-existing sidecar JSON resolves to the right Range on page load AND
// registers the highlight in the CSS Custom Highlight registry (not just
// the JS-side Map). The CSS-side check guards against regressions where
// rebuildHighlights's feature-detect or guard wrongly skips the .set().

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(
  readFileSync(path.resolve(here, '../fixtures/drift-exact-preserved/index.comments.json'), 'utf8'),
);

test('seeded sidecar resolves to a Range and registers the CSS highlight', async ({ page }) => {
  await seedInline(page, seed);
  await interceptSidecar(page, { initial: seed });
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
