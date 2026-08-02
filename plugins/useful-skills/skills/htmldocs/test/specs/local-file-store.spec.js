import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// Unit-tests LocalFileStore ICommentsStore contract via test handle.

async function boot(page) {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
}

test('create thread -> list returns it with branded ThreadId and correct fields', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    const store = new Store();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const anchor = { exact: 'quick brown fox', prefix: 'The ', suffix: ' jumps', sections: ['alpha'] };
    const thread = await store.create(doc, { op: 'create', anchor, text: 'test comment' }, { login: 'user', name: null });
    const threads = await store.list(doc);
    return { thread, threads };
  });
  expect(result.thread.id).toBeTruthy();
  expect(typeof result.thread.id).toBe('string');
  expect(result.thread.anchor.exact).toBe('quick brown fox');
  expect(result.thread.root.body).toBe('test comment');
  expect(result.thread.root.author.login).toBe('user');
  expect(typeof result.thread.root.createdAt).toBe('number');
  expect(result.thread.resolvedAt).toBeNull();
  expect(result.threads).toHaveLength(1);
  expect(result.threads[0].id).toBe(result.thread.id);
});

test('resolve stamps resolvedAt with a Timestamp', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    const store = new Store();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const thread = await store.create(doc, { op: 'create', anchor: { exact: 'test' }, text: 'c' }, { login: 'u', name: null });
    const resolved = await store.resolve(doc, { op: 'resolve', threadId: thread.id }, { login: 'u', name: null });
    return { resolvedAt: resolved.resolvedAt };
  });
  expect(typeof result.resolvedAt).toBe('number');
  expect(result.resolvedAt).toBeGreaterThan(0);
});

test('resolve is idempotent — no error, same resolvedAt', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    const store = new Store();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const thread = await store.create(doc, { op: 'create', anchor: { exact: 'test' }, text: 'c' }, { login: 'u', name: null });
    const r1 = await store.resolve(doc, { op: 'resolve', threadId: thread.id }, { login: 'u', name: null });
    const r2 = await store.resolve(doc, { op: 'resolve', threadId: thread.id }, { login: 'u', name: null });
    return { r1: r1.resolvedAt, r2: r2.resolvedAt };
  });
  expect(result.r1).toBe(result.r2);
});

test('reopen clears resolvedAt back to null', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    const store = new Store();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const thread = await store.create(doc, { op: 'create', anchor: { exact: 'test' }, text: 'c' }, { login: 'u', name: null });
    await store.resolve(doc, { op: 'resolve', threadId: thread.id }, { login: 'u', name: null });
    const reopened = await store.reopen(doc, { op: 'reopen', threadId: thread.id }, { login: 'u', name: null });
    return { resolvedAt: reopened.resolvedAt };
  });
  expect(result.resolvedAt).toBeNull();
});

test('delete removes thread from list entirely (hard purge)', async ({ page }) => {
  const sidecar = await interceptSidecar(page);
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const result = await page.evaluate(async () => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    const store = new Store();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const thread = await store.create(doc, { op: 'create', anchor: { exact: 'test' }, text: 'c' }, { login: 'u', name: null });
    await store.delete(doc, { op: 'delete', threadId: thread.id }, { login: 'u', name: null });
    const threads = await store.list(doc);
    return { threads, deletedId: thread.id };
  });
  expect(result.threads).toHaveLength(0);
  // Verify the PUT body no longer contains the deleted thread
  const state = sidecar.getState();
  expect(state.comments).toHaveLength(0);
});

test('failed create rolls back so a later successful create writes exactly one comment', async ({ page }) => {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  const sidecar = await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  // Build a store and stash it so it survives across the break/restore below.
  await page.evaluate(() => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    window.__testStore = new Store();
  });

  // First create's PUT fails — must not leave a ghost thread behind.
  await sidecar.breakWrites();
  const firstErr = await page.evaluate(async () => {
    const doc = { repo: '', ref: 'default', path: location.pathname };
    try {
      await window.__testStore.create(doc, { op: 'create', anchor: { exact: 'a' }, text: 'first (fails)' }, { login: 'u', name: null });
      return null;
    } catch (err) { return err && err.message; }
  });

  // Restore writes and retry on the SAME store instance.
  await sidecar.restoreWrites();
  const result = await page.evaluate(async () => {
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const thread = await window.__testStore.create(doc, { op: 'create', anchor: { exact: 'b' }, text: 'second (ok)' }, { login: 'u', name: null });
    const threads = await window.__testStore.list(doc);
    return { listLen: threads.length, keptBody: thread.root.body };
  });

  expect(firstErr).toMatch(/500/);
  // The rolled-back ghost is gone: store lists exactly one thread …
  expect(result.listLen).toBe(1);
  expect(result.keptBody).toBe('second (ok)');
  // … and the persisted sidecar carries exactly one comment, not two.
  const written = sidecar.getState();
  expect(written.comments).toHaveLength(1);
  expect(written.comments[0].body).toBe('second (ok)');
});

test('batch returns ordered OpResult[] with ok:true for each', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    const store = new Store();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const author = { login: 'u', name: null };
    // Create, then resolve, then delete
    const results = await store.batch(doc, [
      { op: 'create', anchor: { exact: 'a' }, text: 'first' },
      { op: 'create', anchor: { exact: 'b' }, text: 'second' },
    ], author);
    const threadId = results[0].ok ? results[0].thread.id : null;
    const resolveResults = await store.batch(doc, [
      { op: 'resolve', threadId },
      { op: 'delete', threadId: results[1].ok ? results[1].thread.id : 'x' },
    ], author);
    return { createResults: results, resolveResults };
  });
  expect(result.createResults).toHaveLength(2);
  expect(result.createResults[0].ok).toBe(true);
  expect(result.createResults[0].op).toBe('create');
  expect(result.createResults[1].ok).toBe(true);
  expect(result.createResults[1].op).toBe('create');
  expect(result.resolveResults[0].ok).toBe(true);
  expect(result.resolveResults[0].op).toBe('resolve');
  expect(result.resolveResults[1].ok).toBe(true);
  expect(result.resolveResults[1].op).toBe('delete');
});

test('batch with not_found threadId returns ok:false for that op', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    const store = new Store();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const author = { login: 'u', name: null };
    const thread = await store.create(doc, { op: 'create', anchor: { exact: 'a' }, text: 'keep' }, author);
    const results = await store.batch(doc, [
      { op: 'resolve', threadId: thread.id },
      { op: 'resolve', threadId: 'nonexistent-id' },
    ], author);
    return results;
  });
  expect(result[0].ok).toBe(true);
  expect(result[1].ok).toBe(false);
  expect(result[1].error.code).toBe('not_found');
});

test('batch with reserved reply op returns ok:false with code transient', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const Store = window.__htmldocsComments.__LocalFileStore;
    const store = new Store();
    const doc = { repo: '', ref: 'default', path: location.pathname };
    const author = { login: 'u', name: null };
    const thread = await store.create(doc, { op: 'create', anchor: { exact: 'a' }, text: 'keep' }, author);
    const results = await store.batch(doc, [
      { op: 'reply', threadId: thread.id, text: 'nope' },
    ], author);
    return results;
  });
  expect(result[0].ok).toBe(false);
  expect(result[0].error.code).toBe('transient');
  expect(result[0].error.message).toMatch(/not yet supported/);
});
