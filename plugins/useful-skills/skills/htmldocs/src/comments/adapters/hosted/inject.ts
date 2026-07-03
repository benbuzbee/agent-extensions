// Stub — documentation only. The REAL hosted injector lives in the Worker app
// at apps/htmldoc-review/src/worker/inject.ts, NOT here.
//
// Why there and not here: HTMLRewriter is a Cloudflare Worker global the skill
// package has no types for and cannot unit-test, so the injector that wraps a
// doc Response and appends inside <body> must live in the app (mirroring PR3's
// D1Store placement). It imports the shared markup helper through the app's
// comments-seam (a vendored copy of review-ux/inject.ts).
//
// The contract both runtimes honor: place the SINGLE shared fragment,
//   injectionFragment(model, src, author?)   // review-ux/inject.ts
// as one unit — local string-splices it before </body>; hosted appends it in ONE
// HTMLRewriter el.append(fragment, { html: true }) on <body>, on a 200 text/html
// doc response only. The neutral-404 path is untouched (no widget, no seed, no
// leak). Neither runtime hand-rolls the tags, so the emitted markup is
// byte-identical by construction.

import { injectionFragment } from '../../review-ux/inject';
import type { CommentsModel } from '../../review-ux/types';

// Keep the import used so this stub compiles under the skill's typecheck; the
// real placement is apps/htmldoc-review/src/worker/inject.ts.
void injectionFragment;
export type HostedModel = CommentsModel;
