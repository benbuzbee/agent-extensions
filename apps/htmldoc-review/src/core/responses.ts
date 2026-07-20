// Shared response builders for the portable core.
//
// These live in core/ (not worker/) because they are pure, dependency-free
// `Response` constructors — no Worker bindings, no KV, no env. Keeping them
// here lets core/docsource.ts and the Worker entrypoint share one source of
// truth without dragging a Worker-only import into the portable layer.

/**
 * The single "neutral" 404 used whenever a doc is missing OR the viewer lacks
 * access. We deliberately collapse "not found" and "forbidden" into one
 * indistinguishable response: revealing which one applies would leak the
 * existence of private repos/paths to viewers who cannot see them. Any caller
 * that wants to deny access without leaking should return exactly this.
 */
export function neutral(): Response {
  return new Response("Not found or no access", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * 401 for a comments request that arrived with NO credential (no session
 * cookie, no bearer). Distinct from the neutral 404 on purpose: it is uniform
 * across every doc path and returned BEFORE the access probe, so it leaks
 * nothing about whether a doc exists — it only tells the widget/agent "you must
 * authenticate". A credential-less DOC request still 302s to login (browser
 * flow); this JSON 401 is for the API surface, which has no browser to redirect.
 */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "authentication required" }), {
    status: 401,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Friendly confirmation shown after the GitHub App is *installed* on the org.
 *
 * Because the App is created with `request_oauth_on_install`, GitHub redirects
 * the post-install browser to the App's first callback URL (our `/auth/callback`)
 * carrying `installation_id` + `setup_action` — but NOT through our `/auth/login`,
 * so there is no signed state cookie. That request would otherwise trip the CSRF
 * guard in `completeLogin` and show a scary "Invalid OAuth state" error to an
 * admin who just did everything right. The dispatch layer detects the install
 * shape and returns this instead. We deliberately do NOT exchange the `code`
 * here (no state to verify against); the normal login 302 dance runs invisibly
 * the first time they open a doc.
 */
export function setupComplete(): Response {
  const body = `
  <p class="ok">&#10003; htmldoc-review is installed.</p>
  <p>You're all set. Open any doc you have access to on GitHub:</p>
  <p class="muted"><code>https://&lt;this-host&gt;/&lt;repo&gt;/&lt;path-to-doc&gt;.html</code></p>
  <p class="muted">You'll be asked to sign in with GitHub the first time. You can close this tab.</p>`;
  return htmlPage("htmldoc-review installed", body, { status: 200 });
}

/**
 * The route path that serves `loginFailed` (mounted by the Worker's dispatch).
 * Lives here, next to the page it names, so core (completeLogin's redirect)
 * and the Worker's route switch share one definition.
 */
export const LOGIN_ERROR_PATH = "/auth/error";

/**
 * The retry page behind LOGIN_ERROR_PATH, reached when the login-time GET
 * /user fails after a successful code exchange.
 *
 * Identity capture is fatal to a login (completeLogin, oauth.ts): a session is
 * never minted without knowing who it belongs to, so the failed attempt
 * persisted NOTHING — no session record, no session cookie — and the retry
 * link is a clean re-entry through /auth/login. (A session that existed before
 * the attempt is untouched, so the copy speaks only about this attempt.)
 * completeLogin 303s here rather than rendering on the callback URL, whose
 * code/state are spent — a refresh of this page just re-renders it. 502
 * because the failure is GitHub's API misbehaving upstream of this proxy, not
 * an operator error (500) or planned unavailability (503).
 *
 * `returnPath` must already be sanitized to a same-origin absolute path by the
 * caller. encodeURIComponent round-trips it through the retry link and
 * percent-encodes every double-quote-context metacharacter (`"` `<` `>` `&`),
 * making it inert inside the DOUBLE-quoted href below; it does NOT encode
 * single quotes, so the attribute must stay double-quoted.
 */
export function loginFailed(returnPath: string): Response {
  const retryHref = `/auth/login?return=${encodeURIComponent(returnPath)}`;
  const body = `
  <p class="err">&#10007; Sign-in didn't finish.</p>
  <p>GitHub authorized you, but fetching your GitHub profile failed, so we stopped.
     Nothing was saved &mdash; this attempt didn't change whether you're signed in.</p>
  <p><a href="${retryHref}">Try signing in again</a> &mdash; you'll continue to the
     page you were opening.</p>
  <p class="muted">If this keeps happening, GitHub's API may be having trouble; wait a
     minute and retry.</p>`;
  return htmlPage("htmldoc-review sign-in failed", body, {
    status: 502,
    // The page embeds a per-user return path; never cache it.
    headers: { "Cache-Control": "no-store" },
  });
}

// The one page shell shared by every human-facing HTML response above, so the
// chrome (charset, viewport, styles) can't drift between pages. `bodyHtml` is
// trusted template text authored in this file — callers interpolate ONLY
// pre-encoded values into it.
function htmlPage(
  title: string,
  bodyHtml: string,
  init: { status: number; headers?: Record<string, string> }
): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 34rem;
           margin: 4rem auto; padding: 0 1.25rem; line-height: 1.5; color: #1a1a1a; }
    .ok, .err { font-size: 1.5rem; font-weight: 600; }
    code { background: #f2f2f2; padding: 0.1rem 0.35rem; border-radius: 4px; }
    .muted { color: #555; }
  </style>
</head>
<body>${bodyHtml}
</body>
</html>`;
  return new Response(body, {
    status: init.status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}
