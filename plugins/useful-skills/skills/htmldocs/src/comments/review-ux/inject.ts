// Shared injection helpers — pure functions producing the markup strings both
// runtimes inject. Adapters own only PLACEMENT (string-splice vs HTMLRewriter);
// escaping and element-id contracts live here.

import type { CommentsModel } from './types';

/**
 * Produce the inline JSON seed `<script>` tag. Escapes each `<` as the JSON
 * unicode escape `\u003c` (not an HTML entity like &lt;) so a `</script>`
 * inside a comment body can't break out of the JSON block.
 */
export function seedJsonScript(model: CommentsModel): string {
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  return '<script type="application/json" id="__htmldocs_comments">' + json + '</script>';
}

/**
 * Produce the widget module `<script>` tag. Parameterized by `src` so each
 * adapter passes its own path:
 *   local:  "/__htmldocs/comments.mjs"
 *   hosted: a CDN or worker-relative path
 */
export function widgetScriptTag(src: string): string {
  return `<script type="module" src="${src}"></script>`;
}
