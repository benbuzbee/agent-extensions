import { getValidAccessToken, deleteSession } from "../core/session";
import { beginLogin, completeLogin } from "../core/oauth";
import { fetchDoc, parseDocRequest, InvalidPathError } from "../core/docsource";
import { neutral } from "../core/responses";
import {
  readCookie,
  clearCookieString,
  CookieParseError,
  SESSION_COOKIE,
} from "../core/cookies";
import type { Config } from "../core/config";
import { getLogger } from "@logtape/logtape";
import { KvSessionStore } from "./kv-store";
import { initWorkerLogging } from "./logging";

const log = getLogger(["htmldoc-review", "worker"]);

// Auth route paths, named once so the dispatch switch and the redirect builder
// can't drift out of sync. Everything else is treated as a doc request.
const ROUTES = {
  login: "/auth/login",
  callback: "/auth/callback",
  logout: "/auth/logout",
} as const;

/**
 * Runtime bindings for this Worker (the composition-root inputs). One Worker is
 * scoped to exactly one GitHub org via `DOC_OWNER`; it is NOT scoped to a single
 * repo or branch. The repo is the first URL path segment and the doc path is the
 * remainder (e.g. `/app-ios/docs/foo.html`); the optional branch/tag/SHA is the
 * `?ref=` query param. So there is deliberately no `DOC_REPO` / `DOC_BRANCH`
 * here — adding them back would re-scope the Worker to a single repo.
 *
 * - `SESSIONS`           KV namespace: `sess:<id>` -> {access_token, refresh_token, expires_at}.
 * - `GITHUB_CLIENT_ID`   GitHub App client id (public, not a secret).
 * - `GITHUB_CLIENT_SECRET` GitHub App client secret (via `wrangler secret put`).
 * - `STATE_SIGNING_KEY`  HMAC key for the signed OAuth `state` cookie (secret).
 * - `CALLBACK_URL`       Absolute OAuth callback URL for this deployment.
 * - `DOC_OWNER`          The GitHub org/owner this Worker proxies docs for.
 */
export interface Env {
  SESSIONS: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  STATE_SIGNING_KEY: string;
  CALLBACK_URL: string;
  DOC_OWNER: string;
}

// Composition root: turn Worker bindings into the portable Config the core sees.
function configOf(env: Env): Config {
  return {
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    callbackUrl: env.CALLBACK_URL,
    stateSigningKey: env.STATE_SIGNING_KEY,
    docOwner: env.DOC_OWNER,
  };
}

function loginRedirect(url: URL): Response {
  const login = new URL(ROUTES.login, url.origin);
  login.searchParams.set("return", url.pathname);
  return new Response(null, { status: 302, headers: { Location: login.toString() } });
}

// Serve a single doc, transparently re-authing once on a 401. The first fetch
// uses whatever access token we already have; if GitHub says 401 the token is
// stale/revoked, so we force ONE refresh and retry. A second 401 (or a dead
// session) means the grant is gone -> bounce to login. This is the single place
// the 401 -> refresh -> retry path lives, so the happy path and the re-auth
// path can't diverge.
async function serveDoc(
  cfg: Config,
  store: KvSessionStore,
  url: URL,
  sid: string | null,
  token: string,
  repo: string,
  docPath: string,
  ref: string | undefined
): Promise<Response> {
  let res = await fetchDoc(cfg, token, repo, docPath, ref);
  if (res.status === 401 && sid) {
    const fresh = await getValidAccessToken(cfg, store, sid, true);
    if (!fresh) return loginRedirect(url);
    res = await fetchDoc(cfg, fresh, repo, docPath, ref);
  }
  const repoFqn = `${cfg.docOwner}/${repo}`;
  if (res.status === 200) {
    log.info("doc served", { path: docPath, repo: repoFqn, ref: ref ?? "(default)" });
  } else {
    log.info("doc denied", { path: docPath, repo: repoFqn, status: res.status });
  }
  return res;
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    await initWorkerLogging();
    const url = new URL(req.url);
    const cfg = configOf(env);
    const store = new KvSessionStore(env.SESSIONS);

    try {
      switch (url.pathname) {
        case ROUTES.login:
          return await beginLogin(req, cfg);
        case ROUTES.callback:
          return await completeLogin(req, cfg, store);
        case ROUTES.logout: {
          const sid = readCookie(req, SESSION_COOKIE);
          if (sid) await deleteSession(store, sid);
          const headers = new Headers({
            Location: new URL("/", url.origin).toString(),
          });
          headers.append("Set-Cookie", clearCookieString(SESSION_COOKIE, "/"));
          return new Response(null, { status: 302, headers });
        }
      }

      // Doc request. No valid session -> redirect to login (never reveals
      // whether the doc exists).
      const sid = readCookie(req, SESSION_COOKIE);
      const token = sid ? await getValidAccessToken(cfg, store, sid) : null;
      if (!token) return loginRedirect(url);

      // Repo = first path segment, doc path = remainder; branch/tag/SHA = ?ref=.
      let repo: string;
      let docPath: string;
      try {
        ({ repo, docPath } = parseDocRequest(url.pathname));
      } catch (err) {
        if (err instanceof InvalidPathError) {
          // Preserve the error (log it) but map it to the neutral 404: an
          // unparseable path can only ever mean "no such doc". safeSegments
          // throws the same type from inside fetchDoc; it surfaces here too.
          log.info("invalid doc request", {
            path: url.pathname,
            error: err.message,
          });
          return neutral();
        }
        throw err;
      }
      // Optional branch/tag/SHA. `URL` has already percent-decoded it; pass the
      // decoded value to fetchDoc, which re-encodes it for the Contents API.
      const ref = url.searchParams.get("ref") ?? undefined;

      return await serveDoc(cfg, store, url, sid, token, repo, docPath, ref);
    } catch (err) {
      // A safeSegments InvalidPathError raised from inside fetchDoc launders to
      // the same neutral 404 as a parse-time one.
      if (err instanceof InvalidPathError) {
        log.info("invalid doc request", { path: url.pathname, error: err.message });
        return neutral();
      }
      // A malformed Cookie header is a client problem, not a server fault, and
      // it must not leak a stack trace. Log it (never the header value) and map
      // it to a 400.
      if (err instanceof CookieParseError) {
        log.info("rejected malformed cookie header", { path: url.pathname });
        return new Response("Bad request", {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;
