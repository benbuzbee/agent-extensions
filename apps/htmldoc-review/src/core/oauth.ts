import * as arctic from "arctic";
import type { Config } from "./config";
import type { SessionStore } from "./store";
import { createSession } from "./session";
import { readCookie, SESSION_COOKIE, STATE_COOKIE } from "./cookies";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["htmldoc-review", "oauth"]);

function gh(cfg: Config): arctic.GitHub {
  return new arctic.GitHub(
    cfg.githubClientId,
    cfg.githubClientSecret,
    cfg.callbackUrl
  );
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return b64url(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function burnState(): string {
  return `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0`;
}

function rejectAndBurn(status: number, body: string): Response {
  // Single choke point for all OAuth callback rejections (bad/missing state,
  // signature mismatch, authorization failed). `body` is a fixed, non-sensitive
  // reason string -- it carries no token/code/secret.
  log.error("OAuth callback rejected", { status, reason: body });
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  headers.append("Set-Cookie", burnState());
  return new Response(body, { status, headers });
}

export async function beginLogin(req: Request, cfg: Config): Promise<Response> {
  const url = new URL(req.url);
  log.info("login begun");
  const nonce = crypto.randomUUID();
  const sig = await hmac(cfg.stateSigningKey, nonce);
  const authUrl = gh(cfg).createAuthorizationURL(nonce, []);

  const ret = url.searchParams.get("return");
  if (ret) {
    authUrl.searchParams.set(
      "state",
      `${nonce}:${encodeURIComponent(ret)}`
    );
  }

  const headers = new Headers({ Location: authUrl.toString() });
  headers.append(
    "Set-Cookie",
    `${STATE_COOKIE}=${nonce}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600`
  );
  return new Response(null, { status: 302, headers });
}

export async function completeLogin(
  req: Request,
  cfg: Config,
  store: SessionStore
): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const cookie = readCookie(req, STATE_COOKIE);

  if (!code || !stateParam || !cookie) {
    return rejectAndBurn(400, "Invalid OAuth state");
  }

  const colon = stateParam.indexOf(":");
  const stateNonce = colon === -1 ? stateParam : stateParam.slice(0, colon);
  const ret =
    colon === -1 ? "/" : decodeURIComponent(stateParam.slice(colon + 1));

  const dot = cookie.indexOf(".");
  if (dot === -1) return rejectAndBurn(400, "Invalid OAuth state");
  const nonce = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = await hmac(cfg.stateSigningKey, nonce);

  if (stateNonce !== nonce || !timingSafeEqual(expected, sig)) {
    return rejectAndBurn(400, "Invalid OAuth state");
  }

  let tokens: arctic.OAuth2Tokens;
  try {
    tokens = await gh(cfg).validateAuthorizationCode(code);
  } catch (e) {
    // Network failure -> let it surface as 5xx (do not pretend it was a bad code).
    if (e instanceof arctic.ArcticFetchError) throw e;
    // A bad/expired authorization code: arctic v3 surfaces this either as
    // OAuth2RequestError (200 + error body) or UnexpectedResponseError /
    // UnexpectedErrorResponseBodyError (non-200) -> reject 4xx and burn state.
    if (
      e instanceof arctic.OAuth2RequestError ||
      e instanceof arctic.UnexpectedResponseError ||
      e instanceof arctic.UnexpectedErrorResponseBodyError
    ) {
      return rejectAndBurn(400, "Authorization failed");
    }
    throw e;
  }

  const refreshTtl = Number(
    (tokens.data as Record<string, unknown>).refresh_token_expires_in
  );
  const sid = await createSession(
    store,
    {
      access_token: tokens.accessToken(),
      refresh_token: tokens.refreshToken(),
      expires_at: tokens.accessTokenExpiresAt().getTime(),
    },
    Number.isFinite(refreshTtl) ? refreshTtl : undefined
  );

  // Only allow same-origin absolute paths. Reject scheme-relative ("//evil")
  // and backslash ("/\\evil") forms that new URL() would resolve off-origin.
  const safeRet =
    ret.startsWith("/") && !ret.startsWith("//") && !ret.startsWith("/\\")
      ? ret
      : "/";
  log.info("login completed", { sessionId: sid, return: safeRet });

  const dest = new URL(safeRet, url.origin);
  const headers = new Headers({ Location: dest.toString() });
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 180}`
  );
  headers.append("Set-Cookie", burnState());
  return new Response(null, { status: 302, headers });
}

export function refresh(
  cfg: Config,
  refreshToken: string
): Promise<arctic.OAuth2Tokens> {
  return gh(cfg).refreshAccessToken(refreshToken);
}
