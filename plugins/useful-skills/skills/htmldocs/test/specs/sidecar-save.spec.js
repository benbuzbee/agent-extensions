import { test, expect } from '@playwright/test';
import { seedInline, interceptSidecar } from '../helpers/sidecar-route.js';

// End-to-end programmatic save: the test handle hands the widget a Range
// and a body; saveComment encodes the anchor, PUTs the resulting
// CommentsModel to /__htmldocs/sidecar/<doc-path>, and reflects the new comment in
// the in-memory model. The route handler captures the PUT body so we can
// assert what would have landed on disk.

test('saveComment writes a valid sidecar that the server would persist', async ({ page }) => {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  const sidecar = await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const saved = await page.evaluate(async () => {
    const text = document.querySelector('#alpha p').firstChild;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 19);
    const comment = await window.__htmldocsComments.saveComment(range, 'first comment');
    return {
      comment,
      model: window.__htmldocsComments.getModel(),
      highlightIds: [...window.__htmldocsComments.getHighlights().keys()],
    };
  });

  expect(saved.comment.body).toBe('first comment');

  const onWire = sidecar.getState();
  expect(onWire.doc).toBe('index.html');
  expect(onWire.schema).toBe(1);
  expect(onWire.comments).toHaveLength(1);
  expect(onWire.comments[0].anchor.sections).toEqual(['alpha']);
  expect(onWire.comments[0].anchor.exact).toBe('quick brown fox');
  expect(onWire.comments[0].body).toBe('first comment');

  expect(saved.model.comments).toHaveLength(1);
  expect(saved.highlightIds).toEqual([saved.comment.id]);
});

test('saveComment heals a stale doc field from a corrupted-but-loadable sidecar', async ({ page }) => {
  // Pre-seed a sidecar whose top-level shape passes the load guard but
  // whose `doc:` field disagrees with the current page (could happen via
  // hand-edit, accidental copy between folders, or a pre-PR-2 sidecar).
  // The next save must heal both `doc` and `schema` rather than persist
  // them forward.
  const stale = { doc: 'somewhere-else.html', schema: 1, comments: [] };
  await seedInline(page, stale);
  const sidecar = await interceptSidecar(page, { initial: stale });
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  await page.evaluate(async () => {
    const text = document.querySelector('#alpha p').firstChild;
    const r = document.createRange();
    r.setStart(text, 4);
    r.setEnd(text, 19);
    await window.__htmldocsComments.saveComment(r, 'heal test');
  });

  const written = sidecar.getState();
  expect(written.doc).toBe('index.html');
  expect(written.schema).toBe(1);
  expect(written.comments).toHaveLength(1);
});

test('saveComment rolls back the in-memory model when the PUT throws', async ({ page }) => {
  await seedInline(page, { doc: 'index.html', schema: 1, comments: [] });
  const sidecar = await interceptSidecar(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  await sidecar.breakWrites();

  const out = await page.evaluate(async () => {
    const text = document.querySelector('#alpha p').firstChild;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 19);

    let errMsg = null;
    try {
      await window.__htmldocsComments.saveComment(range, 'will fail');
    } catch (err) {
      errMsg = err && err.message;
    }
    return {
      errMsg,
      model: window.__htmldocsComments.getModel(),
      highlights: [...window.__htmldocsComments.getHighlights().keys()],
    };
  });

  // The error message includes the failed status — pin it loosely so a
  // copy edit on the throw doesn't break the test.
  expect(out.errMsg).toMatch(/500/);
  expect(out.model.comments).toEqual([]);
  expect(out.highlights).toEqual([]);
});
