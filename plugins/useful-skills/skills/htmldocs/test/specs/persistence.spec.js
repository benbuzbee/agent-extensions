import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// Direct tests against HttpSidecarStore via the test handle's
// __HttpSidecarStore field. Unit-style: skip the widget lifecycle and
// exercise load (reads inline JSON seed) + save (PUTs /__htmldocs/sidecar/<doc-path>).
// Integration coverage lives in sidecar-save / anchor-resolves / re-anchor.

async function bootBare(page) {
  // Seed an empty model so the widget mounts (init() bails when no inline
  // JSON seed is present — review-mode signal). The Store tests don't
  // actually depend on the widget being mounted, but boot is the cheapest
  // way to get __HttpSidecarStore on the window.
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
}

test.describe('HttpSidecarStore', () => {
  test('filename strips .html and appends .comments.json', async ({ page }) => {
    await bootBare(page);
    const cases = await page.evaluate(() => {
      const Store = window.__htmldocsComments.__HttpSidecarStore;
      return [
        Store.filename('foo.html'),
        Store.filename('a.HTML'),
        Store.filename('plain'),
        Store.filename('with.dots.html'),
      ];
    });
    expect(cases).toEqual([
      'foo.comments.json',
      'a.comments.json',
      'plain.comments.json',
      'with.dots.comments.json',
    ]);
  });

  test('save PUTs the model to /__htmldocs/sidecar/<doc-path>', async ({ page }) => {
    await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
    const sidecar = await interceptSidecar(page);
    await page.goto('/test/fixtures/clean/index.html?test=1');
    await page.evaluate(() => window.__htmldocsComments.whenReady());
    await page.evaluate(async () => {
      const Store = window.__htmldocsComments.__HttpSidecarStore;
      const store = new Store();
      await store.save('foo.html', {
        doc: 'foo.html',
        schema: 1,
        comments: [
          {
            id: 'c1',
            anchor: { sections: ['alpha'], prefix: 'p', exact: 'e', suffix: 's' },
            body: 'hello',
            author: 'user',
            created_at: '2026-05-25T00:00:00Z',
          },
        ],
      });
    });
    const written = sidecar.getState();
    expect(written.doc).toBe('foo.html');
    expect(written.schema).toBe(1);
    expect(written.comments[0].body).toBe('hello');
  });

  test('load returns empty model when the inline seed is missing', async ({ page }) => {
    // Boot WITHOUT seeding inline JSON — widget itself stays unmounted
    // (review mode not active) but the Store class is still exposed via
    // the test handle as long as ?test=1 ran early. Need the handle on
    // window, so we use a no-op seed then evaluate before init runs.
    await page.addInitScript(() => {
      // Remove any seed left by other init scripts if they leak in.
      document.addEventListener('DOMContentLoaded', () => {
        const node = document.getElementById('__htmldocs_comments');
        if (node) node.remove();
      }, { once: true });
    });
    await page.goto('/test/fixtures/clean/index.html?test=1');
    const model = await page.evaluate(async () => {
      const Store = window.__htmldocsComments.__HttpSidecarStore;
      return new Store().load('absent.html');
    });
    expect(model).toEqual({ doc: 'absent.html', schema: 1, comments: [] });
  });

  test('load returns empty model when the inline seed is malformed JSON', async ({ page }) => {
    await page.addInitScript(() => {
      const inject = () => {
        if (!document.body) return false;
        const s = document.createElement('script');
        s.type = 'application/json';
        s.id = '__htmldocs_comments';
        s.textContent = '<<< not json';
        document.body.appendChild(s);
        return true;
      };
      if (!inject()) {
        const obs = new MutationObserver(() => { if (inject()) obs.disconnect(); });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      }
    });
    await page.goto('/test/fixtures/clean/index.html?test=1');
    const model = await page.evaluate(async () => {
      const Store = window.__htmldocsComments.__HttpSidecarStore;
      return new Store().load('foo.html');
    });
    expect(model).toEqual({ doc: 'foo.html', schema: 1, comments: [] });
  });

  test('load rejects shapes missing doc, missing schema, or with a future schema version', async ({ page }) => {
    // One spec per fixture would be cheaper if Playwright let us
    // page-set; we just navigate-then-evaluate per case.
    const cases = [
      { name: 'missingDoc', seed: { schema: 1, comments: [] } },
      { name: 'missingSchema', seed: { doc: 'foo.html', comments: [] } },
      { name: 'futureSchema', seed: { doc: 'foo.html', schema: 2, comments: [] } },
      { name: 'wrongType', seed: { doc: 42, schema: 1, comments: [] } },
    ];
    for (const { name, seed } of cases) {
      await page.addInitScript((payload) => {
        // Replace any pending seed with this one.
        const inject = () => {
          if (!document.body) return false;
          const existing = document.getElementById('__htmldocs_comments');
          if (existing) existing.remove();
          const s = document.createElement('script');
          s.type = 'application/json';
          s.id = '__htmldocs_comments';
          s.textContent = payload;
          document.body.appendChild(s);
          return true;
        };
        if (!inject()) {
          const obs = new MutationObserver(() => { if (inject()) obs.disconnect(); });
          obs.observe(document.documentElement, { childList: true, subtree: true });
        }
      }, JSON.stringify(seed));
      await page.goto('/test/fixtures/clean/index.html?test=1');
      const model = await page.evaluate(async () => {
        const Store = window.__htmldocsComments.__HttpSidecarStore;
        return new Store().load('foo.html');
      });
      expect(model, name).toEqual({ doc: 'foo.html', schema: 1, comments: [] });
    }
  });

  test('save propagates a server-side 5xx so the widget can roll back', async ({ page }) => {
    await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
    const sidecar = await interceptSidecar(page);
    await page.goto('/test/fixtures/clean/index.html?test=1');
    await page.evaluate(() => window.__htmldocsComments.whenReady());
    await sidecar.breakWrites();
    const errMsg = await page.evaluate(async () => {
      const Store = window.__htmldocsComments.__HttpSidecarStore;
      try {
        await new Store().save('foo.html', { doc: 'foo.html', schema: 1, comments: [] });
        return null;
      } catch (err) {
        return err && err.message;
      }
    });
    expect(errMsg).toMatch(/500/);
  });
});
