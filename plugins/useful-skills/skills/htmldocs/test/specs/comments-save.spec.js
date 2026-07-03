import { test, expect } from '@playwright/test';
import { seedInline, interceptComments } from '../helpers/comments-route.js';

// End-to-end programmatic save over the ONE transport: the test handle hands the
// widget a Range and a body; saveComment encodes the anchor and POSTs a single
// {op:'create', anchor, text} envelope to the <doc>?comments API (never a PUT).
// The route handler captures the op so we can assert what went over the wire.

test('saveComment POSTs a create op to ?comments and renders the returned thread', async ({ page }) => {
  await seedInline(page);
  const api = await interceptComments(page);
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

  // Exactly one create op went over ?comments — no PUT, no whole-model write.
  const posts = api.getCalls().filter((c) => c.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].body.op).toBe('create');
  expect(posts[0].body.anchor.sections).toEqual(['alpha']);
  expect(posts[0].body.anchor.exact).toBe('quick brown fox');
  expect(posts[0].body.text).toBe('first comment');

  // The returned thread is in the internal { threads } view and highlighted.
  expect(saved.model.threads).toHaveLength(1);
  expect(saved.model.threads[0].root.body).toBe('first comment');
  expect(saved.highlightIds).toEqual([saved.comment.id]);
});

test('a failed create surfaces the tagged error and renders no ghost thread', async ({ page }) => {
  await seedInline(page);
  const api = await interceptComments(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  await api.breakWrites();

  const out = await page.evaluate(async () => {
    const text = document.querySelector('#alpha p').firstChild;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 19);

    let errCode = null;
    try {
      await window.__htmldocsComments.saveComment(range, 'will fail');
    } catch (err) {
      errCode = err && err.opError && err.opError.code;
    }
    return {
      errCode,
      model: window.__htmldocsComments.getModel(),
      highlights: [...window.__htmldocsComments.getHighlights().keys()],
    };
  });

  // A 500 maps to a transient tagged error; the create never resolves, so the
  // thread is never pushed — no ghost in the view.
  expect(out.errCode).toBe('transient');
  expect(out.model.threads).toEqual([]);
  expect(out.highlights).toEqual([]);
});
