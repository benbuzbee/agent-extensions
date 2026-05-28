// HttpSidecarStore — sidecar I/O over the localhost review server.
//
// The widget no longer touches the File System Access API. Initial state is
// seeded from an inline `<script type="application/json" id="__htmldocs_comments">`
// block the server injects on every HTML response; saves PUT the full
// CommentsModel to `/__htmldocs/sidecar/<doc-path>` where <doc-path> is the
// page's location.pathname under the served root. Wire format and on-disk
// format are the same JSON.
//
// The class is the public surface; tests instantiate it directly via the
// __HttpSidecarStore field on the test handle when they want to exercise
// load/save without driving the whole widget.

import type { CommentsModel } from './types';

const SCHEMA_VERSION = 1 as const;
const SIDECAR_URL_PREFIX = '/__htmldocs/sidecar';
const SEED_ELEMENT_ID = '__htmldocs_comments';

// Build the PUT URL for the page hosting the widget. location.pathname is
// '/foo.html', '/sub/bar.html', or '/' / '/sub/' for directory-index URLs;
// the server rewrites directory requests to /index.html, so we mirror that
// here so the sidecar lands next to the right file on disk. The server also
// strips a trailing slash from file URLs ('/foo.html/' → '/foo.html'); we
// mirror that too so the client URL agrees with what the server resolves.
function sidecarUrlForCurrentDoc(): string {
  let pathname = location.pathname;
  if (pathname.endsWith('/')) {
    const trimmed = pathname.slice(0, -1);
    const lastSeg = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    pathname = /\.html?$/i.test(lastSeg) ? trimmed : pathname + 'index.html';
  }
  // pathname is already %-encoded; PUT URL keeps the same shape.
  return SIDECAR_URL_PREFIX + pathname;
}

function emptyModel(basename: string): CommentsModel {
  return { doc: basename, schema: SCHEMA_VERSION, comments: [] };
}

// Shape check matching the server's `isWellShapedModel` (serve.ts). Deep
// enough that a malformed seed (hand-edited sidecar, future-schema upgrade
// mid-flight) is rejected before rebuildHighlights tries to dereference
// anchor fields on null. Both ends of the wire validate the same way.
function isWellShapedComment(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  if (typeof x.id !== 'string' || typeof x.body !== 'string') return false;
  if (typeof x.author !== 'string' || typeof x.created_at !== 'string') return false;
  if (!x.anchor || typeof x.anchor !== 'object') return false;
  const a = x.anchor as Record<string, unknown>;
  if (!Array.isArray(a.sections) || !a.sections.every((s) => typeof s === 'string')) return false;
  return typeof a.prefix === 'string'
    && typeof a.exact === 'string' && typeof a.suffix === 'string';
}

function isWellShaped(parsed: unknown): parsed is CommentsModel {
  if (!parsed || typeof parsed !== 'object') return false;
  const m = parsed as Partial<CommentsModel>;
  if (typeof m.doc !== 'string' || m.schema !== 1 || !Array.isArray(m.comments)) return false;
  return m.comments.every(isWellShapedComment);
}

/**
 * Load + save the sidecar over HTTP. `load(basename)` parses the inline JSON
 * seed the server injected; `save(basename, model)` PUTs the full model back.
 * `basename` is used only to label the empty-model fallback — the server
 * knows its single sidecar target at startup, so the URL never varies.
 */
export class HttpSidecarStore {
  /**
   * Read the inline JSON seed block and return its parsed CommentsModel.
   * Returns an empty model when the seed is missing, blank, malformed, or
   * not well-shaped — same "don't crash on junk" stance as the v1 store.
   * Synchronous-friendly but typed Promise to match the SidecarStore
   * signature the rest of the widget already expects.
   */
  async load(basename: string): Promise<CommentsModel> {
    const node = document.getElementById(SEED_ELEMENT_ID);
    if (!node) return emptyModel(basename);
    const text = node.textContent || '';
    if (!text.trim()) return emptyModel(basename);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return emptyModel(basename);
    }
    if (!isWellShaped(parsed)) return emptyModel(basename);
    return parsed;
  }

  /**
   * PUT `model` to `/__htmldocs/sidecar/<doc-path>`. The doc path is derived
   * from `location.pathname` so the server can route the write to the right
   * sidecar without needing per-request configuration. Throws on any non-2xx
   * response so saveAnchoredComment's rollback logic can react. `basename`
   * is accepted for signature parity with v1 but unused.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async save(_basename: string, model: CommentsModel): Promise<void> {
    const url = sidecarUrlForCurrentDoc();
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(model, null, 2) + '\n',
    });
    if (!res.ok) {
      throw new Error(`HttpSidecarStore: PUT ${url} → ${res.status}`);
    }
  }

  /** `foo.html` → `foo.comments.json`. Case-insensitive on .html / .htm. */
  static filename(basename: string): string {
    return basename.replace(/\.html?$/i, '') + '.comments.json';
  }
}
