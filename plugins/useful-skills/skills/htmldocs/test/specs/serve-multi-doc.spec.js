// Multi-doc in-process server test. Boots createServer/startReviewServer
// directly (no child subprocess) and drives a real browser through the
// widget. Proves the per-doc-sidecar contract: every served .html gets its
// own widget instance, and PUTs route to a sidecar mirroring the doc's
// path under --root inside SIDECAR_DIR (including arbitrary depth).

import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startReviewServer } from '../../dist/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '../..');

/** @type {{ server: import('node:http').Server, url: string, sidecarDir: string, close: () => Promise<void> } | null} */
let handle = null;
/** @type {string | null} */
let rootDir = null;

test.beforeAll(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-multi-doc-'));
  const cleanHtml = await fs.readFile(path.join(skillRoot, 'test/fixtures/clean/index.html'), 'utf-8');
  // Two top-level copies + a depth-3 nested doc — same DOM (anchors resolve
  // identically) but each lives at its own URL path, so each should land
  // its own sidecar at the mirrored location.
  await fs.writeFile(path.join(rootDir, 'alpha.html'), cleanHtml, 'utf-8');
  await fs.writeFile(path.join(rootDir, 'beta.html'), cleanHtml, 'utf-8');
  const nested = path.join(rootDir, 'a', 'b', 'c');
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(nested, 'foo.html'), cleanHtml, 'utf-8');

  handle = await startReviewServer({ root: rootDir });
});

test.afterAll(async () => {
  if (handle) await handle.close();
  if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  if (handle?.sidecarDir) await fs.rm(handle.sidecarDir, { recursive: true, force: true });
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 * @param {string} body
 */
async function saveOn(page, url, body) {
  await page.goto(url);
  await page.evaluate(() => window.__htmldocsComments.whenReady());
  await page.evaluate(async (b) => {
    const text = document.querySelector('#alpha p').firstChild;
    const r = document.createRange();
    r.setStart(text, 4);
    r.setEnd(text, 19);
    await window.__htmldocsComments.saveComment(r, b);
  }, body);
}

test('each served HTML — including nested — gets its own sidecar mirrored under SIDECAR_DIR', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await saveOn(page, `${handle.url}/alpha.html?test=1`, 'on alpha');
  await saveOn(page, `${handle.url}/beta.html?test=1`, 'on beta');
  await saveOn(page, `${handle.url}/a/b/c/foo.html?test=1`, 'on nested foo');

  const alpha = JSON.parse(await fs.readFile(path.join(handle.sidecarDir, 'alpha.comments.json'), 'utf-8'));
  const beta = JSON.parse(await fs.readFile(path.join(handle.sidecarDir, 'beta.comments.json'), 'utf-8'));
  const nested = JSON.parse(await fs.readFile(path.join(handle.sidecarDir, 'a', 'b', 'c', 'foo.comments.json'), 'utf-8'));

  expect(alpha.comments).toHaveLength(1);
  expect(alpha.comments[0].body).toBe('on alpha');
  expect(beta.comments).toHaveLength(1);
  expect(beta.comments[0].body).toBe('on beta');
  expect(nested.comments).toHaveLength(1);
  expect(nested.comments[0].body).toBe('on nested foo');

  // Nothing leaked into the served tree.
  await expect(fs.stat(path.join(rootDir, 'alpha.comments.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.stat(path.join(rootDir, 'beta.comments.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.stat(path.join(rootDir, 'a', 'b', 'c', 'foo.comments.json'))).rejects.toMatchObject({ code: 'ENOENT' });

  // Cross-doc isolation.
  expect(alpha.comments[0].body).not.toBe('on beta');
  expect(beta.comments[0].body).not.toBe('on alpha');
  expect(nested.comments[0].body).not.toBe('on alpha');

  await ctx.close();
});
