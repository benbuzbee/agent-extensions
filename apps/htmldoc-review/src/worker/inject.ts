// Hosted widget injection — the REAL HTMLRewriter placement (the skill's
// adapters/hosted/inject.ts is a documentation stub; HTMLRewriter is a Worker
// global the skill can't type or test, so the injector lives here, mirroring
// PR3's D1Store placement). It imports the SHARED markup helper through the
// comments-seam (a vendored copy of review-ux/inject.ts), so the fragment it
// appends is byte-identical to the one local serve.ts string-splices.

import { injectionFragment, threadToLegacy } from "../core/comments-seam";
import type { CommentsModel, Thread, Author } from "../core/comments-seam";

// The widget bundle path the injected <script> points at. Placeholder for now:
// actually serving that bundle over the hosted Worker (plus the hosted browser
// HTTP store and main.ts runtime selection) is a DEFERRED, human-in-the-loop
// follow-up. PR6 locks and tests only the injected markup contract.
export const WIDGET_SRC = "/__htmldocs/comments.mjs";

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
