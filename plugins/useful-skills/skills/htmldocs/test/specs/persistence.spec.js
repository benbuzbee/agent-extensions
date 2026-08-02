import { test, expect } from '@playwright/test';
import { seedInline, interceptComments } from '../helpers/comments-route.js';

// Contract tests for the shared HttpCommentsStore (the ONE browser HTTP client
// both runtimes build) over the ?comments body-op API, driven via the test
// handle's __HttpCommentsStore and a stubbed ?comments server (interceptComments).
// Each verb maps 1:1 to an op envelope; list is the GET; batch is one array POST.

async function boot(page) {
  await seedInline(page);
  const api = await interceptComments(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
  return api;
}

const DOC = { repo: '', ref: 'default', path: '/x' };
const AUTHOR = { login: 'user', name: null };

test('create -> list returns the thread with branded id and correct fields', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async ([doc, author]) => {
    const store = new window.__htmldocsComments.__HttpCommentsStore();
    const anchor = { exact: 'quick brown fox', prefix: 'The ', suffix: ' jumps', sections: ['alpha'] };
    const thread = await store.create(doc, { op: 'create', anchor, text: 'test comment' }, author);
    const threads = await store.list(doc);
    return { thread, threads };
  }, [DOC, AUTHOR]);
  expect(typeof result.thread.id).toBe('string');
  expect(result.thread.anchor.exact).toBe('quick brown fox');
  expect(result.thread.root.body).toBe('test comment');
  expect(result.thread.resolvedAt).toBeNull();
  expect(result.threads).toHaveLength(1);
  expect(result.threads[0].id).toBe(result.thread.id);
});

test('resolve stamps resolvedAt and is idempotent; reopen clears it', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async ([doc, author]) => {
    const store = new window.__htmldocsComments.__HttpCommentsStore();
    const thread = await store.create(doc, { op: 'create', anchor: { exact: 'test' }, text: 'c' }, author);
    const r1 = await store.resolve(doc, { op: 'resolve', threadId: thread.id }, author);
    const r2 = await store.resolve(doc, { op: 'resolve', threadId: thread.id }, author);
    const reopened = await store.reopen(doc, { op: 'reopen', threadId: thread.id }, author);
    return { r1: r1.resolvedAt, r2: r2.resolvedAt, reopened: reopened.resolvedAt };
  }, [DOC, AUTHOR]);
  expect(typeof result.r1).toBe('number');
  expect(result.r1).toBe(result.r2); // idempotent — no second overwrite
  expect(result.reopened).toBeNull();
});

test('delete removes the thread from list entirely (hard purge)', async ({ page }) => {
  const api = await boot(page);
  const threads = await page.evaluate(async ([doc, author]) => {
    const store = new window.__htmldocsComments.__HttpCommentsStore();
    const thread = await store.create(doc, { op: 'create', anchor: { exact: 'test' }, text: 'c' }, author);
    await store.delete(doc, { op: 'delete', threadId: thread.id }, author);
    return store.list(doc);
  }, [DOC, AUTHOR]);
  expect(threads).toHaveLength(0);
  expect(api.getThreads()).toHaveLength(0);
});

test('batch returns ordered OpResult[] mixing create/resolve/delete', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async ([doc, author]) => {
    const store = new window.__htmldocsComments.__HttpCommentsStore();
    const created = await store.batch(doc, [
      { op: 'create', anchor: { exact: 'a' }, text: 'first' },
      { op: 'create', anchor: { exact: 'b' }, text: 'second' },
    ], author);
    const resolveResults = await store.batch(doc, [
      { op: 'resolve', threadId: created[0].ok ? created[0].thread.id : 'x' },
      { op: 'delete', threadId: created[1].ok ? created[1].thread.id : 'x' },
    ], author);
    return { created, resolveResults };
  }, [DOC, AUTHOR]);
  expect(result.created).toHaveLength(2);
  expect(result.created[0].op).toBe('create');
  expect(result.resolveResults[0].op).toBe('resolve');
  expect(result.resolveResults[0].ok).toBe(true);
  expect(result.resolveResults[1].op).toBe('delete');
  expect(result.resolveResults[1].ok).toBe(true);
});

test('batch with a not_found threadId returns ok:false for that op only', async ({ page }) => {
  await boot(page);
  const results = await page.evaluate(async ([doc, author]) => {
    const store = new window.__htmldocsComments.__HttpCommentsStore();
    const thread = await store.create(doc, { op: 'create', anchor: { exact: 'a' }, text: 'keep' }, author);
    return store.batch(doc, [
      { op: 'resolve', threadId: thread.id },
      { op: 'resolve', threadId: 'nonexistent-id' },
    ], author);
  }, [DOC, AUTHOR]);
  expect(results[0].ok).toBe(true);
  expect(results[1].ok).toBe(false);
  expect(results[1].error.code).toBe('not_found');
});

test('a transient (500) create surfaces a tagged transient error', async ({ page }) => {
  const api = await boot(page);
  await api.breakWrites();
  const errCode = await page.evaluate(async ([doc, author]) => {
    const store = new window.__htmldocsComments.__HttpCommentsStore();
    try {
      await store.create(doc, { op: 'create', anchor: { exact: 'e' }, text: 'will fail' }, author);
      return null;
    } catch (err) {
      return err && err.opError && err.opError.code;
    }
  }, [DOC, AUTHOR]);
  expect(errCode).toBe('transient');
});
