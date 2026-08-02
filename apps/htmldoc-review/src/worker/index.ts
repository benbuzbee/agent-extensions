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
import { D1Store } from "./d1-store";
import {
  buildSeedModel,
  injectWidget,
  serveWidgetBundle,
  COMMENTS_WIDGET_SRC,
} from "./inject";
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

// The caller's credential, decided ONCE at the auth fork in the handler and
// carried explicitly from there. Downstream code switches on `kind` — never on
// the nullness of a session id — so "who is calling" reads as what it is: a
// browser session (refreshable, carries a login-captured identity) or an agent
// bearer token (no session, nothing to refresh).
type Credential =
  | { kind: "session"; id: SessionId; token: string }
  | { kind: "bearer"; token: string };

// Resolve the author to stamp on a mutation (comments branch) or seed onto a
// doc view (injection). Session credential: the identity captured at login —
// guaranteed present on any record that resolved a token (identity-less
// records die on read in getValidAccessToken); a null return means the record
// vanished since, i.e. a dead session, and each caller picks its own
// dead-session answer. Bearer credential: the DISTINGUISHABLE {login:"agent"}
// placeholder — never a generic "unknown" — and NO GET /user is issued.
// Factored so the comments branch and the doc-view seed resolve identically.
async function resolveAuthor(
  store: KvSessionStore,
  cred: Credential
): Promise<{ author: Author; actor: Actor } | null> {
  if (cred.kind === "session") {
    const identity = await getIdentity(store, cred.id);
    if (!identity) return null;
    return {
      author: { login: identity.login, name: identity.name, id: identity.id },
      actor: "session",
    };
  }
  return { author: { login: "agent", name: null }, actor: "bearer" };
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
      // The widget bundle is PUBLIC and doc-independent: serve it FIRST, before
      // the /auth switch, before token resolution, and before
      // parseDocRequest/checkAccess. It never resolves a token, never probes
      // GitHub, and never returns neutral() — so it has zero interplay with the
      // neutral-404 non-leak contract.
      if (url.pathname === COMMENTS_WIDGET_SRC) return serveWidgetBundle(req);

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

      // Resolve the caller's credential. An agent presents a bearer header
      // (used directly, no session/refresh); the widget presents the session
      // cookie (proactively refreshed on expiry). Bearer wins if both are sent.
      const bearer = bearerToken(req);
      const sid = readCookie(req, SESSION_COOKIE);
      let cred: Credential | null = null;
      if (bearer) {
        cred = { kind: "bearer", token: bearer };
      } else if (sid) {
        const sessionId = asSessionId(sid);
        const sessionToken = await getValidAccessToken(cfg, store, sessionId);
        if (sessionToken) cred = { kind: "session", id: sessionId, token: sessionToken };
      }
      // No usable credential (none presented, or a dead/expired/identity-less
      // session): the API surface gets an honest 401; a browser doc view 302s
      // to login. Both are uniform + pre-probe, so neither leaks existence.
      if (!cred) return isComments ? unauthorized() : loginRedirect(url);
      // The session id serveDoc may refresh against — only a session credential
      // has one (a bearer has no session to refresh). `token` is mutable for
      // the one forced-refresh retry below.
      const refreshSid = cred.kind === "session" ? cred.id : null;
      let token = cred.token;

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
        // Stamp the author server-side (never read from the body). A dead
        // session here (record vanished since token resolution) is
        // unauthorized — the same answer any credential-less comments request
        // gets; the doc-view seed below instead just omits the author.
        const resolved = await resolveAuthor(store, cred);
        if (!resolved) return unauthorized();
        const { author, actor } = resolved;
        return await handleComments(
          env.COMMENTS_DB,
          req,
          { repo, ref: ref ?? "default", path: docPath },
          author,
          refreshSid,
          actor,
        );
      }

      // Doc view. Serve the raw doc, then — on a 200 HTML response only — append
      // the review widget + an inline JSON seed of this doc's comments (open AND
      // resolved). The access-denied / neutral-404 path returned BEFORE serveDoc
      // and is never rewritten.
      const res = await serveDoc(cfg, store, url, refreshSid, token, repo, docPath, ref);
      // Header values are case-insensitive — normalize before matching so an
      // upstream emitting `Text/HTML` still gets the widget.
      const ctype = (res.headers.get("Content-Type") ?? "").toLowerCase();
      if (res.status !== 200 || !ctype.includes("text/html")) return res;

      const threads = await new D1Store(env.COMMENTS_DB).list({
        repo,
        ref: ref ?? "default",
        path: docPath,
      });
      const model = buildSeedModel(threads, docPath);
      // A dead session here (record vanished since token resolution) must not
      // break a doc VIEW that already served — seed without an author instead.
      // No GitHub call is involved: resolveAuthor only reads the session record.
      const author = (await resolveAuthor(store, cred))?.author;
      return injectWidget(res, model, COMMENTS_WIDGET_SRC, author);
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
