import type { Config } from "./config";
import { neutral } from "./responses";

/**
 * Thrown when a request path cannot be turned into a safe GitHub Contents API
 * path — e.g. it carries no repo segment, or a doc segment is empty / `.` /
 * `..` (traversal). We throw a typed error instead of returning a silent
 * `null` so the Worker entrypoint can log it and decide on a response: the
 * error is preserved, not hidden. The entrypoint maps it to the neutral 404
 * (an unparseable path can only ever mean "no such doc").
 */
export class InvalidPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPathError";
  }
}

/**
 * Split the request pathname into `{ repo, docPath }`.
 *
 * The first non-empty path segment is the repo; the remainder is the
 * repo-relative doc path. One Worker serves one account (`cfg.repoOrg`), so any
 * repo under that account is addressable by name — the viewer's own GitHub
 * access is the gate. Example: `/app-ios/docs/foo.html` -> repo `app-ios`,
 * docPath `docs/foo.html`.
 *
 * @throws {InvalidPathError} if there is no repo segment or no doc path.
 */
export function parseDocRequest(pathname: string): {
  repo: string;
  docPath: string;
} {
  // A request path always starts with "/"; strip the leading slash(es) so the
  // first real path segment (the repo) lands at index 0.
  const trimmed = pathname.replace(/^\/+/, "");
  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    // Either just a repo with no doc, or nothing at all.
    throw new InvalidPathError(`no doc path in request: "${pathname}"`);
  }
  const repo = trimmed.slice(0, slash);
  const docPath = trimmed.slice(slash + 1);
  if (repo === "" || docPath === "") {
    throw new InvalidPathError(`missing repo or doc path: "${pathname}"`);
  }
  return { repo, docPath };
}

/**
 * Treat `repo` and `path` as opaque, attacker-controlled strings. Reject
 * traversal / empty / absolute segments, then percent-encode each segment so
 * that `?`, `#`, `&`, and `..` can never escape the repoOrg/repo confinement
 * or inject query parameters (e.g. override `ref`).
 *
 * @throws {InvalidPathError} if any segment is empty, `.`, or `..`.
 */
function safeSegments(value: string): string {
  const segments = value.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new InvalidPathError(`unsafe path segment in "${value}"`);
    }
  }
  return segments.map(encodeURIComponent).join("/");
}

/**
 * Proxy a single doc from the org's repo via the GitHub Contents API.
 *
 * The `repo` and `path` come from the request URL (see `parseDocRequest`); the
 * owning account is `cfg.repoOrg`. `ref` is the optional branch/tag/SHA from
 * the request's `?ref=` query param:
 *   - present  -> sent as `?ref=<percent-encoded>` so slashed branches like
 *                 `feature/a/b` survive (GitHub's own param name + encoding).
 *   - absent   -> NO `ref` param is sent; GitHub then serves the repo's default
 *                 branch automatically (so we never need to resolve / cache
 *                 `default_branch` here — that's a display-only concern for D2).
 *
 * @throws {InvalidPathError} via `safeSegments` if repo/path is unsafe.
 */
export async function fetchDoc(
  cfg: Config,
  token: string,
  repo: string,
  path: string,
  ref?: string
): Promise<Response> {
  const safeRepo = safeSegments(repo);
  const safePath = safeSegments(path);

  let url = `https://api.github.com/repos/${cfg.repoOrg}/${safeRepo}/contents/${safePath}`;
  if (ref !== undefined && ref !== "") {
    // Percent-encode the whole ref so slashed branches (feature/a/b) work.
    url += `?ref=${encodeURIComponent(ref)}`;
  }

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw+json",
      "User-Agent": "htmldoc-review-worker",
    },
  });

  if (r.status === 200) {
    return new Response(await r.text(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (r.status === 401) {
    return new Response(null, { status: 401 });
  }

  return neutral();
}

/**
 * Cheapest possible visibility check for a doc: "can this token read this
 * `(repo, path, ref)` on GitHub?" Mirrors `fetchDoc`'s URL construction exactly
 * (`safeSegments`, `cfg.repoOrg`, the present-vs-absent `ref` handling), but
 * asks for `application/vnd.github.object+json` — the metadata representation,
 * not the file body — and returns ONLY the HTTP status. The body is never read.
 *
 * This is the probe behind `checkAccess`: 200 (or 304 on a future conditional
 * re-probe) means the caller can see the doc; every other status maps to the
 * neutral 404 upstream. No `If-None-Match` here — the ETag/304 cache is a
 * deferred optimization, not needed for the authz decision.
 *
 * @throws {InvalidPathError} via `safeSegments` if repo/path is unsafe.
 */
export async function probeContents(
  cfg: Config,
  token: string,
  repo: string,
  path: string,
  ref?: string
): Promise<number> {
  const safeRepo = safeSegments(repo);
  const safePath = safeSegments(path);

  let url = `https://api.github.com/repos/${cfg.repoOrg}/${safeRepo}/contents/${safePath}`;
  if (ref !== undefined && ref !== "") {
    url += `?ref=${encodeURIComponent(ref)}`;
  }

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.object+json",
      "User-Agent": "htmldoc-review-worker",
    },
  });

  // Status line only — we never read r.body (that's what makes this a probe),
  // but we MUST cancel it: an un-consumed response stream holds the underlying
  // TCP connection open in the Workers runtime, draining the pool under load.
  r.body?.cancel();
  return r.status;
}
