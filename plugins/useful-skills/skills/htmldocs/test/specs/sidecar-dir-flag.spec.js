// In-process tests for explicit sidecarDir handling. Covers: the option is
// honored verbatim and used for writes; a fresh server pointed at a
// hand-seeded sidecarDir surfaces prior comments via the inline JSON seed
// (resume across runs); a missing path gets created on startup.

import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startReviewServer } from '../../dist/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '../..');

/** @type {string | null} */
let rootDir = null;

test.beforeAll(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-flag-root-'));
  const cleanHtml = await fs.readFile(path.join(skillRoot, 'test/fixtures/clean/index.html'), 'utf-8');
  await fs.writeFile(path.join(rootDir, 'index.html'), cleanHtml, 'utf-8');
});

test.afterAll(async () => {
  if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
});

test('sidecarDir option is honored verbatim and used for writes', async ({ browser }) => {
  const stable = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-flag-stable-'));
  const handle = await startReviewServer({ root: rootDir, sidecarDir: stable });
  try {
    expect(path.resolve(handle.sidecarDir)).toBe(path.resolve(stable));

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${handle.url}/index.html?test=1`);
    await page.evaluate(() => window.__htmldocsComments.whenReady());
    await page.evaluate(async () => {
      const text = document.querySelector('#alpha p').firstChild;
      const r = document.createRange();
      r.setStart(text, 4);
      r.setEnd(text, 19);
      await window.__htmldocsComments.saveComment(r, 'persisted across runs');
    });
    await ctx.close();

    const onDisk = JSON.parse(await fs.readFile(path.join(stable, 'index.comments.json'), 'utf-8'));
    expect(onDisk.comments).toHaveLength(1);
    expect(onDisk.comments[0].body).toBe('persisted across runs');
  } finally {
    await handle.close();
    await fs.rm(stable, { recursive: true, force: true });
  }
});

test('a fresh server pointed at the same sidecarDir resumes prior comments', async ({ browser }) => {
  const resumeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-flag-resume-'));
  const seed = {
    doc: 'index.html',
    schema: 1,
    comments: [{
      id: 'c-resume',
      anchor: { sections: ['alpha'], prefix: 'The ', exact: 'quick brown fox', suffix: ' jumps' },
      body: 'persisted across runs',
      author: 'user',
      created_at: '2026-05-26T00:00:00Z',
    }],
  };
  await fs.writeFile(path.join(resumeDir, 'index.comments.json'), JSON.stringify(seed, null, 2));

  const handle = await startReviewServer({ root: rootDir, sidecarDir: resumeDir });
  try {
    expect(path.resolve(handle.sidecarDir)).toBe(path.resolve(resumeDir));

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${handle.url}/index.html?test=1`);
    await page.evaluate(() => window.__htmldocsComments.whenReady());
    const model = await page.evaluate(() => window.__htmldocsComments.getModel());
    expect(model.comments).toHaveLength(1);
    expect(model.comments[0].body).toBe('persisted across runs');
    await ctx.close();
  } finally {
    await handle.close();
    await fs.rm(resumeDir, { recursive: true, force: true });
  }
});

test('a missing sidecarDir is created on startup', async () => {
  const ghost = path.join(os.tmpdir(), `htmldocs-flag-ghost-${Date.now()}-${process.pid}`);
  await expect(fs.stat(ghost)).rejects.toMatchObject({ code: 'ENOENT' });
  const handle = await startReviewServer({ root: rootDir, sidecarDir: ghost });
  try {
    expect(path.resolve(handle.sidecarDir)).toBe(path.resolve(ghost));
    const stat = await fs.stat(ghost);
    expect(stat.isDirectory()).toBe(true);
  } finally {
    await handle.close();
    await fs.rm(ghost, { recursive: true, force: true });
  }
});

test('an existing path that is a file is rejected with a clear error', async () => {
  const collision = path.join(os.tmpdir(), `htmldocs-flag-file-${Date.now()}-${process.pid}`);
  await fs.writeFile(collision, 'not a directory');
  try {
    await expect(
      startReviewServer({ root: rootDir, sidecarDir: collision })
    ).rejects.toThrow(/--sidecar-dir is not a directory/);
  } finally {
    await fs.rm(collision, { force: true });
  }
});
