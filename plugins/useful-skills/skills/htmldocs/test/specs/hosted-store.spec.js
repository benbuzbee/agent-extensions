import { test, expect } from '@playwright/test';
import { seedInlineHosted, interceptComments, thread } from '../helpers/comments-route.js';

// Hosted-mode round trip. The widget adopts whatever author its seed carries —
// here a real GitHub identity, the hosted stamp. Every runtime drives the SAME
// HttpCommentsStore over the ?comments body-op API; these specs prove the
// widget drives the transport end to end against a stubbed ?comments server.
//
// Harness note: the seed lands on DOMContentLoaded (addInitScript), one tick
// after the module's load-time wiring runs; production injects the seed into
// the parsed HTML so it is present at module load. So each spec re-runs the
// SAME wiring via __resetForTest()+__init() once the seed is in the DOM —
// exercising the real seed-author path, not a test-only shortcut.

const AUTHOR = { login: 'octocat', name: 'Mona Lisa', id: 7 };

async function mountHosted(page, seed = { threads: [] }) {
  await seedInlineHosted(page, seed, AUTHOR);
  const api = await interceptComments(page, { author: AUTHOR });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(async () => {
    await window.__htmldocsComments.whenReady();
    window.__htmldocsComments.__resetForTest();
    await window.__htmldocsComments.__init();
  });
  return api;
}

test('an author seed builds the shared HttpCommentsStore', async ({ page }) => {
  await mountHosted(page);
  const isHttp = await page.evaluate(() => {
    const store = window.__htmldocsComments.getStore();
    return store instanceof window.__htmldocsComments.__HttpCommentsStore;
  });
  expect(isHttp).toBe(true);
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

  // The create went over the ?comments API as an {op:'create'} envelope.
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
  // The state a reload sees after a resolve: the seeded thread carries a
  // resolvedAt. Soft close is never hidden — the bubble stays visible, green.
  const seed = {
    threads: [thread({
      id: 'c-hosted-resolved',
      exact: 'quick brown fox',
      prefix: 'The ',
      suffix: ' jumps over',
      sections: ['alpha'],
      body: 'hosted resolved comment',
      author: 'octocat',
      resolvedAt: 2000,
    })],
  };
  await mountHosted(page, seed);

  const bubble = page.locator('.htmldocs-cmt-bubble');
  await expect(bubble.first()).toBeVisible();
  expect(await bubble.count()).toBe(1);

  const resolvedBubble = page.locator('.htmldocs-cmt-bubble.htmldocs-cmt-bubble--resolved');
  await expect(resolvedBubble.first()).toBeVisible();
  expect(await resolvedBubble.count()).toBe(1);
});
