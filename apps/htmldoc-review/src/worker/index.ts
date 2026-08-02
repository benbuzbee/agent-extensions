import { getValidAccessToken, getIdentity, deleteSession } from "../core/session";
import { beginLogin, completeLogin, sanitizeReturnPath } from "../core/oauth";
import { fetchDoc, parseDocRequest, InvalidPathError } from "../core/docsource";
import {
  neutral,
  setupComplete,
  unauthorized,
  loginFailed,
  LOGIN_ERROR_PATH,
} from "../core/responses";
import {
  readCookie,
  clearCookieString,
  CookieParseError,
  SESSION_COOKIE,
} from "../core/cookies";
import { asSessionId, type SessionId } from "../core/store";
import type { Author } from "@shared/review-ux/types";
import type { Config } from "../core/config";
import { getLogger } from "@logtape/logtape";
import { KvSessionStore } from "./kv-store";
import { checkAccess } from "./access";
import { handleComments, type Actor } from "./comments";
import { initWorkerLogging } from "./logging";

const log = getLogger(["htmldoc-review", "worker"]);

// Auth route paths, named once so the dispatch switch and the redirect builder
// can't drift out of sync. Everything else is treated as a doc request.
const ROUTES = {
  login: "/auth/login",
  callback: "/auth/callback",
  logout: "/auth/logout",
  error: LOGIN_ERROR_PATH,
} as const;

/**
 * Runtime bindings for this Worker (the composition-root inputs). One Worker
 * serves one GitHub account (org or individual) via `REPO_ORG`. The repo is
 * the first URL path segment and the doc path is the remainder (e.g.
 * `/app-ios/docs/foo.html`); the optional branch/tag/SHA is the `?ref=` query
 * param.
 *
 * - `SESSIONS`           KV namespace: `sess:<id>` -> {access_token, refresh_token, expires_at}.
 * - `COMMENTS_DB`        D1 database backing the comment store (D1Store), read by
 *                        the `?comments` API branch (handleComments) on an
 *                        access-checked doc.
 * - `GITHUB_CLIENT_ID`   GitHub App client id (public, not a secret).
 * - `GITHUB_CLIENT_SECRET` GitHub App client secret (via `wrangler secret put`).
 * - `STATE_SIGNING_KEY`  HMAC key for the signed OAuth `state` cookie (secret).
 * - `CALLBACK_URL`       Absolute OAuth callback URL for this deployment.
 * - `REPO_ORG`           The GitHub org/owner this Worker proxies docs for.
 * - `SESSION_VALID_SINCE` OPTIONAL ms-epoch forced-re-login cutoff (0 = disabled).
 *                        TOML/.dev.vars deliver it as a string, and a Worker that
 *                        hasn't been redeployed since this shipped delivers
 *                        undefined — hence `number | string | undefined`.
 */
export interface Env {
  SESSIONS: KVNamespace;
  COMMENTS_DB: D1Database;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  STATE_SIGNING_KEY: string;
  CALLBACK_URL: string;
  REPO_ORG: string;
  SESSION_VALID_SINCE?: number | string;
}

// Composition root: turn Worker bindings into the portable Config the core sees.
function configOf(env: Env): Config {
  return {
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    callbackUrl: env.CALLBACK_URL,
    stateSigningKey: env.STATE_SIGNING_KEY,
    repoOrg: env.REPO_ORG,
    sessionValidSince: sessionValidSinceOf(env.SESSION_VALID_SINCE),
  };
}

