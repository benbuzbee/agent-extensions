// PLACEMENT ONLY. Delegates markup production to the shared injectionFragment
// helper and places the result before </body>. Contains NO escaping logic and
// NO markup string construction — the local seed carries no author, so its
// output is the plain { threads } seed.

import { injectionFragment, COMMENTS_WIDGET_SRC } from '../../review-ux/inject';
import type { Thread } from '../../review-ux/types';

/**
 * Inject the comment widget into an HTML string by splicing the shared
 * injection fragment (seed JSON of this doc's threads + widget script tag)
 * before </body>.
 */
export function injectIntoHtml(html: string, threads: Thread[]): string {
  const blocks = injectionFragment(threads, COMMENTS_WIDGET_SRC);
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + '\n' + blocks;
  return html.slice(0, idx) + blocks + html.slice(idx);
}
