import { getValidAccessToken, deleteSession } from "./session";
import { beginLogin, completeLogin } from "./oauth";
import { fetchDoc } from "./docsource";
import { readCookie, SESSION_COOKIE } from "./cookies";

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

async function logout(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const sid = readCookie(req, SESSION_COOKIE);
  if (sid) await deleteSession(env, sid);
  const headers = new Headers({ Location: new URL("/", url.origin).toString() });
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/auth/login") return beginLogin(req, env);
    if (url.pathname === "/auth/callback") return completeLogin(req, env);
    if (url.pathname === "/auth/logout") return logout(req, env);

    const sid = readCookie(req, SESSION_COOKIE);
    const token = sid ? await getValidAccessToken(env, sid, ctx) : null;
    if (!token) {
      const login = new URL("/auth/login", url.origin);
      login.searchParams.set("return", url.pathname);
      return new Response(null, {
        status: 302,
        headers: { Location: login.toString() },
      });
    }

    const path = url.pathname.replace(/^\/+/, "");
    let res = await fetchDoc(env, token, path);
    if (res.status === 401 && sid) {
      const fresh = await getValidAccessToken(env, sid, ctx, true);
      if (!fresh) {
        const login = new URL("/auth/login", url.origin);
        login.searchParams.set("return", url.pathname);
        return new Response(null, {
          status: 302,
          headers: { Location: login.toString() },
        });
      }
      res = await fetchDoc(env, fresh, path);
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
