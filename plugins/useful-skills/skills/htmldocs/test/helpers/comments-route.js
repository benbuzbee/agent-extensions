// Playwright helpers for the HOSTED comments widget — the analogues of
// sidecar-route.js for the Worker `?comments` body-op API.
//
//   - `seedInlineHosted(page, model, author)` — inject the inline JSON seed WITH
//     a top-level `author`, the discriminator main.ts uses to auto-select the
//     hosted adapter (HostedStore over ?comments) instead of the local one.
//   - `interceptComments(page, opts)` — `page.route` on the `?comments` API URL
//     (matched by the query param, NOT a path glob — a glob would also catch the
//     `comments.mjs` bundle) capturing POST op envelopes and serving the body-op
//     API from an in-memory thread
//     store: GET -> {threads}; a single op -> the op's OpResult (200 / op-status);
//     a JSON array -> 207 {results}. Exposes getCalls()/getThreads().
//
// The hosted seed carries the internal thread model on the wire via the same
// legacy CommentsModel shape the local seed uses, so the widget paints
// identically; only the transport (fetch to ?comments) differs.

/**
 * Inject an inline JSON seed with a top-level `author` before the widget reads
 * it. Same DCL-ordered timing as seedInline; the extra `author` field is what
 * flips main.ts's chooseDeps to the hosted store. (Specs re-run __init() after
 * load so the selection sees the seed the harness lands on DOMContentLoaded.)
 */
export async function seedInlineHosted(page, model, author) {
  const json = JSON.stringify({ ...model, author });
  await page.addInitScript((payload) => {
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
 * Route-intercept `**​/*comments*`. Serves the body-op API from an in-memory
 * Map<threadId, Thread>, so a create -> resolve round trip persists across calls
 * within a test. Captures every method + parsed body in `getCalls()`.
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

    if (method === 'GET') {
      calls.push({ method });
      await fulfillJson(route, 200, { threads: [...threads.values()] });
      return;
    }
    if (method === 'POST') {
      let body = null;
      try { body = JSON.parse(req.postData() || 'null'); } catch { body = null; }
      calls.push({ method, body });
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
        const thread = {
          id,
          anchor: op.anchor,
          root: { id, author, body: op.text, createdAt: 1000 },
          replies: [],
          resolvedAt: null,
        };
        threads.set(id, thread);
        return { ok: true, op: 'create', thread };
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
  };
}

async function fulfillJson(route, status, obj) {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(obj),
  });
}
