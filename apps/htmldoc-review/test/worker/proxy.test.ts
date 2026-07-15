/// <reference types="@cloudflare/vitest-pool-workers/types" />
// vitest-pool-workers suite for the htmldoc-review Worker (Deliverable 1: proxy + auth).
//
// Everything outbound to GitHub is MOCKED via fetchMock -- the suite never touches
// the real network or needs real credentials. beforeAll activates the mock and
// disables net connect; afterEach asserts no pending interceptors so unused mocks
// (or accidental real-GitHub calls) fail loudly.
//
// Binding/secret/var names are taken verbatim from the LOCKED spec:
//   KV binding   SESSIONS  (key `sess:${id}`, value {access_token, refresh_token, expires_at})
//   session cookie  sid    (HttpOnly; Secure; SameSite=Lax; opaque id only)
//   vars  REPO_ORG / GITHUB_CLIENT_ID / CALLBACK_URL  (org-scoped: NO repo/branch)
//   routes /auth/login, /auth/callback, /auth/logout, catch-all doc path
//   doc URL  /{repo}/{...docPath}[?ref=branch|tag|sha]  (repo = first path segment)
import {
  env,
  SELF,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterAll, beforeAll, afterEach, describe, it, expect } from "vitest";
import worker, { type Env } from "../../src/worker/index";
// fetchMock used to come from "cloudflare:test" but was removed in
// vitest-pool-workers 0.13. This is a local globalThis.fetch shim with the
// same API + guarantees (see fetch-mock.ts).
import { fetchMock } from "./fetch-mock";

// Register the Worker's Env as the provided test env so env.SESSIONS / env.DOC_* are typed.
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

