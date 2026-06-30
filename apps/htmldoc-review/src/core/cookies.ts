// Cookie names and the read/build/clear helpers the auth flow shares. Reading
// and serializing both go through the tiny standard `cookie` package so there
// is exactly one source of truth for cookie syntax (and one place to audit for
// leaks); only the small set of attributes we actually use is exposed.
import {
  parseCookie,
  stringifySetCookie,
  type SetCookie,
} from "cookie";

export const SESSION_COOKIE = "sid";
export const STATE_COOKIE = "oauth_state";

// The state cookie is scoped to the OAuth routes only — it has no reason to be
// sent on doc requests. Both the mint (beginLogin) and the clear path use this
// so they stay in lockstep (a mismatched Path would orphan an uncleared cookie).
export const STATE_COOKIE_PATH = "/auth";

/**
 * Thrown when a `Cookie` request header is present but cannot be parsed. We
 * surface a malformed header as a typed error (not a silent `null`) so the
 * Worker entrypoint can log it and map it to a response, rather than treating
 * a corrupt header as "no cookie" and silently dropping the user's session.
 * An ABSENT cookie is not an error — `readCookie` returns `null` for that.
 */
export class CookieParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CookieParseError";
  }
}

/**
 * Read a single named cookie from the request.
 *
 * Returns `null` when the cookie is genuinely absent (no `Cookie` header, or
 * the header has no entry for `name`) — that is a normal, expected state, not
 * an error. Throws {@link CookieParseError} only when a header IS present but
 * the parser cannot make sense of it, so a corrupt header never masquerades as
 * "logged out".
 *
 * @throws {CookieParseError} if the `Cookie` header is present but unparseable.
 */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie");
  if (!header) return null;
  let jar: Record<string, string | undefined>;
  try {
    jar = parseCookie(header);
  } catch (cause) {
    throw new CookieParseError("could not parse Cookie header", { cause });
  }
  return jar[name] ?? null;
}

/**
 * Serialize a `Set-Cookie` header value with our locked-down defaults
 * (HttpOnly, Secure, SameSite=Lax). Callers pass only `name`, `value`, and the
 * attributes that vary (`path`, `maxAge`). Routing all Set-Cookie construction
 * through here keeps attribute strings out of the call sites and consistent.
 */
export function serializeCookie(
  name: string,
  value: string,
  opts: { path: string; maxAge: number },
): string {
  const cookie: SetCookie = {
    name,
    value,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: opts.path,
    maxAge: opts.maxAge,
  };
  return stringifySetCookie(cookie);
}

/**
 * Build a `Set-Cookie` string that clears `name`: empty value + `Max-Age=0`
 * tells the browser to delete it immediately. `path` MUST match the path the
 * cookie was set with, or the browser will not consider it the same cookie.
 */
export function clearCookieString(name: string, path: string): string {
  return serializeCookie(name, "", { path, maxAge: 0 });
}
