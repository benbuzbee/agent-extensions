// Playwright helpers for the comments widget over the `?comments` body-op API —
// the ONE transport both runtimes now speak.
//
//   - `thread(fields)` — build one internal Thread seed object from concise
//     fields (the shape the inline seed + GET ?comments response carry).
//   - `seedInline(page, seed)` — inject the inline JSON seed `{ threads }` (the
//     LOCAL path; no author, so main.ts selects the local deps).
//   - `seedInlineHosted(page, seed, author)` — inject `{ threads, author }`; the
//     top-level `author` is the discriminator main.ts uses to auto-select the
//     hosted deps (real GitHub identity).
//   - `interceptComments(page, opts)` — `page.route` on the `?comments` API URL
//     (matched by the query param, NOT a path glob — a glob would also catch the
//     `comments.mjs` bundle) capturing POST op envelopes and serving the body-op
//     API from an in-memory thread store: GET -> {threads}; a single op -> the
//     op's OpResult (200 / op-status); a JSON array -> 207 {results}. Exposes
//     getCalls() (each call records method + url + parsed body) and getThreads().
//
// The seed IS the internal { threads } shape — there is no browser-side legacy
// conversion. The two runtimes differ only in the seed's optional author and in
// which server answers the ?comments API.

/**
 * Build one internal Thread seed object. `resolvedAt` is a numeric epoch-ms
 * Timestamp (null = open); `createdAt` likewise. Anchor optional fields are
 * omitted when empty so the seed mirrors what the store actually emits.
 */
export function thread(fields) {
  const {
    id,
    exact,
    prefix,
    suffix,
    sections,
    body = '',
    author = 'user',
    createdAt = 1000,
    resolvedAt = null,
  } = fields;
  const anchor = { exact };
  if (prefix) anchor.prefix = prefix;
  if (suffix) anchor.suffix = suffix;
  if (sections && sections.length) anchor.sections = sections;
  return {
    id,
    anchor,
    root: { id, author: { login: author, name: null }, body, createdAt },
    replies: [],
    resolvedAt,
  };
}

/**
 * Inject an inline `{ threads }` JSON seed (LOCAL path — no author) before the
 * widget's init() reads it.
 *
 * addInitScript runs before any HTML parsing, so its `DOMContentLoaded`
 * listener is registered first — before the module script's deferred evaluation
 * registers its own DCL listener inside init(). DCL listeners fire in
 * registration order, so our seed-injection runs first, then init()'s
 * awaitDomReady resolves with the seed already in the DOM.
 */
export async function seedInline(page, seed = { threads: [] }) {
  await injectSeed(page, JSON.stringify(seed));
}

/**
 * Inject an inline `{ threads, author }` JSON seed (HOSTED path). The extra
 * top-level `author` is what flips main.ts's chooseDeps to the hosted author.
 * (Specs re-run __init() after load so the selection sees the seed the harness
 * lands on DOMContentLoaded.)
 */
export async function seedInlineHosted(page, seed, author) {
  await injectSeed(page, JSON.stringify({ ...seed, author }));
}

async function injectSeed(page, json) {
  await page.addInitScript((payload) => {
    // Top-frame only. addInitScript runs in every frame; without this guard an
    // embedded iframe would also get the seed and mount a duplicate widget.
    if (window !== window.top) return;
    document.addEventListener('DOMContentLoaded', () => {
      if (document.getElementById('__htmldocs_comments')) return;
      const s = document.createElement('script');
      s.type = 'application/json';
      s.id = '__htmldocs_comments';
      s.textContent = payload;
      document.body.appendChild(s);
    }, { once: true });
  }, json);
}

/**
 * Route-intercept the `?comments` API. Serves the body-op API from an in-memory
 * Map<threadId, Thread>, so a create -> resolve round trip persists across calls
 * within a test. Captures every method + url + parsed body in `getCalls()`.
 */
export async function interceptComments(page, opts = {}) {
  const author = opts.author || { login: 'octocat', name: 'Mona Lisa', id: 7 };
  const threads = new Map(
    (opts.threads || []).map((t) => [t.id, JSON.parse(JSON.stringify(t))]),
  );
  const calls = [];
  let counter = 0;

  // Match by the `?comments` query param, not a URL glob: `**/*comments*` would
  // also intercept the widget bundle request (`dist/comments.mjs`) and serve it
  // JSON, breaking the module load.
  await page.route((url) => url.searchParams.has('comments'), async (route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url()).pathname;

    if (method === 'GET') {
      calls.push({ method, url });
      await fulfillJson(route, 200, { threads: [...threads.values()] });
      return;
    }
    if (method === 'POST') {
      let body = null;
      try { body = JSON.parse(req.postData() || 'null'); } catch { body = null; }
      calls.push({ method, url, body });
      if (Array.isArray(body)) {
        await fulfillJson(route, 207, { results: body.map(applyOp) });
        return;
      }
      const result = applyOp(body);
      await fulfillJson(route, result.ok ? 200 : statusFor(result.error), result);
      return;
    }
    await fulfillJson(route, 405, { error: 'method not allowed' });
  });

  function applyOp(op) {
    switch (op && op.op) {
      case 'create': {
        const id = `h-${++counter}`;
        const t = {
          id,
          anchor: op.anchor,
          root: { id, author, body: op.text, createdAt: 1000 },
          replies: [],
          resolvedAt: null,
        };
        threads.set(id, t);
        return { ok: true, op: 'create', thread: t };
      }
      case 'resolve': {
        const t = threads.get(op.threadId);
        if (!t) return { ok: false, op: 'resolve', error: { code: 'not_found', threadId: op.threadId } };
        t.resolvedAt = t.resolvedAt ?? 2000;
        return { ok: true, op: 'resolve', thread: t };
      }
      case 'reopen': {
        const t = threads.get(op.threadId);
        if (!t) return { ok: false, op: 'reopen', error: { code: 'not_found', threadId: op.threadId } };
        t.resolvedAt = null;
        return { ok: true, op: 'reopen', thread: t };
      }
      case 'delete': {
        if (!threads.has(op.threadId)) return { ok: false, op: 'delete', error: { code: 'not_found', threadId: op.threadId } };
        threads.delete(op.threadId);
        return { ok: true, op: 'delete', threadId: op.threadId };
      }
      default:
        return { ok: false, op: op && op.op, error: { code: 'transient', message: 'op not yet supported' } };
    }
  }

  function statusFor(error) {
    return error.code === 'not_found' || error.code === 'no_access' ? 404 : 500;
  }

  return {
    getCalls: () => calls.slice(),
    getThreads: () => [...threads.values()].map((t) => JSON.parse(JSON.stringify(t))),
    /** Replace the route with one that fails every subsequent POST with a 500
     * (no restore — failure mode persists until the page navigates away). Used
     * to exercise the widget's transient-failure / rollback path. */
    breakWrites: async () => {
      await page.unroute((url) => url.searchParams.has('comments'));
      await page.route((url) => url.searchParams.has('comments'), async (route) => {
        if (route.request().method() === 'POST') {
          await fulfillJson(route, 500, { ok: false, op: 'create', error: { code: 'transient', message: 'simulated write failure 500' } });
          return;
        }
        await fulfillJson(route, 200, { threads: [...threads.values()] });
      });
    },
  };
}

async function fulfillJson(route, status, obj) {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(obj),
  });
}