// ---------------------------------------------------------------------------
// Network isolation: no test may ever reach real GitHub.
// ---------------------------------------------------------------------------
beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => {
  // Any interceptor that was queued but not consumed (or any unmocked outbound
  // call) makes the suite fail here.
  fetchMock.assertNoPendingInterceptors();
});
afterAll(() => {
  // Restore the real globalThis.fetch the shim replaced.
  fetchMock.deactivate();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ORIGIN = "https://docs.my-org.dev";
// Repo is now the FIRST URL path segment; the doc path is the remainder.
const REPO = "app-ios";
const DOC_PATH = "guide.html";
// What a browser actually requests: /{repo}/{...docPath}.
const DOC_URL = `${REPO}/${DOC_PATH}`;
const KNOWN_TOKEN = "gho_canned_access_token";

const sessKey = (id: string) => `sess:${id}`;

interface SeededSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/** Seed a server-side KV session and return its id. Defaults to a non-expired token. */
async function seedSession(
  id: string,
  over: Partial<SeededSession> = {},
): Promise<string> {
  const data: SeededSession = {
    access_token: KNOWN_TOKEN,
    refresh_token: "refresh_canned",
    expires_at: Date.now() + 3_600_000, // 1h in the future
    ...over,
  };
  await env.SESSIONS.put(sessKey(id), JSON.stringify(data), {
    expirationTtl: 3600,
  });
  return id;
}

/**
 * Queue a single-use mock for the GitHub Contents API call.
 *
 * The interceptor path encodes the org-scoped routing contract: owner from env,
 * repo from the URL's first segment, then the doc path. `opts.ref` mirrors the
 * `?ref=` behaviour — when omitted, NO `?ref` is appended (GitHub serves the
 * default branch); when present it is percent-encoded so slashed branches work.
 */
function mockContents(
  status: number,
  body = "",
  opts: { contentType?: string; repo?: string; path?: string; ref?: string } = {},
) {
  const repo = opts.repo ?? REPO;
  const path = opts.path ?? DOC_PATH;
  const contentType = opts.contentType ?? "text/html";
  const query =
    opts.ref !== undefined ? `?ref=${encodeURIComponent(opts.ref)}` : "";
  fetchMock
    .get("https://api.github.com")
    .intercept({
      method: "GET",
      path: `/repos/${env.REPO_ORG}/${repo}/contents/${path}${query}`,
    })
    .reply(status, body, { headers: { "content-type": contentType } });
}

/**
 * Queue a single-use mock for the checkAccess PROBE that runs BEFORE
 * serveDoc on every authenticated doc request. The probe hits the SAME
 * Contents path fetchDoc uses (fetch-mock matches origin+method+path and ignores
 * the Accept header), so a doc-serve test must queue the probe FIRST and the
 * doc-fetch interceptor SECOND: the probe consumes the first matching
 * interceptor, the fetch the second. Queue them out of order and the probe would
 * eat the doc body mock. A denied probe (403/404) is the single interceptor —
 * serveDoc never runs, so no doc-fetch mock is queued at all.
 */
function mockProbe(
  status: number,
  opts: { repo?: string; path?: string; ref?: string } = {},
) {
  mockContents(status, "", opts);
}

/** Queue a single-use mock for the GitHub OAuth token endpoint (validate or refresh). */
function mockTokenEndpoint(status: number, body: unknown) {
  fetchMock
    .get("https://github.com")
    .intercept({ method: "POST", path: "/login/oauth/access_token" })
    .reply(status, body as any, {
      headers: { "content-type": "application/json" },
    });
}

/** Pull every Set-Cookie header out of a Response (Workers exposes getSetCookie). */
function setCookies(res: Response): string[] {
  const anyHeaders = res.headers as unknown as {
    getSetCookie?: () => string[];
  };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/** Find the Set-Cookie line that sets the given cookie name. */
function findCookie(res: Response, name: string): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

/** Extract the value of a named cookie from a Set-Cookie line. */
function cookieValue(setCookieLine: string): string {
  return setCookieLine.split(";")[0].split("=").slice(1).join("=");
}

/** Drive the Worker directly so we can flush ctx.waitUntil writes. */
async function fetchWorker(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// Whole-response leak scan: token must never appear anywhere visible to the browser.
async function assertNoTokenLeak(res: Response, token = KNOWN_TOKEN) {
  const headerDump = JSON.stringify([...res.headers]);
  expect(headerDump).not.toContain(token);
  const body = await res.clone().text();
  expect(body).not.toContain(token);
}

// ===========================================================================
// 200 path: raw HTML served, no token leak
// ===========================================================================
describe("doc route: 200 serves raw HTML", () => {
  it("returns upstream HTML verbatim with text/html and leaks no token", async () => {
    await seedSession("sess-200");
    mockProbe(200); // checkAccess probe (consumed first)
    mockContents(200, "<h1>hi</h1>");

    const res = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      headers: { cookie: "sid=sess-200" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/i);
    expect(await res.clone().text()).toBe("<h1>hi</h1>");
    await assertNoTokenLeak(res);
  });
});

// ===========================================================================
// Org-scoped routing: repo = first URL segment, doc path = remainder, ?ref=.
// ===========================================================================
describe("doc route: org-scoped repo + ?ref routing", () => {
  it("repo comes from the first path segment; any repo in the org is reachable", async () => {
    await seedSession("sess-repo");
    // A DIFFERENT repo than the default fixture, with a nested doc path.
    mockProbe(200, { repo: "app-android", path: "docs/setup.html" });
    mockContents(200, "<h1>other</h1>", {
      repo: "app-android",
      path: "docs/setup.html",
    });

    const res = await SELF.fetch(`${ORIGIN}/app-android/docs/setup.html`, {
      headers: { cookie: "sid=sess-repo" },
    });

    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe("<h1>other</h1>");
  });

  it("omitting ?ref sends NO ref param (GitHub serves the default branch)", async () => {
    await seedSession("sess-noref");
    // No `ref` in the mock -> interceptor path has no `?ref`. If the Worker
    // appended a ref, this interceptor would not match and the call would fail.
    mockProbe(200);
    mockContents(200, "<h1>default</h1>");

    const res = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      headers: { cookie: "sid=sess-noref" },
    });

    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe("<h1>default</h1>");
  });

  it("?ref with a slashed branch is percent-encoded for the Contents API", async () => {
    await seedSession("sess-ref");
    // Slashed branch must survive as feature%2Fa%2Fb in the upstream call.
    mockProbe(200, { ref: "feature/a/b" });
    mockContents(200, "<h1>branch</h1>", { ref: "feature/a/b" });

    const res = await SELF.fetch(`${ORIGIN}/${DOC_URL}?ref=feature/a/b`, {
      headers: { cookie: "sid=sess-ref" },
    });

    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe("<h1>branch</h1>");
  });

  it("a bare repo with no doc path -> neutral 404 (never calls Contents API)", async () => {
    await seedSession("sess-barerepo");
    // No interceptor queued: if the Worker hit GitHub, net-connect/afterEach fails.
    const res = await SELF.fetch(`${ORIGIN}/app-ios`, {
      headers: { cookie: "sid=sess-barerepo" },
    });

    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/not found or no access/i);
  });
});

// ===========================================================================
// 404 / 403 neutral: missing and forbidden are indistinguishable
// ===========================================================================
describe("doc route: 404/403 collapse to one neutral response", () => {
  it("404 from GitHub -> neutral 404 'not found or no access'", async () => {
    await seedSession("sess-404");
    // The checkAccess probe denies here; serveDoc never runs (no doc-fetch mock).
    mockProbe(404);

    const res = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      headers: { cookie: "sid=sess-404" },
    });

    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/not found or no access/i);
  });

  it("403 from GitHub -> identical neutral 404 (no distinct 403)", async () => {
    await seedSession("sess-403");
    // The checkAccess probe denies here; serveDoc never runs (no doc-fetch mock).
    mockProbe(403);

    const res = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      headers: { cookie: "sid=sess-403" },
    });

    // Must NOT surface 403 -- forbidden is laundered into the not-found page.
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(await res.text()).toMatch(/not found or no access/i);
  });

  it("missing (404) and forbidden (403) are byte-for-byte identical", async () => {
    await seedSession("sess-cmp-a");
    mockProbe(404);
    const missing = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      headers: { cookie: "sid=sess-cmp-a" },
    });
    const missingBody = await missing.text();

    await seedSession("sess-cmp-b");
    mockProbe(403);
    const forbidden = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      headers: { cookie: "sid=sess-cmp-b" },
    });
    const forbiddenBody = await forbidden.text();

    expect(missing.status).toBe(forbidden.status);
    expect(missingBody).toBe(forbiddenBody);
  });
});

