import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// End-to-end flow through the UI layer: selection → popover button →
// <dialog> composer → submit. Save lands as a PUT to /__htmldocs/sidecar/<doc-path>
// which we route-intercept.

async function bootEmpty(page) {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  const sidecar = await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());
  return sidecar;
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

test('popover click opens the composer; submit writes the sidecar', async ({ page }) => {
  const sidecar = await bootEmpty(page);
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
    return { count: model.comments.length, body: model.comments[0].body };
  });
  expect(out.count).toBe(1);
  expect(out.body).toBe('first ui comment');
  expect(sidecar.getState().comments[0].body).toBe('first ui comment');
});

test('cancel button closes the composer without saving', async ({ page }) => {
  const sidecar = await bootEmpty(page);
  await selectQuickBrownFox(page);
  await page.locator('.htmldocs-cmt-popover-btn').click();

  await page.locator('.htmldocs-cmt-composer-body').fill('typed but cancelled');
  await page.locator('.htmldocs-cmt-composer-cancel').click();

  await expect(page.locator('.htmldocs-cmt-composer')).toBeHidden();
  const model = await page.evaluate(() => window.__htmldocsComments.getModel());
  expect(model.comments).toEqual([]);
  expect(sidecar.getCalls().filter((c) => c.method === 'PUT')).toEqual([]);
});

test('Esc closes the composer without saving and drops the pending range', async ({ page }) => {
  const sidecar = await bootEmpty(page);
  await selectQuickBrownFox(page);
  await page.locator('.htmldocs-cmt-popover-btn').click();
  await page.locator('.htmldocs-cmt-composer-body').fill('escaped');
  await page.keyboard.press('Escape');
  await expect(page.locator('.htmldocs-cmt-composer')).toBeHidden();
  expect(sidecar.getCalls().filter((c) => c.method === 'PUT')).toEqual([]);
});

test('empty body submission is a no-op (does not write a blank comment)', async ({ page }) => {
  const sidecar = await bootEmpty(page);
  await selectQuickBrownFox(page);
  await page.locator('.htmldocs-cmt-popover-btn').click();
  // textarea is `required`; the form-validation step rejects submit before
  // our handler fires. No PUT should land.
  await page.locator('.htmldocs-cmt-composer-submit').click();
  expect(sidecar.getCalls().filter((c) => c.method === 'PUT')).toEqual([]);
});
