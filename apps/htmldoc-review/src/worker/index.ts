import { getValidAccessToken, deleteSession } from "../core/session";
import { beginLogin, completeLogin } from "../core/oauth";
import { fetchDoc, parseDocRequest, InvalidPathError } from "../core/docsource";
import { neutral } from "../core/responses";
import { readCookie, SESSION_COOKIE } from "../core/cookies";
import type { Config } from "../core/config";
import { getLogger } from "@logtape/logtape";
import { KvSessionStore } from "./kv-store";
import { initWorkerLogging } from "./logging";

const log = getLogger(["htmldoc-review", "worker"]);

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
  const login = new URL("/auth/login", url.origin);
  login.searchParams.set("return", url.pathname);
  return new Response(null, { status: 302, headers: { Location: login.toString() } });
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    await initWorkerLogging();
    const url = new URL(req.url);
    const cfg = configOf(env);
    const store = new KvSessionStore(env.SESSIONS);

    if (url.pathname === "/auth/login") return beginLogin(req, cfg);
    if (url.pathname === "/auth/callback") return completeLogin(req, cfg, store);
    if (url.pathname === "/auth/logout") {
      const sid = readCookie(req, SESSION_COOKIE);
      if (sid) await deleteSession(store, sid);
      const headers = new Headers({ Location: new URL("/", url.origin).toString() });
      headers.append(
        "Set-Cookie",
        `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
      );
      return new Response(null, { status: 302, headers });
    }

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
        // unparseable path can only ever mean "no such doc".
        log.info("invalid doc request", { path: url.pathname, error: err.message });
        return neutral();
      }
      throw err;
    }
    // Optional branch/tag/SHA. `URL` has already percent-decoded it; pass the
    // decoded value to fetchDoc, which re-encodes it for the Contents API.
    const ref = url.searchParams.get("ref") ?? undefined;

    let res = await fetchDoc(cfg, token, repo, docPath, ref);
    if (res.status === 401 && sid) {
      const fresh = await getValidAccessToken(cfg, store, sid, true);
      if (!fresh) return loginRedirect(url);
      res = await fetchDoc(cfg, fresh, repo, docPath, ref);
    }
    if (res.status === 200) {
      log.info("doc served", { path: docPath, repo: `${cfg.docOwner}/${repo}`, ref: ref ?? "(default)" });
    } else {
      log.info("doc denied", { path: docPath, repo: `${cfg.docOwner}/${repo}`, status: res.status });
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
