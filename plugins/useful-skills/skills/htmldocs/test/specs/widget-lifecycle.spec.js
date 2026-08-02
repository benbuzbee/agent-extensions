import { test, expect } from '@playwright/test';
import { seedInline, interceptComments, thread } from '../helpers/comments-route.js';

// Lifecycle invariants the singleton→class refactor introduced: after
// `__resetForTest` swaps `activeWidget` for a fresh CommentsWidget, the
// prior instance's listeners must be detached (no stale resize handler
// repainting the gutter against a torn-down DOM) and its state must not
// leak into the new instance. `reset-for-test.spec.js` covers the broad
// DOM-count + null-model shape; this spec drills into the failure modes
// that a poorly-detached listener or a leaked field would produce.

const seedPrior = {
  threads: [thread({ id: 'c-prior', exact: 'quick brown fox', prefix: 'The ', suffix: ' jumps over', sections: ['alpha'], body: 'prior widget' })],
};

test('MountedUI.unmount detaches the window resize listener (add/remove counts balance across reset)', async ({ page }) => {
  // Instrument window.addEventListener / removeEventListener for 'resize'
  // BEFORE the comments module loads. Counts give us a direct, sensitive
  // assertion: a regression that skips MountedUI.unmount's detacher loop
  // would leave adds > removes after reset.
  await page.addInitScript(() => {
    window.__resizeAdds = 0;
    window.__resizeRemoves = 0;
    const origAdd = window.addEventListener.bind(window);
    const origRemove = window.removeEventListener.bind(window);
    window.addEventListener = function (type, ...rest) {
      if (type === 'resize') window.__resizeAdds++;
      return origAdd(type, ...rest);
    };
    window.removeEventListener = function (type, ...rest) {
      if (type === 'resize') window.__resizeRemoves++;
      return origRemove(type, ...rest);
    };
  });
  await seedInline(page, seedPrior);
  await interceptComments(page, { threads: seedPrior.threads });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const afterMount = await page.evaluate(() => ({
    adds: window.__resizeAdds, removes: window.__resizeRemoves,
  }));
  expect(afterMount.adds - afterMount.removes).toBe(1);

  await page.evaluate(() => window.__htmldocsComments.__resetForTest());
  const afterReset = await page.evaluate(() => ({
    adds: window.__resizeAdds, removes: window.__resizeRemoves,
  }));
  expect(afterReset.adds - afterReset.removes).toBe(0);

  await page.evaluate(async () => {
    window.__htmldocsComments.__init();
    await window.__htmldocsComments.whenReady();
  });
  const afterRemount = await page.evaluate(() => ({
    adds: window.__resizeAdds, removes: window.__resizeRemoves,
  }));
  expect(afterRemount.adds - afterRemount.removes).toBe(1);
});

test('fresh widget after reset reports its own model only — no leaked prior comment', async ({ page }) => {
  // First seed has the prior comment. After init mounts and reads it,
  // we mutate the inline seed to point at a different anchor + id, then
  // reset+re-init. The new widget reads the mutated seed; the prior
  // comment must not leak through.
  await seedInline(page, seedPrior);
  await interceptComments(page, { threads: seedPrior.threads });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  await page.evaluate(() => {
    const seedB = {
      threads: [{
        id: 'c-new',
        anchor: { prefix: 'jumps over ', exact: 'the lazy', suffix: ' dog.', sections: ['alpha'] },
        root: { id: 'c-new', author: { login: 'user', name: null }, body: 'new widget', createdAt: 1000 },
        replies: [],
        resolvedAt: null,
      }],
    };
    document.getElementById('__htmldocs_comments').textContent = JSON.stringify(seedB);
  });

  await page.evaluate(async () => {
    window.__htmldocsComments.__resetForTest();
    window.__htmldocsComments.__init();
    await window.__htmldocsComments.whenReady();
  });

  const after = await page.evaluate(() => ({
    commentIds: window.__htmldocsComments.getModel().threads.map((t) => t.id),
    highlightCount: window.__htmldocsComments.getHighlights().size,
    orphanCount: window.__htmldocsComments.getOrphanCount(),
  }));
  expect(after.commentIds).toEqual(['c-new']);
  expect(after.highlightCount).toBe(1);
  expect(after.orphanCount).toBe(0);
});

test('CSS Custom Highlight is cleared on unmount and republished by the next mount', async ({ page }) => {
  await seedInline(page, seedPrior);
  await interceptComments(page, { threads: seedPrior.threads });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const priorHighlightSize = await page.evaluate(() => {
    const cssHi = CSS.highlights;
    const h = cssHi && cssHi.get('htmldocs-cmt');
    return h ? h.size : 0;
  });
  expect(priorHighlightSize).toBe(1);

  await page.evaluate(() => window.__htmldocsComments.__resetForTest());
  const afterReset = await page.evaluate(() => {
    const cssHi = CSS.highlights;
    return cssHi ? (cssHi.get('htmldocs-cmt') ? cssHi.get('htmldocs-cmt').size : 0) : 0;
  });
  expect(afterReset).toBe(0);

  await page.evaluate(() => {
    const seedB = {
      threads: [{
        id: 'c-new',
        anchor: { prefix: 'jumps over ', exact: 'the lazy', suffix: ' dog.', sections: ['alpha'] },
        root: { id: 'c-new', author: { login: 'user', name: null }, body: 'new', createdAt: 1000 },
        replies: [],
        resolvedAt: null,
      }],
    };
    document.getElementById('__htmldocs_comments').textContent = JSON.stringify(seedB);
  });
  await page.evaluate(async () => {
    window.__htmldocsComments.__init();
    await window.__htmldocsComments.whenReady();
  });
  const newHighlightSize = await page.evaluate(() => {
    const cssHi = CSS.highlights;
    const h = cssHi && cssHi.get('htmldocs-cmt');
    return h ? h.size : 0;
  });
  expect(newHighlightSize).toBe(1);
});
