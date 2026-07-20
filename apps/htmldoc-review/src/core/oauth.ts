// The GitHub App user-to-server OAuth flow: begin a login (mint a signed CSRF
// state + redirect to GitHub), complete the callback (verify state, exchange
// the code, mint a server-side session), and refresh an access token. Portable
// by construction — it depends only on a plain Config and the SessionStore seam
// and uses Web-standard crypto/fetch, so it pulls in no Cloudflare types and
// runs unchanged anywhere those globals exist.
import * as arctic from "arctic";
import type { Config } from "./config";
import { auditId, type Identity, type SessionStore } from "./store";
import { createSession, type Grant } from "./session";
import { fetchIdentity } from "./identity";
import { LOGIN_ERROR_PATH } from "./responses";
import {
  readCookie,
  serializeCookie,
  clearCookieString,
  SESSION_COOKIE,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
} from "./cookies";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["htmldoc-review", "oauth"]);

// The signed-state cookie lives only long enough to ride out the round-trip to
// GitHub and back (10 min); the session cookie lasts up to the refresh-token
// horizon (~6 months) so a returning browser stays logged in.
const STATE_COOKIE_MAX_AGE = 600;
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

/** Construct the arctic GitHub client from portable config (no Worker types). */
function gh(cfg: Config): arctic.GitHub {
  return new arctic.GitHub(
    cfg.githubClientId,
    cfg.githubClientSecret,
    cfg.callbackUrl
  );
}

// The four primitives below (b64url, hmac, timingSafeEqual, clearStateCookieString)
// are exported only so the core unit suite can exercise them in isolation; they
// are implementation details of the OAuth flow and not part of any public API.

