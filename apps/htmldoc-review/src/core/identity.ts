// Capture the logged-in reviewer's GitHub identity via a single GET /user.
//
// Portable by construction — Web `fetch` only, no Cloudflare types — so both
// completeLogin (login-time capture) and session.ts (lazy on-read backfill of a
// pre-identity record) call it. It NEVER returns a placeholder: a non-2xx status
// or a network failure throws, leaving the caller to decide what to do with the
// failure (completeLogin swallows so a transient /user error can't block login;
// getIdentity propagates so it can't stamp a placeholder onto a real reviewer).
// The token is used only in the Authorization header — never logged.
import type { Identity } from "./store";

const USER_URL = "https://api.github.com/user";

/** GET /user with `token`, returning {login, name, id}. Throws on any failure. */
export async function fetchIdentity(token: string): Promise<Identity> {
  const res = await fetch(USER_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "htmldoc-review-worker",
    },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GET /user failed with status ${res.status}`);
  }
  const body = (await res.json()) as { login: string; name: string | null; id: number };
  return { login: body.login, name: body.name ?? null, id: body.id };
}
