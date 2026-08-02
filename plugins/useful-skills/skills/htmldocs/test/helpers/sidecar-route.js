// Playwright helpers for the HTTP-backed comments widget.
//
// The widget no longer accepts an injected directory handle — it reads its
// initial state from an inline `<script type="application/json" id="__htmldocs_comments">`
// block and writes back via `PUT /__htmldocs/sidecar`. These helpers:
//
//   - `seedInline(page, model)` — inject the inline JSON seed BEFORE the
//     deferred module script runs, so the first init() pass picks it up
//     without needing to call `__init()` again.
//   - `interceptSidecar(page, { initial })` — Playwright `page.route`
//     handler on `**/__htmldocs/sidecar` capturing PUT bodies and serving
//     GET stubs from an in-memory state. Returns getters for the state and
//     the recorded call log.
//
// Specs typically use both: `seedInline` for pre-existing comments, then
// `interceptSidecar` to catch saves the widget makes during the test.

/**
 * Inject an inline JSON seed before the widget's init() reads it.
 *
 * addInitScript runs before any HTML parsing, so its `DOMContentLoaded`
 * listener is registered first — before the module script's deferred
 * evaluation registers its own DCL listener inside init(). DCL listeners
 * fire in registration order, so our seed-injection runs first, then
 * init()'s awaitDomReady resolves with the seed already in the DOM.
 */
export async function seedInline(page, model) {
  const json = JSON.stringify(model);
  await page.addInitScript((payload) => {
    // Top-frame only. addInitScript runs in every frame; without this guard
    // an embedded iframe in a future fixture would also get the seed and
    // try to mount a duplicate widget keyed to the same id.
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
 * Route-intercept `**​/__htmldocs/sidecar/**`. PUT bodies update an in-memory
 * state record keyed by the doc path in the URL (so multi-doc tests can
 * inspect each doc's writes separately); GET stubs return 200 with an empty
 * body since the live server doesn't expose a GET for sidecars (state is
 * seeded via `seedInline`). The returned object exposes `getState()` for
 * the most recent PUT body and `getCalls()` for the full method/body log
 * including the doc path each PUT targeted.
 */
export async function interceptSidecar(page, opts = {}) {
  const { initial = null, basename = 'index.html' } = opts;
  let state = initial ? JSON.parse(JSON.stringify(initial)) : null;
  const calls = [];

  await install();

  return {
    getState: () => (state ? JSON.parse(JSON.stringify(state)) : null),
    getCalls: () => calls.slice(),
    /** Replace the route with one that fails every subsequent PUT with a
     * 500 (no restore — failure mode persists until the page navigates
     * away). Used to exercise the widget's rollback path. */
    breakWrites: async () => {
      await page.unroute('**/__htmldocs/sidecar/**');
      await page.route('**/__htmldocs/sidecar/**', async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({ status: 500, body: 'simulated write failure' });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(state || { doc: basename, schema: 1, comments: [] }),
        });
      });
    },
    /** Restore normal PUT-capturing behavior after `breakWrites`, so a test
     * can exercise a failed save followed by a successful one. */
    restoreWrites: async () => {
      await page.unroute('**/__htmldocs/sidecar/**');
      await install();
    },
  };

  async function install() {
    await page.route('**/__htmldocs/sidecar/**', async (route) => {
      const req = route.request();
      const method = req.method();
      const url = req.url();
      const idx = url.indexOf('/__htmldocs/sidecar/');
      const docPath = idx >= 0 ? url.slice(idx + '/__htmldocs/sidecar/'.length) : '';
      if (method === 'PUT') {
        let body = null;
        try { body = JSON.parse(req.postData() || 'null'); } catch (err) { body = { __parseError: String(err) }; }
        calls.push({ method, docPath, body });
        state = body;
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      if (method === 'GET') {
        calls.push({ method, docPath });
        const payload = state || { doc: basename, schema: 1, comments: [] };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(payload),
        });
        return;
      }
      await route.fulfill({ status: 405, body: 'method not allowed' });
    });
  }
}