// ===========================================================================
// No session -> redirect to login, and the Contents API is NOT called.
// ===========================================================================
describe("doc route: unauthenticated", () => {
  it("no cookie -> 302 to /auth/login and never calls Contents API", async () => {
    // Intentionally queue NO interceptor. If the handler hit GitHub, the
    // disabled net connect would throw; afterEach also asserts nothing pending.
    const res = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/auth\/login/);
  });

  it("preserves a return-to pointing back at the requested path", async () => {
    const res = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    // The original path should be recoverable from the redirect target.
    expect(decodeURIComponent(loc)).toContain(`/${DOC_PATH}`);
  });

  it("a session id with no KV row -> 302 to login (treated as no session)", async () => {
    const res = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      redirect: "manual",
      headers: { cookie: "sid=does-not-exist" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/auth\/login/);
  });
});

// ===========================================================================
// Silent refresh (tier 1): expired access token -> one refresh, then 200,
// with the ROTATED refresh token persisted back to KV.
// ===========================================================================
describe("silent refresh (tier 1)", () => {
  it("expired access -> exactly one refresh POST -> 200, new+rotated token in KV", async () => {
    await env.SESSIONS.put(
      sessKey("sess-refresh"),
      JSON.stringify({
        access_token: "old_access",
        refresh_token: "r1",
        expires_at: 0, // already expired
      }),
      { expirationTtl: 60 },
    );

    // GitHub rotates the refresh token on refresh: new access + new refresh.
    mockTokenEndpoint(200, {
      access_token: "new",
      refresh_token: "r2",
      expires_in: 28800, // 8h access life
      refresh_token_expires_in: 15897600, // ~6mo refresh horizon
      token_type: "bearer",
    });
    // The refresh happens in getValidAccessToken (token resolution) BEFORE the
    // probe, so the probe already sees the fresh token. Order: token POST,
    // then probe(200), then the doc fetch(200).
    mockProbe(200);
    mockContents(200, "<h1>refreshed</h1>");

    // Use worker.fetch + waitOnExecutionContext so a ctx.waitUntil write-back flushes.
    const res = await fetchWorker(`${ORIGIN}/${DOC_URL}`, {
      headers: { cookie: "sid=sess-refresh" },
    });

    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe("<h1>refreshed</h1>");

    // KV now holds the NEW access token AND the ROTATED refresh token.
    const storedRaw = await env.SESSIONS.get(sessKey("sess-refresh"));
    expect(storedRaw).not.toBeNull();
    const stored = JSON.parse(storedRaw!);
    expect(stored.access_token).toBe("new");
    expect(stored.refresh_token).toBe("r2");
    expect(stored.expires_at).toBeGreaterThan(Date.now());

    // Both interceptors (refresh + contents) consumed exactly once -> afterEach
    // assertNoPendingInterceptors enforces "exactly one refresh POST".
    await assertNoTokenLeak(res, "new");
  });
});

