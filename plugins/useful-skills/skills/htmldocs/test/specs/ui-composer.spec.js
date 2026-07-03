import { test, expect } from '@playwright/test';
import { seedInline, interceptComments } from '../helpers/comments-route.js';

// End-to-end flow through the UI layer: selection → popover button →
// <dialog> composer → submit. Save lands as a POST op envelope to the
// <doc>?comments API, which we route-intercept.

async function bootEmpty(page) {
  await seedInline(page);
  const api = await interceptComments(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
  return api;
}

async function selectQuickBrownFox(page) {
  await page.evaluate(() => {
    const text = document.querySelector('#alpha p').firstChild;
    const r = document.createRange();
    r.setStart(text, 4);
    r.setEnd(text, 19);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
}

test('popover click opens the composer; submit POSTs a create op', async ({ page }) => {
  const api = await bootEmpty(page);
  await selectQuickBrownFox(page);

  const popoverBtn = page.locator('.htmldocs-cmt-popover-btn');
  await popoverBtn.click();

  const composer = page.locator('.htmldocs-cmt-composer');
  await expect(composer).toBeVisible();

  await page.locator('.htmldocs-cmt-composer-body').fill('first ui comment');
  await page.locator('.htmldocs-cmt-composer-submit').click();

  await expect(composer).toBeHidden();

  const out = await page.evaluate(() => {
    const model = window.__htmldocsComments.getModel();
    return { count: model.threads.length, body: model.threads[0].root.body };
  });
  expect(out.count).toBe(1);
  expect(out.body).toBe('first ui comment');

  // The save went over ?comments as a single {op:'create'} envelope.
  const posts = api.getCalls().filter((c) => c.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].body.op).toBe('create');
  expect(posts[0].body.text).toBe('first ui comment');
  expect(api.getThreads()[0].root.body).toBe('first ui comment');
});

test('cancel button closes the composer without saving', async ({ page }) => {
  const api = await bootEmpty(page);
  await selectQuickBrownFox(page);
  await page.locator('.htmldocs-cmt-popover-btn').click();

  await page.locator('.htmldocs-cmt-composer-body').fill('typed but cancelled');
  await page.locator('.htmldocs-cmt-composer-cancel').click();

  await expect(page.locator('.htmldocs-cmt-composer')).toBeHidden();
  const model = await page.evaluate(() => window.__htmldocsComments.getModel());
  expect(model.threads).toEqual([]);
  expect(api.getCalls().filter((c) => c.method === 'POST')).toEqual([]);
});

test('Esc closes the composer without saving and drops the pending range', async ({ page }) => {
  const api = await bootEmpty(page);
  await selectQuickBrownFox(page);
  await page.locator('.htmldocs-cmt-popover-btn').click();
  await page.locator('.htmldocs-cmt-composer-body').fill('escaped');
  await page.keyboard.press('Escape');
  await expect(page.locator('.htmldocs-cmt-composer')).toBeHidden();
  expect(api.getCalls().filter((c) => c.method === 'POST')).toEqual([]);
});

test('empty body submission is a no-op (does not write a blank comment)', async ({ page }) => {
  const api = await bootEmpty(page);
  await selectQuickBrownFox(page);
  await page.locator('.htmldocs-cmt-popover-btn').click();
  // textarea is `required`; the form-validation step rejects submit before
  // our handler fires. No op should POST.
  await page.locator('.htmldocs-cmt-composer-submit').click();
  expect(api.getCalls().filter((c) => c.method === 'POST')).toEqual([]);
});
