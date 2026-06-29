import { getValidAccessToken, deleteSession } from "../core/session";
import { beginLogin, completeLogin } from "../core/oauth";
import { fetchDoc } from "../core/docsource";
import { readCookie, SESSION_COOKIE } from "../core/cookies";
import type { Config } from "../core/config";
import { getLogger } from "@logtape/logtape";
import { KvSessionStore } from "./kv-store";
import { initWorkerLogging } from "./logging";

const log = getLogger(["htmldoc-review", "worker"]);

export interface Env {
  SESSIONS: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  STATE_SIGNING_KEY: string;
  CALLBACK_URL: string;
  DOC_OWNER: string;
  DOC_REPO: string;
  DOC_BRANCH: string;
}

// Composition root: turn Worker bindings into the portable Config the core sees.
function configOf(env: Env): Config {
  return {
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    callbackUrl: env.CALLBACK_URL,
    stateSigningKey: env.STATE_SIGNING_KEY,
    docOwner: env.DOC_OWNER,
    docRepo: env.DOC_REPO,
    docBranch: env.DOC_BRANCH,
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

    const path = url.pathname.replace(/^\/+/, "");
    let res = await fetchDoc(cfg, token, path);
    if (res.status === 401 && sid) {
      const fresh = await getValidAccessToken(cfg, store, sid, true);
      if (!fresh) return loginRedirect(url);
      res = await fetchDoc(cfg, fresh, path);
    }
    if (res.status === 200) {
      log.info("doc served", { path, repo: `${cfg.docOwner}/${cfg.docRepo}`, branch: cfg.docBranch });
    } else {
      log.info("doc denied", { path, status: res.status });
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
