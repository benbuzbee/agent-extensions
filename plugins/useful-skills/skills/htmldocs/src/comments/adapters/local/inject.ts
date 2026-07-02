// PLACEMENT ONLY. Imports shared helpers and places the strings before </body>.
// Contains NO escaping logic and NO markup string construction.

import { seedJsonScript, widgetScriptTag } from '../../review-ux/inject';
import type { CommentsModel } from '../../review-ux/types';

/**
 * Inject the comment widget into an HTML string by splicing the seed JSON
 * and widget script tag before </body>. Delegates entirely to the shared
 * injection helpers for markup production.
 */
export function injectIntoHtml(html: string, model: CommentsModel): string {
  const blocks = (
    seedJsonScript(model) + '\n' +
    widgetScriptTag('/__htmldocs/comments.mjs') + '\n'
  );
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + '\n' + blocks;
  return html.slice(0, idx) + blocks + html.slice(idx);
}