// `?? 0` + Number() is honest against all three shapes (TOML integer, .dev.vars
// string, undefined on a not-yet-redeployed Worker). The isFinite guard matters
// because a malformed string parses to NaN, whose comparisons are always false —
// the cutoff in getValidAccessToken would be silently disabled (fail-open).
// Treat that misconfiguration as "no cutoff set" explicitly instead.
function sessionValidSinceOf(raw: number | string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function loginRedirect(url: URL): Response {
  const login = new URL(ROUTES.login, url.origin);
  login.searchParams.set("return", url.pathname);
  return new Response(null, { status: 302, headers: { Location: login.toString() } });
}

// Pull a GitHub token out of an `Authorization: Bearer <token>` header (the
// agent's credential). Returns null when absent/malformed so the caller falls
// back to the session cookie. The token is used as-is: an agent PAT/installation
// token is not a session, so there is nothing to refresh.
function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (!header) return null;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return null;
  const token = header.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
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
  sid: SessionId | null,
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
  const repoFqn = `${cfg.repoOrg}/${repo}`;
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
        case ROUTES.callback: {
          // Post-install redirect, not a login. With `request_oauth_on_install`
          // GitHub sends the browser here after the admin installs the App,
          // carrying `setup_action`/`installation_id` but with NO state cookie
          // (our /auth/login never ran). That would trip the CSRF guard in
          // completeLogin and show a scary "Invalid OAuth state" to someone who
          // did nothing wrong, so intercept it and show a friendly confirmation.
          // The real login 302 dance runs invisibly the first time they open a doc.
          if (url.searchParams.has("setup_action")) {
            log.info("post-install callback", {
              setup_action: url.searchParams.get("setup_action"),
            });
            return setupComplete();
          }
          return await completeLogin(req, cfg, store);
        }
        case ROUTES.logout: {
          const sidCookie = readCookie(req, SESSION_COOKIE);
          if (sidCookie) await deleteSession(store, asSessionId(sidCookie));
          const headers = new Headers({
            Location: new URL("/", url.origin).toString(),
          });
          headers.append("Set-Cookie", clearCookieString(SESSION_COOKIE, "/"));
          return new Response(null, { status: 302, headers });
        }
        case ROUTES.error:
          // Refresh-safe home for the login-failure retry page: completeLogin
          // 303s here so the browser never parks on the spent callback URL.
          // The ?return= is user-editable, so re-sanitize before embedding.
          return loginFailed(
            sanitizeReturnPath(url.searchParams.get("return") ?? "/", url.origin)
          );
      }

      // Everything past the /auth/* switch is either a doc view or a comments
      // API call on that same doc — one catch-all, forking on ?comments.
      const isComments = url.searchParams.has("comments");

      // Resolve the caller's GitHub token. An agent presents a bearer header
      // (used directly, no session/refresh); the widget presents the session
      // cookie (proactively refreshed on expiry). Bearer wins if both are sent.
      const bearer = bearerToken(req);
      const sid = readCookie(req, SESSION_COOKIE);
      const sessionId = sid ? asSessionId(sid) : null;
      let token: string | null;
      // The session id serveDoc may refresh against — only when the token came
      // FROM that session (a bearer has no session to refresh).
      let refreshSid: SessionId | null;
      if (bearer) {
        token = bearer;
        refreshSid = null;
      } else {
        token = sessionId
          ? await getValidAccessToken(cfg, store, sessionId)
          : null;
        refreshSid = sessionId;
      }
      // No credential: the API surface gets an honest 401; a browser doc view
      // 302s to login. Both are uniform + pre-probe, so neither leaks existence.
      if (!token) return isComments ? unauthorized() : loginRedirect(url);

      // Repo = first path segment, doc path = remainder; branch/tag/SHA = ?ref=.
      let repo: string;
      let docPath: string;
      try {
        ({ repo, docPath } = parseDocRequest(url.pathname));
      } catch (err) {
        if (err instanceof InvalidPathError) {
          // Preserve the error (log it) but map it to the neutral 404: an
          // unparseable path can only ever mean "no such doc". safeSegments
          // throws the same type from inside fetchDoc/probeContents too.
          log.info("invalid doc request", {
            path: url.pathname,
            error: err.message,
          });
          return neutral();
        }
        throw err;
      }
      // Optional branch/tag/SHA. `URL` has already percent-decoded it; pass the
      // decoded value on (fetchDoc/probeContents re-encode for the Contents API).
      const ref = url.searchParams.get("ref") ?? undefined;

      // The single post-auth chokepoint: one Contents probe guards BOTH branches
      // below. Any non-200/304 collapses to the neutral 404 (denialResponse), so
      // comments never leak a doc's existence and a future verb can't skip it.
      let access = await checkAccess(cfg, token, repo, ref, docPath);
      // A 401 probe means GitHub rejected the CREDENTIAL, not the doc — a
      // session token can be invalidated server-side while its stored expiry
      // still looks valid (revoked grant, concurrent rotation). Force ONE
      // refresh and re-probe, mirroring serveDoc's in-flight retry; a dead
      // grant bounces exactly like the no-token path. A bearer has no session
      // to refresh, so it falls through to the uniform neutral 404.
      if (!access.ok && access.status === 401 && refreshSid) {
        const fresh = await getValidAccessToken(cfg, store, refreshSid, true);
        if (!fresh) return isComments ? unauthorized() : loginRedirect(url);
        token = fresh;
        access = await checkAccess(cfg, token, repo, ref, docPath);
      }
      if (!access.ok) return access.denialResponse;

      // The store agrees on the 'default' sentinel for a missing ref; GitHub was
      // probed with ref-or-undefined (never the literal 'default').
      if (isComments) {
        // Stamp the author server-side. Session path: the identity captured at
        // login (guaranteed present — getValidAccessToken deletes identity-less
        // records on read). Bearer/agent path: the DISTINGUISHABLE
        // {login:"agent"} placeholder; no GET /user is issued for a bearer.
        let author: Author;
        let actor: Actor;
        if (refreshSid) {
          const identity = await getIdentity(store, refreshSid);
          // The record vanished between token resolution and this read
          // (concurrent logout/cutoff) — the session is dead; same answer as
          // arriving with no credential.
          if (!identity) return unauthorized();
          author = { login: identity.login, name: identity.name, id: identity.id };
          actor = "session";
        } else {
          author = { login: "agent", name: null };
          actor = "bearer";
        }
        return await handleComments(
          env.COMMENTS_DB,
          req,
          { repo, ref: ref ?? "default", path: docPath },
          author,
          refreshSid,
          actor,
        );
      }
      return await serveDoc(cfg, store, url, refreshSid, token, repo, docPath, ref);
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
