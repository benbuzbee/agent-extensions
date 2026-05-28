import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// Surrounding text changes; exact-quoted substring is preserved. Re-anchor
// must still find the highlight after the prose drifts around it. The
// `drift-exact-preserved` sidecar's anchor is "quick brown fox" with prose
// before/after — we rewrite the prose at runtime and reanchor.

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(
  readFileSync(path.resolve(here, '../fixtures/drift-exact-preserved/index.comments.json'), 'utf8'),
);

test('re-anchor finds the highlight after surrounding text edits', async ({ page }) => {
  await seedInline(page, seed);
  await interceptSidecar(page, { initial: seed });
  await page.goto('/test/fixtures/drift-exact-preserved/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const out = await page.evaluate(async () => {
    const before = window.__htmldocsComments.getHighlights().get('c1');
    const beforeText = before ? before.toString() : null;
    const beforeNode = before ? before.startContainer : null;

    const article = document.getElementById('alpha');
    article.innerHTML =
      '<h2>Alpha</h2>' +
      '<p>Once upon a time the quick brown fox showed up in a sentence with completely different wording.</p>';

    await window.__htmldocsComments.reanchor();
    const after = window.__htmldocsComments.getHighlights().get('c1');
    return {
      beforeText,
      afterText: after ? after.toString() : null,
      nodeReplaced: after ? after.startContainer !== beforeNode : null,
    };
  });

  expect(out.beforeText).toBe('quick brown fox');
  expect(out.afterText).toBe('quick brown fox');
  expect(out.nodeReplaced).toBe(true);
});
