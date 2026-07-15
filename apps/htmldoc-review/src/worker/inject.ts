// Hosted widget injection — the REAL HTMLRewriter placement (the skill's
// adapters/hosted/inject.ts is a documentation stub; HTMLRewriter is a Worker
// global the skill can't type or test, so the injector lives here, mirroring
// the D1Store placement). It imports the SHARED markup helper, so the fragment
// it appends is byte-identical to the one local serve.ts string-splices.

import { injectionFragment } from "@shared/review-ux/inject";
import { threadToLegacy } from "@shared/review-ux/types";
import type { CommentsModel, Thread, Author } from "@shared/review-ux/types";
// The checked-in widget bundle — a byte-for-byte copy of the skill's
// dist/comments.mjs (refresh with `npm run sync:widget`; a core test enforces
// equality). The `.txt` extension makes Wrangler import it as a string via its
// DEFAULT Text-module rule (no wrangler.toml [[rules]] entry — see
// modules.d.ts). index.ts serves these bytes at COMMENTS_WIDGET_SRC.
import widgetBundle from "./comments.mjs.txt";

// The widget bundle path the injected <script> points at is the SHARED
// COMMENTS_WIDGET_SRC (WIDGET_BASE + "/comments.mjs"), re-exported so this
// Worker and the local server can never point at different paths. The hosted
// Worker serves it PUBLICLY here (serveWidgetBundle): it is doc-independent
// generic JS, registered before any doc parsing/auth, so it cannot leak a
// doc's existence. WIDGET_BASE is a reserved namespace prefix (mirrors the
// local /__htmldocs/sidecar route), so a repo literally named __htmldocs is
// shadowed here by design.
export { COMMENTS_WIDGET_SRC } from "@shared/review-ux/inject";

/**
 * Serve the checked-in widget bundle at COMMENTS_WIDGET_SRC. PUBLIC by design: the bytes
 * are constant, doc-independent generic JS with no secret, so requiring a session
 * would only 302 a `<script src>` to a login page and break the module load. The
 * caller (index.ts) dispatches here as the FIRST thing in fetch — before token
 * resolution and before parseDocRequest/checkAccess — so this route never probes
 * GitHub and never touches the neutral-404 non-leak path.
 *
 * GET/HEAD -> 200 the bundle string (application/javascript; no-cache, since
 * COMMENTS_WIDGET_SRC is unversioned and a stale cache would serve an old widget after a
 * redeploy). Any other method -> 405.
 */
export function serveWidgetBundle(req: Request): Response {
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(method === "HEAD" ? null : widgetBundle, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * Build the inline JSON seed model from a doc's threads. Carries BOTH open and
 * resolved threads (threadToLegacy stamps `resolved_at` only on a resolved
 * thread, so resolve state — the green-but-still-visible indicator — survives
 * into the seed and across reloads). `docLabel` is a display label for the seed.
 */
export function buildSeedModel(threads: Thread[], docLabel: string): CommentsModel {
  const comments = threads.flatMap((t) => threadToLegacy(t));
  return { doc: docLabel, schema: 1, comments };
}

/**
 * Wrap a doc Response in HTMLRewriter and append the shared injection fragment
 * (seed + widget script tag) as ONE unit inside <body>. The caller gates this to
 * 200 text/html doc responses only; a body-less or non-HTML response streams
 * through untouched (HTMLRewriter appends only when it actually sees a <body>),
 * and the neutral-404 / access-denied path never reaches this function.
 */
export function injectWidget(
  res: Response,
  model: CommentsModel,
  src: string,
  author?: Author,
): Response {
  const fragment = injectionFragment(model, src, author);
  return new HTMLRewriter()
    .on("body", {
      element(el) {
        el.append(fragment, { html: true });
      },
    })
    .transform(res);
}
