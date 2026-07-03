import { test, expect } from '@playwright/test';
import { seedInline, interceptComments, thread } from '../helpers/comments-route.js';

// Surrounding text changes; exact-quoted substring is preserved. Re-anchor
// must still find the highlight after the prose drifts around it. The seeded
// thread's anchor is "quick brown fox" with prose before/after — we rewrite the
// prose at runtime and reanchor.

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

test('re-anchor finds the highlight after surrounding text edits', async ({ page }) => {
  await seedInline(page, seed);
  await interceptComments(page, { threads: seed.threads });
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
