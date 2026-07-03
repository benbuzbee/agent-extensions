// Shared injection helpers — pure functions producing the markup strings both
// runtimes inject. Adapters own only PLACEMENT (string-splice vs HTMLRewriter);
// escaping and element-id contracts live here.

import type { CommentsModel, Author } from './types';

/**
 * Produce the inline JSON seed `<script>` tag. Escapes each `<` as the JSON
 * unicode escape `\u003c` (not an HTML entity like &lt;) so a `</script>`
 * inside a comment body can't break out of the JSON block.
 *
 * `author` is OPTIONAL. When omitted the emitted seed is byte-identical to the
 * Deliverable 1 output (local injection passes nothing, so the local seed is
 * unchanged). The hosted Worker supplies the captured session author, merged as
 * an extra top-level field for a future MountDeps — the widget's `isWellShaped`
 * check tolerates extra fields, so this is backward-compatible.
 */
export function seedJsonScript(model: CommentsModel, author?: Author): string {
  const seed = author === undefined ? model : { ...model, author };
  const json = JSON.stringify(seed).replace(/</g, '\\u003c');
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

/**
 * The ONE shared fragment both runtimes place as a single unit: the JSON seed
 * followed by the widget script tag. Local `serve.ts` string-splices this before
 * `</body>`; the hosted Worker `append`s it inside `<body>` as one HTMLRewriter
 * unit. Centralizing the fragment here guarantees the two runtimes emit
 * byte-identical markup by construction — neither hand-rolls the tags or the
 * whitespace between them.
 */
export function injectionFragment(model: CommentsModel, src: string, author?: Author): string {
  return seedJsonScript(model, author) + '\n' + widgetScriptTag(src) + '\n';
}
