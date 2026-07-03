// Shared injection helpers — pure functions producing the markup strings both
// runtimes inject. Adapters own only PLACEMENT (string-splice vs HTMLRewriter);
// escaping and element-id contracts live here.

import type { Thread, Author } from './types';

/** URL base every htmldocs widget asset lives under, in both runtimes. */
export const WIDGET_BASE = '/__htmldocs';

/** The comments widget bundle URL — the src the injected <script> points at. */
export const COMMENTS_WIDGET_SRC = `${WIDGET_BASE}/comments.mjs`;

/**
 * Produce the inline JSON seed `<script>` tag. The seed is the internal
 * `{ threads }` view (the same payload the GET ?comments response carries), so
 * no legacy conversion ever runs browser-side. Escapes each `<` as the JSON
 * unicode escape `\u003c` (not an HTML entity like &lt;) so a `</script>`
 * inside a comment body can't break out of the JSON block.
 *
 * `author` is OPTIONAL. When omitted the seed is `{ threads }` (the local path,
 * which never stamps an author). The hosted Worker supplies the captured
 * session author, merged as a top-level field — the discriminator main.ts uses
 * to select the deps (both runtimes build the same store; only the author
 * differs).
 */
export function seedJsonScript(threads: Thread[], author?: Author): string {
  const seed = author === undefined ? { threads } : { threads, author };
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
export function injectionFragment(threads: Thread[], src: string, author?: Author): string {
  return seedJsonScript(threads, author) + '\n' + widgetScriptTag(src) + '\n';
}
