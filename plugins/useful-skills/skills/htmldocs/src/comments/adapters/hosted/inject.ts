// Stub — HTMLRewriter injection placement for the hosted Worker.
// Documents the pattern; imports shared helpers. No implementation yet.

import { seedJsonScript, widgetScriptTag } from '../../review-ux/inject';
import type { CommentsModel } from '../../review-ux/types';

// The hosted injector uses HTMLRewriter to append inside <body> on 200 HTML:
//
//   new HTMLRewriter()
//     .on('body', { element(el) {
//       el.append(seedJsonScript(model), { html: true });
//       el.append(widgetScriptTag(hostedScriptSrc), { html: true });
//     }})
//     .transform(docResponse)
//
// The neutral-404 path is untouched (no widget, no leak).

// TODO: Implement in PR6. Export a function that wraps a Response with
// HTMLRewriter, calling the shared helpers with the hosted script src.

// Keep these imports used so TS doesn't strip them:
void seedJsonScript;
void widgetScriptTag;
export type HostedModel = CommentsModel;
