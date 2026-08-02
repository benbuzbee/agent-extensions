import { test, expect } from '@playwright/test';
import { seedInlineHosted, interceptComments } from '../helpers/comments-route.js';

// Hosted-mode round trip. An author-carrying seed makes main.ts auto-select the
// HostedStore (over the ?comments body-op API) instead of the LocalFileStore
// (which would PUT /__htmldocs/sidecar). These specs prove the widget drives the
// hosted transport end to end against a stubbed ?comments server, with the same
// observable behavior the local runtime has.
//
// Harness note: the seed lands on DOMContentLoaded (addInitScript), one tick
// after the module's load-time selection runs; production injects the seed into
// the parsed HTML so it is present at module load. So each spec re-runs the SAME
// selection via __resetForTest()+__init() once the seed is in the DOM — exercising
// the real chooseDeps path, not a test-only shortcut.

const AUTHOR = { login: 'octocat', name: 'Mona Lisa', id: 7 };

async function mountHosted(page, model = { doc: 'index.html', schema: 1, comments: [] }) {
  await seedInlineHosted(page, model, AUTHOR);
  const api = await interceptComments(page, { author: AUTHOR });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(async () => {
    await window.__htmldocsComments.whenReady();
    window.__htmldocsComments.__resetForTest();
    await window.__htmldocsComments.__init();
  });
  return api;
}

test('an author seed auto-selects the HostedStore', async ({ page }) => {
  await mountHosted(page);
  const isHosted = await page.evaluate(() => {
    const store = window.__htmldocsComments.getStore();
    return store instanceof window.__htmldocsComments.__HostedStore;
  });
  expect(isHosted).toBe(true);
});

test('composing through the UI fires a ?comments create envelope and renders a bubble', async ({ page }) => {
  const api = await mountHosted(page);

  const saved = await page.evaluate(async () => {
    const text = document.querySelector('#alpha p').firstChild;
    const range = document.createRange();
    range.setStart(text, 4);   // "quick brown fox"
    range.setEnd(text, 19);
    const comment = await window.__htmldocsComments.saveComment(range, 'hosted note');
    return { body: comment.body, highlightIds: [...window.__htmldocsComments.getHighlights().keys()] };
  });
  expect(saved.body).toBe('hosted note');

  // The create went over the ?comments API as an {op:'create'} envelope — a
  // LocalFileStore would instead PUT /__htmldocs/sidecar.
  const posts = api.getCalls().filter((c) => c.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].body.op).toBe('create');
  expect(posts[0].body.anchor.exact).toBe('quick brown fox');
  expect(posts[0].body.text).toBe('hosted note');

  // The created gutter bubble renders.
  const bubble = page.locator('.htmldocs-cmt-bubble');
  await expect(bubble.first()).toBeVisible();
  expect(await bubble.count()).toBe(1);
});

test('getStore() drives create -> resolve and unwraps a resolved thread', async ({ page }) => {
  const api = await mountHosted(page);

  const outcome = await page.evaluate(async () => {
    const store = window.__htmldocsComments.getStore();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const author = { login: 'octocat', name: null };
    const created = await store.create(doc, { op: 'create', anchor: { exact: 'quick brown fox' }, text: 'x' }, author);
    const resolved = await store.resolve(doc, { op: 'resolve', threadId: created.id }, author);
    return { createdId: created.id, resolvedAt: resolved.resolvedAt };
  });

  // The resolve unwrapped a thread with resolvedAt stamped (soft-close).
  expect(outcome.resolvedAt).not.toBeNull();

  // The resolve went out as an {op:'resolve', threadId} envelope over ?comments.
  const resolvePost = api.getCalls().find((c) => c.method === 'POST' && c.body && c.body.op === 'resolve');
  expect(resolvePost).toBeTruthy();
  expect(resolvePost.body.threadId).toBe(outcome.createdId);
});

test('a resolved-author seed renders a green resolved bubble that stays visible', async ({ page }) => {
  // The state a reload sees after a resolve: the seed carries resolved_at. Soft
  // close is never hidden — the bubble stays visible and turns green.
  const model = {
    doc: 'index.html',
    schema: 1,
    comments: [
      {
        id: 'c-hosted-resolved',
        anchor: { sections: ['alpha'], prefix: 'The ', exact: 'quick brown fox', suffix: ' jumps over' },
        body: 'hosted resolved comment',
        author: 'octocat',
        created_at: '2026-01-01T00:00:00Z',
        resolved_at: '2026-01-02T00:00:00Z',
      },
    ],
  };
  await mountHosted(page, model);

  const bubble = page.locator('.htmldocs-cmt-bubble');
  await expect(bubble.first()).toBeVisible();
  expect(await bubble.count()).toBe(1);

  const resolvedBubble = page.locator('.htmldocs-cmt-bubble.htmldocs-cmt-bubble--resolved');
  await expect(resolvedBubble.first()).toBeVisible();
  expect(await resolvedBubble.count()).toBe(1);
});
