// Highlight registration + stylesheet for the CSS Custom Highlight API.
// Extracted from main.ts. Includes resolved-state highlight style.

export const HIGHLIGHT_NAME = 'htmldocs-cmt';

export const HIGHLIGHT_STYLES = `
::highlight(htmldocs-cmt) {
  background: rgba(255, 213, 0, .35);
  color: inherit;
}
@media (prefers-color-scheme: dark) {
  ::highlight(htmldocs-cmt) {
    background: rgba(255, 213, 0, .25);
  }
}
.htmldocs-cmt-resolved {
  background: rgba(76, 175, 80, .2);
}
@media (prefers-color-scheme: dark) {
  .htmldocs-cmt-resolved {
    background: rgba(76, 175, 80, .15);
  }
}
`;

// Lazily constructed shared highlight stylesheet. Re-adopted into
// `document.adoptedStyleSheets` if removed (e.g. by a test).
let highlightStylesheet: CSSStyleSheet | null = null;

export function ensureHighlightStyles(): void {
  if (!highlightStylesheet) {
    highlightStylesheet = new CSSStyleSheet();
    highlightStylesheet.replaceSync(HIGHLIGHT_STYLES);
  }
  if (!document.adoptedStyleSheets.includes(highlightStylesheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightStylesheet];
  }
}