/** URL-safe base64 (RFC 4648 §5) with padding stripped — used for HMAC sigs. */
export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HMAC-SHA256(key, msg) as URL-safe base64 — signs the OAuth state nonce. */
export async function hmac(key: string, msg: string): Promise<string> {
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

/** Constant-time string compare so HMAC verification can't be timing-probed. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `Set-Cookie` value that deletes the state cookie (used on both reject and success). */
export function clearStateCookieString(): string {
  return clearCookieString(STATE_COOKIE, STATE_COOKIE_PATH);
}

// EVERY response leaving the callback must burn the now-spent state cookie —
// rejections, the identity-failure redirect, and the success 302 alike. One
// helper so a newly added exit can't forget it.
function withStateCleared(res: Response): Response {
  res.headers.append("Set-Cookie", clearStateCookieString());
  return res;
}

// Single choke point for every OAuth callback rejection (bad/missing state,
// signature mismatch, authorization failed). It logs and clears the now-spent
// state cookie. Called from four distinct guard arms below, so it earns its
// keep over inlining the log+clear+Response triple at each site. `body` is a
// fixed, non-sensitive reason string — it carries no token/code/secret.
function rejectAndClearState(status: number, body: string): Response {
  log.error("OAuth callback rejected", { status, reason: body });
  return withStateCleared(
    new Response(body, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

/**
 * Collapse an untrusted return path to a same-origin absolute path, else "/".
 * The prefix checks reject the plain scheme-relative ("//evil") and backslash
 * ("/\\evil") forms; the parse check is the real guarantee — WHATWG URL
 * parsing strips ASCII tab/newline, so a path like "/\t/evil.com" survives the
 * prefixes yet resolves off-origin. Only a value that PARSES back to the same
 * origin survives. Used by completeLogin and by the Worker's LOGIN_ERROR_PATH
 * route (whose ?return= is user-editable).
 */
export function sanitizeReturnPath(raw: string, origin: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  try {
    return new URL(raw, origin).origin === origin ? raw : "/";
  } catch {
    return "/";
  }
}

/**
 * Start the GitHub OAuth login: mint a CSRF state and redirect to GitHub.
 *
 * We mint a random `nonce`, HMAC-sign it, and stash `nonce.sig` in a short-lived
 * HttpOnly state cookie. The same `nonce` (optionally with the caller's
 * `?return=` path appended as `nonce:return`) rides along as the OAuth `state`
 * param. On callback we recompute the HMAC over the cookie's nonce and require
 * it to match the cookie's signature AND the returned state — a forged callback
 * can't produce a valid signature without the server-side signing key, which
 * defeats login-CSRF. The cookie is the trust anchor; the URL `state` is only a
 * carrier. The `return` path is sanitized in `completeLogin`, not trusted here.
 */
export async function beginLogin(req: Request, cfg: Config): Promise<Response> {
  const url = new URL(req.url);
  log.info("login begun");
  const nonce = crypto.randomUUID();
  const sig = await hmac(cfg.stateSigningKey, nonce);
  const authUrl = gh(cfg).createAuthorizationURL(nonce, []);

  const ret = url.searchParams.get("return");
  if (ret) {
    authUrl.searchParams.set("state", `${nonce}:${encodeURIComponent(ret)}`);
  }

  const headers = new Headers({ Location: authUrl.toString() });
  headers.append(
    "Set-Cookie",
    serializeCookie(STATE_COOKIE, `${nonce}.${sig}`, {
      path: STATE_COOKIE_PATH,
      maxAge: STATE_COOKIE_MAX_AGE,
    })
  );
  return new Response(null, { status: 302, headers });
}

/**
 * Complete the GitHub OAuth login: verify CSRF state, exchange the code, and
 * mint a server-side session.
 *
 * Verification mirrors `beginLogin`: the state cookie (`nonce.sig`) is the
 * trust anchor. We require the cookie's signature to be a valid HMAC over its
 * own nonce AND that nonce to equal the nonce echoed back in the URL `state`.
 * Any mismatch, missing piece, or failed code exchange routes through
 * `rejectAndClearState` (4xx + clear cookie). A successful exchange whose
 * GET /user identity capture fails 303s to LOGIN_ERROR_PATH (the retry page)
 * having persisted nothing. On success we persist the tokens server-side (only
 * an opaque session id reaches the browser) and redirect to the sanitized
 * return path. Every exit clears the spent state cookie (withStateCleared).
 */
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
    return rejectAndClearState(400, "Invalid OAuth state");
  }

  const colon = stateParam.indexOf(":");
  const stateNonce = colon === -1 ? stateParam : stateParam.slice(0, colon);
  // The return segment is attacker-influenced transit data: malformed
  // percent-encoding (a link truncated by a mail client, or a crafted
  // callback) must not throw out of the handler as a raw 500 with the state
  // cookie left live. A segment that won't decode just means "no return
  // path" — whether the login proceeds is decided by the HMAC check below.
  let ret = "/";
  if (colon !== -1) {
    try {
      ret = decodeURIComponent(stateParam.slice(colon + 1));
    } catch {
      ret = "/";
    }
  }

  const dot = cookie.indexOf(".");
  if (dot === -1) return rejectAndClearState(400, "Invalid OAuth state");
  const nonce = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = await hmac(cfg.stateSigningKey, nonce);

  if (stateNonce !== nonce || !timingSafeEqual(expected, sig)) {
    return rejectAndClearState(400, "Invalid OAuth state");
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
      return rejectAndClearState(400, "Authorization failed");
    }
    throw e;
  }

  const refreshTtl = Number(
    (tokens.data as Record<string, unknown>).refresh_token_expires_in
  );
  const grant: Grant = {
    access_token: tokens.accessToken(),
    refresh_token: tokens.refreshToken(),
    expires_at: tokens.accessTokenExpiresAt().getTime(),
    // Fall back to the 180-day cookie horizon when GitHub omits the refresh
    // horizon (same value session.ts's DEFAULT_TTL uses).
    refresh_ttl: Number.isFinite(refreshTtl) ? refreshTtl : SESSION_COOKIE_MAX_AGE,
  };

  const safeRet = sanitizeReturnPath(ret, url.origin);

  // Capture reviewer identity here, with the fresh access token (the same GET
  // /user the lazy backfill makes for v1-era records). Capture is fatal on this
  // path: a session is never minted without knowing who it belongs to, so a
  // /user failure fails the whole login BEFORE createSession — no record
  // written, no session cookie set — and the page offers a clean retry through
  // /auth/login. The message is safe to log (fetchIdentity's own text, or a
  // runtime network error) — NEVER the token. No session id exists yet, so
  // there is no auditId to correlate; the return path is the useful breadcrumb.
  let identity: Identity;
  try {
    identity = await fetchIdentity(tokens.accessToken());
  } catch (e) {
    log.error("login failed: identity capture", {
      error: e instanceof Error ? e.constructor.name : typeof e,
      message: e instanceof Error ? e.message : String(e),
      return: safeRet,
    });
    // 303 to the retry page rather than rendering it here: the callback URL's
    // code and state are spent, so a page PARKED on it would dead-end on the
    // CSRF guard the moment the user refreshes. LOGIN_ERROR_PATH re-renders
    // safely on refresh, and its retry link re-enters /auth/login.
    const errorUrl = new URL(LOGIN_ERROR_PATH, url.origin);
    errorUrl.searchParams.set("return", safeRet);
    return withStateCleared(
      new Response(null, { status: 303, headers: { Location: errorUrl.toString() } })
    );
  }

  const sid = await createSession(store, grant, identity);

  log.info("login completed", { sessionId: auditId(sid), return: safeRet });

  const dest = new URL(safeRet, url.origin);
  const headers = new Headers({ Location: dest.toString() });
  headers.append(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, sid, {
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    })
  );
  return withStateCleared(new Response(null, { status: 302, headers }));
}

/**
 * Exchange a refresh token for a fresh `OAuth2Tokens` via GitHub. Thin wrapper
 * over arctic's `GitHub.refreshAccessToken`; the session layer owns persistence,
 * the dead-grant decision, and the refresh-race retry (see `session.ts`).
 */
export function refresh(
  cfg: Config,
  refreshToken: string
): Promise<arctic.OAuth2Tokens> {
  return gh(cfg).refreshAccessToken(refreshToken);
}
