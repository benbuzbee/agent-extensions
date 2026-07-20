// serve.ts — multi-doc review-mode HTTP server.
//
// CLI runtime entry (via `node dist/serve.mjs`, normally exec'd from serve.sh).
// Also exports `createServer` and `startReviewServer` for in-process callers
// — the Playwright specs use these directly so the test boundary stops being
// "spawn a child + parse stdout" and starts being "call a function."
//
// Behavior shipped in docs/plans/no_copies.html: sidecars live under a
// server-chosen directory (auto-tmp by default, pinned via `--sidecar-dir`),
// mirroring each doc's path under --root. The served tree itself stays
// untouched.

import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { CommentsModel, LegacyComment, Author, DocKey } from './review-ux/types.js';
import { injectIntoHtml } from './adapters/local/inject.js';
import { COMMENTS_WIDGET_SRC } from './review-ux/inject.js';
import { handleCommentsRequest } from './api/index.js';
import { SidecarStore } from './adapters/local/sidecar-store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = path.join(HERE, 'comments.mjs');
const SIDECAR_URL_PREFIX = '/__htmldocs/sidecar/';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

// --- path helpers ---------------------------------------------------------

// "Is child under root?" — returns the relative path if yes (root-equal
// returns '' which is also under root), null if it escapes via `..` or an
// absolute crossing. The single source of truth for traversal safety;
// `resolveUnderRoot` and `sidecarPathFor` both go through here.
function relativeUnderRoot(root: string, child: string): string | null {
  const rel = path.relative(root, child);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

function stripQueryHash(url: string): string {
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  let end = url.length;
  if (q !== -1) end = Math.min(end, q);
  if (h !== -1) end = Math.min(end, h);
  return url.slice(0, end);
}

// Resolve a URL path against the served root, refusing any escape.
function resolveUnderRoot(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(stripQueryHash(urlPath));
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalized = path.normalize(decoded);
  const joined = path.resolve(root, '.' + normalized);
  return relativeUnderRoot(root, joined) === null ? null : joined;
}

// `<root>/foo.html` → `<sidecarDir>/foo.comments.json`; `<root>/sub/bar.html`
// → `<sidecarDir>/sub/bar.comments.json`. Callers must pass an htmlPath
// already validated under `root` (every in-tree caller does so via
// `resolveUnderRoot`); the throw is defense-in-depth.
function sidecarPathFor(htmlPath: string, root: string, sidecarDir: string): string {
  const rel = relativeUnderRoot(root, htmlPath);
  if (rel === null || rel === '') {
    throw new Error(`sidecarPathFor: htmlPath must resolve under root (got ${JSON.stringify(htmlPath)})`);
  }
  return path.join(sidecarDir, rel.replace(/\.html?$/i, '') + '.comments.json');
}

// --- model + sidecar I/O --------------------------------------------------

function isWellShapedComment(c: unknown): c is LegacyComment {
  if (!c || typeof c !== 'object') return false;
  const x = c as Partial<LegacyComment>;
  if (typeof x.id !== 'string' || typeof x.body !== 'string') return false;
  if (typeof x.author !== 'string' || typeof x.created_at !== 'string') return false;
  if (!x.anchor || typeof x.anchor !== 'object') return false;
  const a = x.anchor as Partial<LegacyComment['anchor']>;
  if (!Array.isArray(a.sections) || !a.sections.every((s) => typeof s === 'string')) return false;
  return typeof a.prefix === 'string'
    && typeof a.exact === 'string' && typeof a.suffix === 'string';
}

function isWellShapedModel(parsed: unknown): parsed is CommentsModel {
  if (!parsed || typeof parsed !== 'object') return false;
  const m = parsed as Partial<CommentsModel>;
  if (typeof m.doc !== 'string' || m.schema !== 1 || !Array.isArray(m.comments)) return false;
  // Deep-validate so a malformed PUT can't land junk the widget later trips on.
  return m.comments.every(isWellShapedComment);
}

function emptyModel(docLabel: string): CommentsModel {
  return { doc: docLabel, schema: 1, comments: [] };
}

// Returns empty model for any recoverable failure so the widget mounts with
// a clean slate and the next PUT overwrites the bad file. Other I/O errors
// propagate so GETs fail loudly instead of silently dropping data.
async function readSidecar(sidecarPath: string, docLabel: string): Promise<CommentsModel> {
  let text: string;
  try {
    text = await fs.readFile(sidecarPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyModel(docLabel);
    throw err;
  }
  if (!text.trim()) return emptyModel(docLabel);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyModel(docLabel);
  }
  if (!isWellShapedModel(parsed)) return emptyModel(docLabel);
  return parsed;
}

// Atomic write: mkdir -p parent, write tmp, rename. Crash mid-write leaves
// the prior sidecar intact. UUID-suffixed tmp avoids same-ms collisions.
// tmp lives in the same dir as sidecar so rename never crosses volumes —
// fs.rename is only atomic when source+target share one (Windows EXDEV).
async function writeSidecarAtomic(sidecarPath: string, model: CommentsModel): Promise<void> {
  const dir = path.dirname(sidecarPath);
  await fs.mkdir(dir, { recursive: true });
  const json = JSON.stringify(model, null, 2) + '\n';
  const tmpPath = path.join(dir, path.basename(sidecarPath) + '.' + crypto.randomUUID() + '.tmp');
  await fs.writeFile(tmpPath, json, 'utf-8');
  try {
    await fs.rename(tmpPath, sidecarPath);
  } catch (err) {
    fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

// --- HTTP plumbing --------------------------------------------------------

function send(res: http.ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}): void {
  res.writeHead(status, headers);
  res.end(body);
}

async function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    req.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > limit) {
        reject(Object.assign(new Error('payload too large'), { code: 'ETOOBIG' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// --- request handlers -----------------------------------------------------

// PUT /__htmldocs/sidecar/<doc-path>. URL-derived doc path is validated
// against --root; sidecar lands under --sidecar-dir, mirrored.
async function handlePutSidecar(req: http.IncomingMessage, res: http.ServerResponse, root: string, sidecarDir: string, urlPath: string): Promise<void> {
  const docRel = urlPath.slice(SIDECAR_URL_PREFIX.length);
  if (!docRel) { send(res, 400, 'missing doc path'); return; }
  const htmlPath = resolveUnderRoot(root, '/' + docRel);
  if (!htmlPath) { send(res, 400, 'bad doc path'); return; }
  if (!/\.html?$/i.test(htmlPath)) { send(res, 400, 'doc path must end in .html'); return; }
  // Refuse orphan sidecars: the widget only PUTs for the doc it's hosted on,
  // so a missing doc means a crafted curl or stale bundle — junk either way.
  const htmlStat = await fs.stat(htmlPath).catch(() => null);
  if (!htmlStat || !htmlStat.isFile()) { send(res, 404, 'doc not found'); return; }
  let body: string;
  try {
    body = await readBody(req, 5 * 1024 * 1024); // 5 MiB cap
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ETOOBIG') { send(res, 413, 'payload too large'); return; }
    send(res, 400, 'bad request'); return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    send(res, 400, 'invalid JSON'); return;
  }
  if (!isWellShapedModel(parsed)) {
    send(res, 422, 'invalid CommentsModel shape'); return;
  }
  await writeSidecarAtomic(sidecarPathFor(htmlPath, root, sidecarDir), parsed);
  send(res, 204, '');
}

async function handleGetBundle(res: http.ServerResponse): Promise<void> {
  try {
    const bytes = await fs.readFile(BUNDLE_PATH);
    send(res, 200, bytes, { 'Content-Type': MIME['.mjs']!, 'Cache-Control': 'no-cache' });
  } catch {
    send(res, 500, 'comments.mjs not found next to serve.mjs in dist/');
  }
}

// Serve an HTML doc with the widget bundle + inline JSON seed injected.
// Sidecar is read fresh per request so reloads always reflect on-disk state.
async function handleHtmlInject(res: http.ServerResponse, root: string, sidecarDir: string, htmlPath: string): Promise<void> {
  let html: string;
  try {
    html = await fs.readFile(htmlPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') { send(res, 404, 'not found'); return; }
    send(res, 500, 'read failed'); return;
  }
  const docLabel = path.basename(htmlPath);
  const model = await readSidecar(sidecarPathFor(htmlPath, root, sidecarDir), docLabel);
  const injected = injectIntoHtml(html, model);
  send(res, 200, injected, { 'Content-Type': MIME['.html']!, 'Cache-Control': 'no-cache' });
}

async function handleStatic(res: http.ServerResponse, filePath: string): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const ctype = MIME[ext] || 'application/octet-stream';
  const bytes = await fs.readFile(filePath);
  send(res, 200, bytes, { 'Content-Type': ctype, 'Cache-Control': 'no-cache' });
}

async function handleGet(res: http.ServerResponse, root: string, sidecarDir: string, urlPath: string): Promise<void> {
  const resolved = resolveUnderRoot(root, urlPath);
  if (!resolved) { send(res, 400, 'bad path'); return; }
  let finalPath = resolved;
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(finalPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOTDIR on traversal-through-a-file (e.g. `/foo.html/bar`) is also a 404.
    if (code === 'ENOENT' || code === 'ENOTDIR') { send(res, 404, 'not found'); return; }
    send(res, 500, 'stat failed'); return;
  }
  if (stat.isDirectory()) {
    finalPath = path.join(finalPath, 'index.html');
    try { stat = await fs.stat(finalPath); } catch { send(res, 404, 'not found'); return; }
  }
  const ext = path.extname(finalPath).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    await handleHtmlInject(res, root, sidecarDir, finalPath);
  } else {
    await handleStatic(res, finalPath);
  }
}

// --- comment API (runtime-agnostic logic mounted over HTTP) --------------

// Fixed local reviewer identity. The author is ALWAYS stamped server-side,
// never read from the request body — the same contract the hosted Worker
// enforces from the session.
const LOCAL_AUTHOR: Author = { login: 'user', name: null };

// GET/POST <doc>?ref=&comments — mounts the runtime-agnostic comment API over
// HTTP against a Node fs-backed SidecarStore. Resolves + requires an existing
// .html doc (else 404, matching the sidecar PUT path), builds a SidecarStore
// wired to the existing readSidecar/writeSidecarAtomic helpers, stamps the
// fixed local author, and dispatches to handleCommentsRequest.
async function handleCommentsApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  root: string,
  sidecarDir: string,
  urlPath: string,
  params: URLSearchParams,
  method: string,
): Promise<void> {
  const htmlPath = resolveUnderRoot(root, urlPath);
  if (!htmlPath) { sendJson(res, 404, { error: 'not found' }); return; }
  if (!/\.html?$/i.test(htmlPath)) { sendJson(res, 404, { error: 'not found' }); return; }
  const htmlStat = await fs.stat(htmlPath).catch(() => null);
  if (!htmlStat || !htmlStat.isFile()) { sendJson(res, 404, { error: 'not found' }); return; }

  const docLabel = path.basename(htmlPath);
  const sidecarPath = sidecarPathFor(htmlPath, root, sidecarDir);
  const store = new SidecarStore(
    {
      load: () => readSidecar(sidecarPath, docLabel),
      save: (model) => writeSidecarAtomic(sidecarPath, model),
    },
    docLabel,
  );

  // The local route has NO <repo> segment; a missing OR empty ?ref= is the
  // literal 'default' sentinel (|| so ?ref= collapses to it too). SidecarStore
  // ignores the tuple (one sidecar per page) but the shape stays identical to
  // the hosted seam.
  const doc: DocKey = {
    repo: '',
    ref: params.get('ref') || 'default',
    path: stripQueryHash(urlPath),
  };

  let body: unknown;
  if (method === 'POST') {
    let raw: string;
    try {
      raw = await readBody(req, 5 * 1024 * 1024); // 5 MiB cap
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ETOOBIG') { sendJson(res, 413, { error: 'payload too large' }); return; }
      sendJson(res, 400, { error: 'bad request' }); return;
    }
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON' }); return;
      }
    }
  }

  const { status, json } = await handleCommentsRequest({
    method, body, store, doc, author: LOCAL_AUTHOR,
  });
  sendJson(res, status, json);
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  json: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  send(res, status, JSON.stringify(json), { 'Content-Type': MIME['.json']!, ...extraHeaders });
}

// --- public API -----------------------------------------------------------

export interface ServerConfig {
  root: string;
  sidecarDir: string;
}

export function createServer(cfg: ServerConfig): http.Server {
  return http.createServer((req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';
    const urlPath = stripQueryHash(url);

    if (method === 'PUT' && urlPath.startsWith(SIDECAR_URL_PREFIX)) {
      handlePutSidecar(req, res, cfg.root, cfg.sidecarDir, urlPath).catch((err) => {
        console.error('[serve] PUT failed:', err);
        if (!res.headersSent) send(res, 500, 'write failed');
      });
      return;
    }

    // Comment API: GET/POST <doc>?ref=&comments. The query string names the
    // collection, the body names the op. Detected via ?comments (bare or =1).
    const query = url.indexOf('?');
    const params = new URLSearchParams(query === -1 ? '' : url.slice(query + 1));
    if (params.has('comments')) {
      // Claim ?comments for EVERY method so a HEAD/PUT/etc. can't fall through
      // to the doc handler and receive injected HTML. GET/POST are the only real
      // verbs; anything else is a JSON 405 with an Allow header.
      if (method !== 'GET' && method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET, POST' });
        return;
      }
      handleCommentsApi(req, res, cfg.root, cfg.sidecarDir, urlPath, params, method).catch((err) => {
        console.error('[serve] comments API failed:', err);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      send(res, 405, 'method not allowed', { Allow: 'GET, HEAD, PUT' });
      return;
    }

    if (urlPath === COMMENTS_WIDGET_SRC) {
      handleGetBundle(res).catch((err) => {
        console.error('[serve] bundle read failed:', err);
        if (!res.headersSent) send(res, 500, 'bundle read failed');
      });
      return;
    }

    handleGet(res, cfg.root, cfg.sidecarDir, urlPath).catch((err) => {
      console.error('[serve] GET failed:', err);
      if (!res.headersSent) send(res, 500, 'internal error');
    });
  });
}

// Resolve the sidecar root: explicit value → ensure it's a directory
// (create if missing, error if it exists as a file); unset → auto-tmp.
// Pure path/FS logic, separated from binding so tests can call it.
export async function resolveSidecarDir(sidecarDir: string | null | undefined): Promise<string> {
  if (sidecarDir) {
    const abs = path.resolve(sidecarDir);
    const existing = await fs.stat(abs).catch(() => null);
    if (existing && !existing.isDirectory()) {
      throw new Error(`--sidecar-dir is not a directory: ${abs}`);
    }
    if (!existing) await fs.mkdir(abs, { recursive: true });
    return abs;
  }
  return fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-sidecars.'));
}

export interface StartReviewServerOpts {
  root: string;
  sidecarDir?: string | null;
  port?: number;  // default 0 = OS-assigned
  // host is intentionally not exposed: review mode is single-user localhost.
  // Binding any non-loopback address would publish sidecar PUT to the LAN.
}

export interface ReviewServerHandle {
  server: http.Server;
  url: string;
  sidecarDir: string;
  close: () => Promise<void>;
}

// One-call boot for in-process callers (Playwright specs). Resolves the
// sidecar dir, validates root, builds the server, binds, returns enough to
// drive + tear down. If listen fails AFTER an auto-tmp sidecar dir was
// minted, that dir is cleaned up so failed retries don't accumulate junk.
export async function startReviewServer(opts: StartReviewServerOpts): Promise<ReviewServerHandle> {
  const root = path.resolve(opts.root);
  const rootStat = await fs.stat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`startReviewServer: root is not a directory: ${root}`);
  }
  const sidecarDirRequested = opts.sidecarDir ?? null;
  const sidecarDir = await resolveSidecarDir(sidecarDirRequested);
  const autoTmp = sidecarDirRequested === null;
  const server = createServer({ root, sidecarDir });
  const port = opts.port ?? 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => { server.removeListener('error', onError); reject(err); };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
  } catch (err) {
    if (autoTmp) await fs.rm(sidecarDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  const addr = server.address();
  if (typeof addr === 'string' || !addr) {
    throw new Error('serve: listen succeeded but no address');
  }
  const close = () => new Promise<void>((resolve) => {
    // Match main()'s shutdown — drop idle keep-alives so close resolves
    // promptly even with browser clients still holding connections.
    const s = server as unknown as { closeAllConnections?: () => void };
    if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
    server.close(() => resolve());
  });
  return { server, url: `http://${addr.address}:${addr.port}`, sidecarDir, close };
}

// --- CLI entry ------------------------------------------------------------

interface CliArgs {
  port: number;
  root: string;
  sidecarDir: string | null;
}

async function parseCliArgs(): Promise<CliArgs> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('serve.mjs')
    .strict()
    .option('port', {
      type: 'number',
      demandOption: true,
      describe: 'TCP port to bind on 127.0.0.1 (1..65535)',
    })
    .option('root', {
      type: 'string',
      demandOption: true,
      describe: 'Directory to serve static files from',
    })
    .option('sidecar-dir', {
      type: 'string',
      describe: 'Directory for sidecar JSON; auto-tmp if omitted',
    })
    .check((args) => {
      if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
        throw new Error('--port must be an integer in 1..65535');
      }
      // Catch `--sidecar-dir ''` (shell-quoted empty value) and the `=`
      // form `--sidecar-dir=`. Use strict equality to '' so a literal
      // arg like `--sidecar-dir 0` (truthy in JS terms but valid path)
      // isn't rejected by accident.
      if (args['sidecar-dir'] === '') {
        throw new Error('--sidecar-dir requires a non-empty path argument');
      }
      return true;
    })
    .help(false)
    .version(false)
    .parseAsync();
  return {
    port: argv.port,
    root: path.resolve(argv.root),
    sidecarDir: argv['sidecar-dir'] ? path.resolve(argv['sidecar-dir']) : null,
  };
}

async function main(): Promise<void> {
  const cli = await parseCliArgs();
  const handle = await startReviewServer({
    root: cli.root,
    sidecarDir: cli.sidecarDir,
    port: cli.port,
  });
  // serve.sh already printed URL:; serve.mjs prints the matching
  // SIDECAR_DIR: so the caller (test, agent, smoke) can locate sidecars.
  console.log(`SIDECAR_DIR: ${handle.sidecarDir}`);
  const shutdown = () => {
    const s = handle.server as unknown as { closeAllConnections?: () => void };
    if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
    handle.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run main() when invoked as the entry script — not when imported by
// in-process tests. Compare realpath'd paths so symlinked installs
// (npm/pnpm bin shims) and case-normalizing platforms still match.
function invokedAsScript(): boolean {
  if (!process.argv[1]) return false;
  const here = fileURLToPath(import.meta.url);
  const entry = path.resolve(process.argv[1]);
  if (here === entry) return true;
  try {
    return fsSync.realpathSync(here) === fsSync.realpathSync(entry);
  } catch {
    return false;
  }
}
if (invokedAsScript()) {
  main().catch((err) => {
    console.error('serve.mjs:', err);
    process.exit(1);
  });
}
