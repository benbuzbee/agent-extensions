import { test, expect } from '@playwright/test';
import { seedInline, interceptComments } from '../helpers/comments-route.js';

// Regression coverage for two correctness hedges added in this PR:
//
// 1. Widget chrome (popover button "💬", composer "Cancel"/"Comment", gutter
//    bubble emojis) lives inside document.body. Without filtering, that text
//    becomes part of the canonical stream the encoder slices prefix/suffix
//    from, and bubble count varies between encode time (mid-session, prior
//    saves rendered) and decode time (post-reload, before refreshGutter
//    runs). The .htmldocs-cmt-* class filter in isHiddenText keeps the
//    stream stable across renders.
//
// 2. touchedArticleIds dedupes duplicate ids so a malformed doc declaring
//    the same id on two <article>s collapses to one sections entry,
//    matching the implicit set semantics of `sections.includes(X)`.

test('encoded prefix/suffix do not contain widget chrome text', async ({ page }) => {
  await seedInline(page);
  await interceptComments(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const anchor = await page.evaluate(() => {
    // Strip #beta so the selection's end is followed only by widget chrome
    // (popover, composer, gutter) — the worst-case position for chrome
    // pollution.
    document.getElementById('beta').remove();
    const text = document.querySelector('#alpha p').firstChild;
    const total = text.data.length;
    const r = document.createRange();
    r.setStart(text, total - 4);   // "dog."
    r.setEnd(text, total);
    return window.__htmldocsComments.__anchor.fromRange(r);
  });
  expect(anchor.exact).toBe('dog.');
  // Chrome text the filter is meant to suppress.
  expect(anchor.prefix).not.toContain('💬');
  expect(anchor.prefix).not.toContain('Cancel');
  expect(anchor.prefix).not.toContain('Comment');
  expect(anchor.suffix).not.toContain('💬');
  expect(anchor.suffix).not.toContain('Cancel');
  expect(anchor.suffix).not.toContain('Comment');
});

test('touchedArticleIds dedupes duplicate ids on malformed docs', async ({ page }) => {
  await seedInline(page);
  await interceptComments(page);
  await page.goto('/test/fixtures/clean/index.html?test=1');
  await page.evaluate(() => window.__htmldocsComments.whenReady());

  const sections = await page.evaluate(() => {
    // Force a duplicate-id collision: clone #alpha so two <article id="alpha">
    // exist side by side. The fixture's #beta gets in the way of a clean
    // cross-article range; remove it first.
    document.getElementById('beta').remove();
    const clone = document.getElementById('alpha').cloneNode(true);
    document.body.appendChild(clone);

    // Range spans both #alpha elements end-to-end.
    const firstP = document.querySelectorAll('#alpha p')[0].firstChild;
    const secondP = document.querySelectorAll('#alpha p')[1].firstChild;
    const r = document.createRange();
    r.setStart(firstP, 0);
    r.setEnd(secondP, secondP.data.length);
    return window.__htmldocsComments.__anchor.fromRange(r).sections;
  });
  expect(sections).toEqual(['alpha']);
});
