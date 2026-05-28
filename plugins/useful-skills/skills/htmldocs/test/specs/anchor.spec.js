import { test, expect } from '@playwright/test';

// TDD: these specs were authored before anchor.ts is implemented. They will
// be red ("PR 2 — anchor not implemented") until the encoder/decoder land.
// Each test builds its own DOM under the fixture's #alpha section, calls
// __anchor.fromRange / __anchor.toRange, and asserts on properties (not
// hardcoded offsets) so the assertions stay meaningful as the impl evolves.

const FIXTURE = '/test/fixtures/clean/index.html?test=1';

async function bootHandle(page) {
  await page.goto(FIXTURE);
  await page.evaluate(() => window.__htmldocsComments.whenReady());
}

test.describe('anchor encode/decode', () => {
  test('range → encode → decode → re-encode is a fixed point', async ({ page }) => {
    await bootHandle(page);
    const { first, second } = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      article.innerHTML = '<h2>Alpha</h2><p>The quick brown fox jumps over the lazy dog.</p>';
      const text = article.querySelector('p').firstChild;
      const r1 = document.createRange();
      r1.setStart(text, 4);   // start of "quick"
      r1.setEnd(text, 19);    // end of "fox"
      const a1 = window.__htmldocsComments.__anchor.fromRange(r1);
      const r2 = window.__htmldocsComments.__anchor.toRange(a1);
      const a2 = window.__htmldocsComments.__anchor.fromRange(r2);
      return { first: a1, second: a2 };
    });
    expect(second).toEqual(first);
    expect(first.sections).toEqual(['alpha']);
    expect(first.exact).toBe('quick brown fox');
  });

  test('decode resolves to a Range whose toString equals exact', async ({ page }) => {
    await bootHandle(page);
    const text = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      article.innerHTML = '<h2>Alpha</h2><p>The quick brown fox jumps over the lazy dog.</p>';
      const anchor = { sections: ['alpha'], prefix: 'The ', exact: 'quick brown fox', suffix: ' jumps over' };
      const r = window.__htmldocsComments.__anchor.toRange(anchor);
      return r ? r.toString() : null;
    });
    expect(text).toBe('quick brown fox');
  });

  test('ambiguous exact: prefix/suffix disambiguates between occurrences', async ({ page }) => {
    await bootHandle(page);
    const out = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      article.innerHTML = '<h2>Alpha</h2><p>The quick brown fox jumped, but the other fox stayed home.</p>';
      const firstAnchor  = { sections: ['alpha'], prefix: 'quick brown ', exact: 'fox', suffix: ' jumped,' };
      const secondAnchor = { sections: ['alpha'], prefix: 'the other ',   exact: 'fox', suffix: ' stayed home.' };
      const r1 = window.__htmldocsComments.__anchor.toRange(firstAnchor);
      const r2 = window.__htmldocsComments.__anchor.toRange(secondAnchor);
      // Encode each back; if disambiguation worked, encoded anchor's
      // prefix/suffix substrings must contain the input's prefix/suffix.
      const a1 = window.__htmldocsComments.__anchor.fromRange(r1);
      const a2 = window.__htmldocsComments.__anchor.fromRange(r2);
      return {
        firstText:  r1 ? r1.toString() : null,
        secondText: r2 ? r2.toString() : null,
        firstPrefixIncludes:  a1.prefix.includes('quick brown '),
        secondPrefixIncludes: a2.prefix.includes('the other '),
        firstSuffixIncludes:  a1.suffix.includes(' jumped,'),
        secondSuffixIncludes: a2.suffix.includes(' stayed home.'),
      };
    });
    expect(out.firstText).toBe('fox');
    expect(out.secondText).toBe('fox');
    expect(out.firstPrefixIncludes).toBe(true);
    expect(out.secondPrefixIncludes).toBe(true);
    expect(out.firstSuffixIncludes).toBe(true);
    expect(out.secondSuffixIncludes).toBe(true);
  });

  test('disambiguation: identical prefixes, differing suffixes — suffix must be consulted', async ({ page }) => {
    await bootHandle(page);
    const out = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      // Both "foo" candidates share prefix "edge "; only suffix differs.
      // First foo starts at text offset 5; second at 19.
      article.innerHTML = '<p>edge foo near edge foo far</p>';
      const secondAnchor = { sections: ['alpha'], prefix: 'edge ', exact: 'foo', suffix: ' far' };
      const r = window.__htmldocsComments.__anchor.toRange(secondAnchor);
      return {
        text: r ? r.toString() : null,
        startOffset: r ? r.startOffset : null,
      };
    });
    // A prefix-only impl would tie on prefix and pick the FIRST foo at
    // offset 5; only an impl that also consults suffix lands on the
    // SECOND at offset 19.
    expect(out.text).toBe('foo');
    expect(out.startOffset).toBe(19);
  });

  test('disambiguation: identical suffixes, differing prefixes — prefix must be consulted', async ({ page }) => {
    await bootHandle(page);
    const out = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      // Both "foo" candidates share suffix " edge"; only prefix differs.
      // First foo at offset 5; second at 18.
      article.innerHTML = '<p>near foo edge far foo edge</p>';
      const secondAnchor = { sections: ['alpha'], prefix: 'far ', exact: 'foo', suffix: ' edge' };
      const r = window.__htmldocsComments.__anchor.toRange(secondAnchor);
      return {
        text: r ? r.toString() : null,
        startOffset: r ? r.startOffset : null,
      };
    });
    // A suffix-only impl would tie on suffix and pick the FIRST foo at
    // offset 5; only an impl that also consults prefix lands on the
    // SECOND at offset 18.
    expect(out.text).toBe('foo');
    expect(out.startOffset).toBe(18);
  });

  test('element-anchored ranges resolve through inline children (<b>, <span>)', async ({ page }) => {
    await bootHandle(page);
    const out = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      // Range boundaries land on the <p> element (child-index offsets),
      // not on a text node. The selection covers the inline <b>BOLD</b>.
      article.innerHTML = '<p>Before <b>BOLD</b> after</p>';
      const p = article.querySelector('p');
      const r = document.createRange();
      r.setStart(p, 1);   // after the "Before " text node, before <b>
      r.setEnd(p, 2);     // after <b>, before " after"
      const a = window.__htmldocsComments.__anchor.fromRange(r);
      const r2 = window.__htmldocsComments.__anchor.toRange(a);
      return {
        exact: a.exact,
        prefix: a.prefix,
        suffix: a.suffix,
        decoded: r2 ? r2.toString() : null,
      };
    });
    // Element-offset reduction must produce a prefix whose final chars are
    // "Before " and a suffix whose leading chars are " after" — those are
    // the characters immediately adjacent to BOLD inside the article. The
    // 32-char windows extend further into the surrounding doc text (the
    // <h1>, the article wrappers, the next article), so we check the
    // adjacent edges rather than the full window contents. A regression
    // that returned a doc-end offset would produce prefix=last 32 chars
    // of doc text + empty suffix, neither of which would end/start as
    // asserted here.
    expect(out.exact).toBe('BOLD');
    expect(out.prefix.endsWith('Before ')).toBe(true);
    expect(out.suffix.startsWith(' after')).toBe(true);
    expect(out.decoded).toBe('BOLD');
  });

  test('decode returns null when exact text is missing from the doc', async ({ page }) => {
    await bootHandle(page);
    const result = await page.evaluate(() => {
      const anchor = {
        sections: ['alpha'],
        prefix: 'x',
        exact: 'zzz-not-present-in-doc-zzz',
        suffix: 'z',
      };
      const r = window.__htmldocsComments.__anchor.toRange(anchor);
      return r;
    });
    expect(result).toBeNull();
  });

  test('decode ignores sections (metadata-only) and searches full doc', async ({ page }) => {
    // Sections is metadata, never consulted at resolve time. A stale or
    // nonexistent section id with a present exact text still resolves.
    await bootHandle(page);
    const result = await page.evaluate(() => {
      const anchor = {
        sections: ['does-not-exist-anywhere'],
        prefix: 'The ',
        exact: 'quick brown fox',
        suffix: ' jumps over',
      };
      const r = window.__htmldocsComments.__anchor.toRange(anchor);
      return r ? r.toString() : null;
    });
    expect(result).toBe('quick brown fox');
  });

  test('match ending on a collapsed whitespace run covers the full source run', async ({ page }) => {
    await bootHandle(page);
    const out = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      article.innerHTML = '<p>foo   bar</p>';  // three spaces between foo and bar
      const text = article.querySelector('p').firstChild;
      const r1 = document.createRange();
      r1.setStart(text, 0);
      r1.setEnd(text, 6);  // "foo   " — selection ends after the third space
      const a = window.__htmldocsComments.__anchor.fromRange(r1);
      const r2 = window.__htmldocsComments.__anchor.toRange(a);
      return {
        stored: a.exact,
        decoded: r2 ? r2.toString() : null,
      };
    });
    // Without buildNormMap's run-end tracking, the decoded range would end
    // after the FIRST source space, yielding 'foo ' (one trailing space)
    // and mismatching the stored exact.
    expect(out.stored).toBe('foo   ');
    expect(out.decoded).toBe('foo   ');
  });

  test('whitespace-shuffled live DOM still resolves a clean-whitespace anchor', async ({ page }) => {
    await bootHandle(page);
    const text = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      // Live DOM has tabs + newlines around the exact text; stored anchor
      // is clean. Whitespace normalization must collapse runs on both sides.
      article.innerHTML = '<h2>Alpha</h2><p>The   quick\n\tbrown   fox jumps over.</p>';
      const anchor = { sections: ['alpha'], prefix: 'The ', exact: 'quick brown fox', suffix: ' jumps over.' };
      const r = window.__htmldocsComments.__anchor.toRange(anchor);
      return r ? r.toString().replace(/\s+/g, ' ') : null;
    });
    expect(text).toBe('quick brown fox');
  });

  test('boundary: range at section start has a short or empty prefix', async ({ page }) => {
    await bootHandle(page);
    const result = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      article.innerHTML = '<p>Start here right at the beginning of the section text.</p>';
      const text = article.querySelector('p').firstChild;
      const r1 = document.createRange();
      r1.setStart(text, 0);
      r1.setEnd(text, 5);  // "Start"
      const a = window.__htmldocsComments.__anchor.fromRange(r1);
      const r2 = window.__htmldocsComments.__anchor.toRange(a);
      return {
        anchor: a,
        decodedText: r2 ? r2.toString() : null,
      };
    });
    expect(result.anchor.exact).toBe('Start');
    expect(result.anchor.prefix.length).toBeLessThan(32);
    expect(result.decodedText).toBe('Start');
  });

  test('boundary: range at document end has a short or empty suffix', async ({ page }) => {
    // Encoder slices prefix/suffix from full-document text, not the
    // article. To exercise "selection lands at the end of available
    // text," strip every sibling that would otherwise extend the suffix.
    await bootHandle(page);
    const result = await page.evaluate(() => {
      const beta = document.getElementById('beta');
      if (beta) beta.remove();
      const article = document.getElementById('alpha');
      article.innerHTML = '<p>Some text leading up to the final word.</p>';
      const text = article.querySelector('p').firstChild;
      const total = text.data.length;
      const r1 = document.createRange();
      r1.setStart(text, total - 5);   // "word."
      r1.setEnd(text, total);
      const a = window.__htmldocsComments.__anchor.fromRange(r1);
      const r2 = window.__htmldocsComments.__anchor.toRange(a);
      return {
        anchor: a,
        decodedText: r2 ? r2.toString() : null,
      };
    });
    expect(result.anchor.exact).toBe('word.');
    expect(result.anchor.suffix.length).toBeLessThan(32);
    expect(result.decodedText).toBe('word.');
  });

  test('Hypothesis convention: prefix and suffix windows are 32 chars', async ({ page }) => {
    await bootHandle(page);
    const result = await page.evaluate(() => {
      const article = document.getElementById('alpha');
      // Long-enough content on both sides of the target span that 32-char
      // windows are fully populated.
      const longPrefix = 'A'.repeat(80);
      const longSuffix = 'B'.repeat(80);
      article.innerHTML = `<p>${longPrefix}TARGET${longSuffix}</p>`;
      const text = article.querySelector('p').firstChild;
      const r = document.createRange();
      r.setStart(text, 80);
      r.setEnd(text, 86);  // "TARGET"
      const a = window.__htmldocsComments.__anchor.fromRange(r);
      return a;
    });
    expect(result.exact).toBe('TARGET');
    expect(result.prefix.length).toBe(32);
    expect(result.suffix.length).toBe(32);
    expect(result.prefix).toBe('A'.repeat(32));
    expect(result.suffix).toBe('B'.repeat(32));
  });
});