// ===========================================================================
// Re-login (tier 2): dead/revoked refresh token -> 302 to login, not a 5xx.
// ===========================================================================
describe("re-login (tier 2)", () => {
  it("refresh token rejected (invalid_grant) -> 302 to /auth/login, session purged", async () => {
    await env.SESSIONS.put(
      sessKey("sess-dead"),
      JSON.stringify({
        access_token: "old_access",
        refresh_token: "dead",
        expires_at: 0,
      }),
      { expirationTtl: 60 },
    );

    // arctic surfaces this as OAuth2RequestError -> handler bounces to re-login.
    mockTokenEndpoint(400, {
      error: "bad_refresh_token",
      error_description: "The refresh token passed is incorrect or expired.",
    });

    const res = await fetchWorker(`${ORIGIN}/${DOC_URL}`, {
      headers: { cookie: "sid=sess-dead" },
    });

    expect(res.status).toBe(302);
    expect(res.status).toBeLessThan(500);
    expect(res.headers.get("location")).toMatch(/\/auth\/login/);

    // The dead session may be deleted.
    const stored = await env.SESSIONS.get(sessKey("sess-dead"));
    expect(stored).toBeNull();
  });
});

// ===========================================================================
// /auth/login: mints a signed, short-lived oauth_state cookie and redirects.
// ===========================================================================
describe("/auth/login", () => {
  it("sets a short-lived signed oauth_state cookie and 302s to GitHub authorize", async () => {
    const res = await SELF.fetch(`${ORIGIN}/auth/login`, {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toMatch(/github\.com\/login\/oauth\/authorize/i);
    // The minted state must be carried as ?state= in the authorize URL.
    const stateInUrl = new URL(loc).searchParams.get("state");
    expect(stateInUrl).toBeTruthy();

    const stateCookie = findCookie(res, "oauth_state");
    expect(stateCookie, "oauth_state cookie must be set").toBeTruthy();
    // Signed value is nonce.sig -> contains a separator and is non-trivial.
    const value = cookieValue(stateCookie!);
    expect(value).toContain(".");
    expect(value.length).toBeGreaterThan(20);
    // The cookie nonce must match the state put in the authorize URL.
    expect(value.startsWith(`${stateInUrl}.`)).toBe(true);

    // Short-lived + locked-down attributes.
    expect(stateCookie).toMatch(/HttpOnly/i);
    expect(stateCookie).toMatch(/Secure/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);
    expect(stateCookie).toMatch(/Max-Age=\d+/i);
  });
});

// ===========================================================================
// /auth/callback CSRF: tampered / absent / mismatched state is rejected (4xx)
// and the state cookie is burned. A valid state is accepted exactly once.
// ===========================================================================
describe("/auth/callback CSRF state mint+verify+burn", () => {
  // Run a real login to obtain a genuinely-signed oauth_state cookie/nonce.
  async function mintState(): Promise<{ nonce: string; cookie: string }> {
    const res = await SELF.fetch(`${ORIGIN}/auth/login`, {
      redirect: "manual",
    });
    const setCookie = findCookie(res, "oauth_state")!;
    const value = cookieValue(setCookie);
    const nonce = value.split(".")[0];
    // Reconstruct the cookie header the browser would send back.
    return { nonce, cookie: `oauth_state=${value}` };
  }

  it("absent state cookie -> rejected 4xx (no token exchange attempted)", async () => {
    const res = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&state=whatever`,
      { redirect: "manual" },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // No token endpoint mock queued -> any exchange would fail net-connect/afterEach.
  });

  it("mismatched state (cookie nonce != ?state) -> rejected 4xx and burns cookie", async () => {
    const { cookie } = await mintState();
    const res = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&state=not-the-nonce`,
      { redirect: "manual", headers: { cookie } },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    // Cookie is burned (cleared) on rejection.
    const burned = findCookie(res, "oauth_state");
    expect(burned, "oauth_state should be cleared on reject").toBeTruthy();
    expect(burned).toMatch(/Max-Age=0/i);
  });

  it("tampered signature -> rejected 4xx (HMAC verify fails)", async () => {
    const { nonce } = await mintState();
    // Keep the real nonce, corrupt the signature half.
    const tamperedCookie = `oauth_state=${nonce}.AAAAtampered_sig`;
    const res = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&state=${nonce}`,
      { redirect: "manual", headers: { cookie: tamperedCookie } },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("missing code -> rejected 4xx", async () => {
    const { nonce, cookie } = await mintState();
    const res = await SELF.fetch(`${ORIGIN}/auth/callback?state=${nonce}`, {
      redirect: "manual",
      headers: { cookie },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("valid state accepted exactly once; replay of the same state fails", async () => {
    const { nonce, cookie } = await mintState();

    // First callback: valid state + a successful token exchange.
    mockTokenEndpoint(200, {
      access_token: "gho_first_login",
      refresh_token: "refresh_first",
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
      token_type: "bearer",
    });

    const first = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=goodcode&state=${nonce}`,
      { redirect: "manual", headers: { cookie } },
    );
    // Success path redirects (back to / or return-to).
    expect(first.status).toBe(302);
    // State cookie burned after a successful verify-and-burn.
    const burned = findCookie(first, "oauth_state");
    expect(burned).toBeTruthy();
    expect(burned).toMatch(/Max-Age=0/i);

    // Replay: the browser no longer holds the burned cookie, so resend WITHOUT it.
    // No token mock queued -> a second exchange would fail loudly.
    const replay = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=goodcode&state=${nonce}`,
      { redirect: "manual" },
    );
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(replay.status).toBeLessThan(500);
  });

  it("token exchange OAuth error (bad code) -> 4xx, cookie burned", async () => {
    const { nonce, cookie } = await mintState();
    mockTokenEndpoint(400, {
      error: "bad_verification_code",
      error_description: "The code passed is incorrect or expired.",
    });
    const res = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=stale&state=${nonce}`,
      { redirect: "manual", headers: { cookie } },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ===========================================================================
// Post-install redirect: with request_oauth_on_install GitHub sends the admin
// to /auth/callback?setup_action=install&installation_id=... with NO state
// cookie. That must NOT hit the CSRF guard ("Invalid OAuth state"); it shows a
// friendly 200 confirmation and exchanges no code.
// ===========================================================================
describe("/auth/callback post-install redirect", () => {
  it("setup_action present + no state -> friendly 200 (not the CSRF 4xx)", async () => {
    const res = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=abc&installation_id=143610512&setup_action=install`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toMatch(/installed/i);
    expect(body).not.toMatch(/Invalid OAuth state/i);
    // No token endpoint mock queued -> proves no code exchange was attempted.
  });
});

// ===========================================================================
// Session cookie shape + server-side token storage after a successful callback.
// ===========================================================================
describe("session cookie shape + KV storage after callback", () => {
  async function loginThenCallback() {
    // mint state
    const loginRes = await SELF.fetch(`${ORIGIN}/auth/login`, {
      redirect: "manual",
    });
    const stateCookieLine = findCookie(loginRes, "oauth_state")!;
    const value = cookieValue(stateCookieLine);
    const nonce = value.split(".")[0];

    // successful token exchange
    mockTokenEndpoint(200, {
      access_token: "gho_super_secret_access",
      refresh_token: "gho_super_secret_refresh",
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
      token_type: "bearer",
    });

    const cb = await SELF.fetch(
      `${ORIGIN}/auth/callback?code=goodcode&state=${nonce}`,
      { redirect: "manual", headers: { cookie: `oauth_state=${value}` } },
    );
    return cb;
  }

  it("session cookie carries ONLY the opaque id with HttpOnly/Secure/SameSite=Lax", async () => {
    const cb = await loginThenCallback();
    expect(cb.status).toBe(302);

    const sidCookie = findCookie(cb, "sid");
    expect(sidCookie, "session cookie 'sid' must be set").toBeTruthy();

    const id = cookieValue(sidCookie!);
    // Opaque + high entropy; NOT the token.
    expect(id.length).toBeGreaterThanOrEqual(20);
    expect(id).not.toContain("gho_super_secret_access");
    expect(id).not.toContain("gho_super_secret_refresh");

    // Attributes per spec.
    expect(sidCookie).toMatch(/HttpOnly/i);
    expect(sidCookie).toMatch(/Secure/i);
    expect(sidCookie).toMatch(/SameSite=Lax/i);
    expect(sidCookie).toMatch(/Path=\//i);
  });

  it("no GitHub token appears in any Set-Cookie, header, or body", async () => {
    const cb = await loginThenCallback();

    const allCookies = setCookies(cb).join("\n");
    expect(allCookies).not.toContain("gho_super_secret_access");
    expect(allCookies).not.toContain("gho_super_secret_refresh");

    const headerDump = JSON.stringify([...cb.headers]);
    expect(headerDump).not.toContain("gho_super_secret_access");
    expect(headerDump).not.toContain("gho_super_secret_refresh");

    const body = await cb.text();
    expect(body).not.toContain("gho_super_secret_access");
    expect(body).not.toContain("gho_super_secret_refresh");
  });

  it("token is stored SERVER-SIDE in KV under sess:<id> as {access_token, refresh_token, expires_at}", async () => {
    const cb = await loginThenCallback();
    const id = cookieValue(findCookie(cb, "sid")!);

    const raw = await env.SESSIONS.get(sessKey(id), "json");
    expect(raw).not.toBeNull();
    const stored = raw as SeededSession;
    expect(stored.access_token).toBe("gho_super_secret_access");
    expect(stored.refresh_token).toBe("gho_super_secret_refresh");
    expect(typeof stored.expires_at).toBe("number");
    expect(stored.expires_at).toBeGreaterThan(Date.now());
  });
});

// ===========================================================================
// checkAccess probe 401: a session token GitHub rejects (revoked/rotated
// server-side) while its stored expiry still looks valid must force ONE
// refresh and re-probe — not collapse straight to the neutral 404. A bearer
// has no session to refresh, so its 401 probe IS the neutral 404.
// ===========================================================================
describe("checkAccess probe 401 (locally-valid session token GitHub rejects)", () => {
  it("probe 401 -> one refresh -> re-probe 200 -> doc served, rotated pair in KV", async () => {
    // Locally valid (unexpired) session whose token GitHub no longer accepts:
    // the clock check passes, so no proactive refresh runs before the probe.
    await seedSession("sess-probe-401", {
      access_token: "revoked_access",
      refresh_token: "r1",
    });

    // Order matters (fetch-mock is a FIFO per origin+method+path): the first
    // probe consumes the 401, the token POST refreshes, the second probe sees
    // 200 with the fresh token, then serveDoc fetches the doc body.
    mockProbe(401);
    mockTokenEndpoint(200, {
      access_token: "fresh_access",
      refresh_token: "r2",
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
      token_type: "bearer",
    });
    mockProbe(200);
    mockContents(200, "<h1>re-authed</h1>");

    // fetchWorker so the KV write-back in ctx.waitUntil flushes.
    const res = await fetchWorker(`${ORIGIN}/${DOC_URL}`, {
      headers: { cookie: "sid=sess-probe-401" },
    });

    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe("<h1>re-authed</h1>");

    // The forced refresh persisted the NEW access token and ROTATED refresh
    // token; afterEach's assertNoPendingInterceptors enforces "exactly one
    // refresh POST" (and exactly two probes).
    const storedRaw = await env.SESSIONS.get(sessKey("sess-probe-401"));
    expect(storedRaw).not.toBeNull();
    const stored = JSON.parse(storedRaw!);
    expect(stored.access_token).toBe("fresh_access");
    expect(stored.refresh_token).toBe("r2");
    await assertNoTokenLeak(res, "fresh_access");
  });

  it("bearer probe 401 -> neutral 404, no token endpoint call", async () => {
    // A bearer credential has no session to refresh: the single 401 probe is
    // the only outbound call (no token mock queued — a refresh attempt would
    // fail net-connect/afterEach), and the caller gets the uniform neutral 404.
    mockProbe(401);

    const res = await SELF.fetch(`${ORIGIN}/${DOC_URL}`, {
      headers: { Authorization: "Bearer gho_agent_rejected" },
    });

    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/not found or no access/i);
  });
});

// ===========================================================================
// /auth/logout: deletes the KV session and clears the cookie (Max-Age=0).
// ===========================================================================
describe("/auth/logout", () => {
  it("deletes the KV session and clears the sid cookie", async () => {
    await seedSession("sess-logout");

    const res = await SELF.fetch(`${ORIGIN}/auth/logout`, {
      redirect: "manual",
      headers: { cookie: "sid=sess-logout" },
    });

    // KV row gone.
    expect(await env.SESSIONS.get(sessKey("sess-logout"))).toBeNull();

    // Cookie cleared.
    const cleared = findCookie(res, "sid");
    expect(cleared, "logout should clear the sid cookie").toBeTruthy();
    expect(cleared).toMatch(/Max-Age=0/i);
  });
});
