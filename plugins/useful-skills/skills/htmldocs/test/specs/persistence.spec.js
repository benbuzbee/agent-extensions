import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// Direct tests against LocalFileStore via the test handle's __LocalFileStore
// field. Unit-style: exercise the store's IO over the sidecar endpoint
// (create PUTs legacy-shape model, list returns [] on missing/malformed seed,
// create propagates 5xx).

async function bootBare(page) {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
}

test.describe('LocalFileStore', () => {
  test('filename strips .html and appends .comments.json', async ({ page }) => {
    await bootBare(page);
    const cases = await page.evaluate(() => {
      const Store = window.__htmldocsComments.__LocalFileStore;
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

  test('create PUTs the model in legacy wire shape to /__htmldocs/sidecar/<doc-path>', async ({ page }) => {
    await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
    const sidecar = await interceptSidecar(page);
    await page.goto('/test/fixtures/clean/index.html?test=1');
    await page.evaluate(() => window.__htmldocsComments.whenReady());
    await page.evaluate(async () => {
      const Store = window.__htmldocsComments.__LocalFileStore;
      const store = new Store();
      const doc = { repo: '', ref: 'default', path: location.pathname };
      await store.create(doc, {
        op: 'create',
        anchor: { exact: 'test text', prefix: 'p', suffix: 's', sections: ['alpha'] },
        text: 'hello',
      }, { login: 'user', name: null });
    });
    const written = sidecar.getState();
    expect(written.doc).toBe('index.html');
    expect(written.schema).toBe(1);
    expect(written.comments[0].body).toBe('hello');
    // Legacy wire shape: author is a string, created_at is an ISO string
    expect(typeof written.comments[0].author).toBe('string');
    expect(written.comments[0].author).toBe('user');
    expect(typeof written.comments[0].created_at).toBe('string');
    // Confirm it looks like an ISO date
    expect(written.comments[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('list returns empty when inline seed is missing', async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const node = document.getElementById('__htmldocs_comments');
        if (node) node.remove();
      }, { once: true });
    });
    await page.goto('/test/fixtures/clean/index.html?test=1');
    const threads = await page.evaluate(async () => {
      const Store = window.__htmldocsComments.__LocalFileStore;
      const store = new Store();
      const doc = { repo: '', ref: 'default', path: location.pathname };
      return store.list(doc);
    });
    expect(threads).toEqual([]);
  });

  test('list returns empty when inline seed is malformed JSON', async ({ page }) => {
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
    const threads = await page.evaluate(async () => {
      const Store = window.__htmldocsComments.__LocalFileStore;
      const store = new Store();
      const doc = { repo: '', ref: 'default', path: location.pathname };
      return store.list(doc);
    });
    expect(threads).toEqual([]);
  });

  test('list returns empty for seeds with bad shapes', async ({ page }) => {
    const cases = [
      { name: 'missingDoc', seed: { schema: 1, comments: [] } },
      { name: 'missingSchema', seed: { doc: 'foo.html', comments: [] } },
      { name: 'futureSchema', seed: { doc: 'foo.html', schema: 2, comments: [] } },
      { name: 'wrongType', seed: { doc: 42, schema: 1, comments: [] } },
    ];
    for (const { name, seed } of cases) {
      await page.addInitScript((payload) => {
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
      const threads = await page.evaluate(async () => {
        const Store = window.__htmldocsComments.__LocalFileStore;
        const store = new Store();
        const doc = { repo: '', ref: 'default', path: location.pathname };
        return store.list(doc);
      });
      expect(threads, name).toEqual([]);
    }
  });

  test('create propagates a server-side 5xx so the widget can roll back', async ({ page }) => {
    await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
    const sidecar = await interceptSidecar(page);
    await page.goto('/test/fixtures/clean/index.html?test=1');
    await page.evaluate(() => window.__htmldocsComments.whenReady());
    await sidecar.breakWrites();
    const errMsg = await page.evaluate(async () => {
      const Store = window.__htmldocsComments.__LocalFileStore;
      const store = new Store();
      const doc = { repo: '', ref: 'default', path: location.pathname };
      try {
        await store.create(doc, {
          op: 'create',
          anchor: { exact: 'e', prefix: 'p', suffix: 's', sections: [] },
          text: 'will fail',
        }, { login: 'user', name: null });
        return null;
      } catch (err) {
        return err && err.message;
      }
    });
    expect(errMsg).toMatch(/500/);
  });
});
