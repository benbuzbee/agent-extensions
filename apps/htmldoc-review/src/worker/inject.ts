// Hosted widget injection — the REAL HTMLRewriter placement (the skill's
// adapters/hosted/inject.ts is a documentation stub; HTMLRewriter is a Worker
// global the skill can't type or test, so the injector lives here, mirroring
// the D1Store placement). It imports the SHARED markup helper, so the fragment
// it appends is byte-identical to the one local serve.ts string-splices.

import { injectionFragment } from "@shared/review-ux/inject";
import { threadToLegacy } from "@shared/review-ux/types";
import type { CommentsModel, Thread, Author } from "@shared/review-ux/types";

// The widget bundle path the injected <script> points at is the SHARED
// COMMENTS_WIDGET_SRC (WIDGET_BASE + "/comments.mjs"), re-exported so this
// Worker and the local server can never point at different paths. Actually
// serving that bundle over the hosted Worker (plus the hosted browser HTTP
// store and main.ts runtime selection) is a DEFERRED, human-in-the-loop
// follow-up. This layer locks and tests only the injected markup contract.
export { COMMENTS_WIDGET_SRC } from "@shared/review-ux/inject";

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
