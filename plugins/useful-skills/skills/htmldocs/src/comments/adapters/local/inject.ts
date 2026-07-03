// PLACEMENT ONLY. Delegates markup production to the shared injectionFragment
// helper and places the result before </body>. Contains NO escaping logic and
// NO markup string construction — the local seed carries no author, so its
// output stays byte-identical to Deliverable 1.

import { injectionFragment } from '../../review-ux/inject';
import type { CommentsModel } from '../../review-ux/types';

/**
 * Inject the comment widget into an HTML string by splicing the shared
 * injection fragment (seed JSON + widget script tag) before </body>.
 */
export function injectIntoHtml(html: string, model: CommentsModel): string {
  const blocks = injectionFragment(model, '/__htmldocs/comments.mjs');
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + '\n' + blocks;
  return html.slice(0, idx) + blocks + html.slice(idx);
}
