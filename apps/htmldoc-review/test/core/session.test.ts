// Unit tests for the single-writer session core (PR5). Plain Node / vanilla
// Vitest — no Miniflare: persist(), the SESSION_VALID_SINCE cutoff, and the lazy
// identity backfill are portable logic over the SessionStore seam. The only
// external dependency is GET /user, which we stub on globalThis.fetch. doRefresh
// (which reaches arctic/GitHub) is covered by the worker proxy suite instead.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  persist,
  createSession,
  getValidAccessToken,
  getIdentity,
  type Grant,
} from "../../src/core/session";
import {
  asSessionId,
  type Identity,
  type SessionData,
  type SessionId,
  type SessionStore,
} from "../../src/core/store";
import type { Config } from "../../src/core/config";

// The safe-side backfill horizon (session.ts DEFAULT_TTL): 180 days in seconds.
const DEFAULT_TTL = 60 * 60 * 24 * 180;

// A SessionStore backed by a Map that also CAPTURES every (data, ttl) pair passed
// to put() and every delete() — so tests can assert the backfill TTL and the
// delete-on-read cutoff directly.
class CapturingStore implements SessionStore {
  readonly map = new Map<string, SessionData>();
  readonly puts: { id: string; data: SessionData; ttl: number }[] = [];
  readonly deletes: string[] = [];

  async get(id: SessionId): Promise<SessionData | null> {
    return this.map.get(id) ?? null;
  }
  async put(id: SessionId, data: SessionData, ttlSeconds: number): Promise<void> {
    this.map.set(id, data);
    this.puts.push({ id, data, ttl: ttlSeconds });
  }
  async delete(id: SessionId): Promise<void> {
    this.map.delete(id);
    this.deletes.push(id);
  }
}

function cfg(sessionValidSince = 0): Config {
  return {
    githubClientId: "cid",
    githubClientSecret: "secret",
    callbackUrl: "https://x/auth/callback",
    stateSigningKey: "k",
    repoOrg: "my-org",
    sessionValidSince,
  };
}

function grant(over: Partial<Grant> = {}): Grant {
  return {
    access_token: "at",
    refresh_token: "rt",
    expires_at: Date.now() + 3_600_000,
    refresh_ttl: 999,
    ...over,
  };
}

const IDENTITY: Identity = { login: "octocat", name: "Mona Lisa", id: 583231 };

/** Stub GET /user. `mode` picks a 200 body or a non-2xx failure. */
function stubUser(mode: { ok: true; identity: Identity } | { ok: false; status: number }) {
  const fn = vi.fn(async () => {
    if (mode.ok) {
      return new Response(JSON.stringify(mode.identity), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("nope", { status: mode.status });
  });
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persist() — the single SessionData writer", () => {
  it("mints a brand-new record (null prior): iat≈now, version 2, identity from the arg, tokens from the grant", async () => {
    const store = new CapturingStore();
    const id = asSessionId("s1");
    const before = Date.now();
    const data = await persist(store, id, grant({ access_token: "AAA", refresh_token: "RRR" }), null, IDENTITY);

    expect(data.version).toBe(2);
    expect(data.iat).toBeGreaterThanOrEqual(before);
    expect(data.iat).toBeLessThanOrEqual(Date.now());
    expect(data.identity).toEqual(IDENTITY);
    expect(data.access_token).toBe("AAA");
    expect(data.refresh_token).toBe("RRR");
    // The grant's refresh_ttl is what reaches store.put.
    expect(store.puts.at(-1)!.ttl).toBe(999);
  });

  it("mints identity:null when no identity arg is supplied", async () => {
    const store = new CapturingStore();
    const data = await persist(store, asSessionId("s2"), grant(), null);
    expect(data.identity).toBeNull();
  });

  it("PINS iat to prior.iat on a replace (a refresh can never bump it)", async () => {
    const store = new CapturingStore();
    const prior: SessionData = {
      version: 2,
      iat: 111,
      identity: IDENTITY,
      access_token: "old",
      refresh_token: "oldr",
      expires_at: 222,
    };
    // Refresh-shaped call: fresh grant, prior record, NO identity arg.
    const data = await persist(store, asSessionId("s3"), grant({ access_token: "new" }), prior);
    expect(data.iat).toBe(111); // pinned, not re-minted
    expect(data.identity).toEqual(IDENTITY); // carried from prior
    expect(data.access_token).toBe("new"); // token supplied fresh
  });

  it("carries prior.identity but a fresher identity arg wins", async () => {
    const store = new CapturingStore();
    const prior: SessionData = {
      version: 2,
      iat: 5,
      identity: IDENTITY,
      access_token: "a",
      refresh_token: "r",
      expires_at: 9,
    };
    const fresher: Identity = { login: "new-login", name: "New Name", id: 42 };
    const data = await persist(store, asSessionId("s4"), grant(), prior, fresher);
    expect(data.identity).toEqual(fresher);
  });
});

describe("createSession() — mints an id then delegates to persist", () => {
  it("writes a v2 record with the login-time identity and returns the id", async () => {
    const store = new CapturingStore();
    const id = await createSession(store, grant(), IDENTITY);
    const rec = store.map.get(id)!;
    expect(rec.version).toBe(2);
    expect(rec.identity).toEqual(IDENTITY);
    expect(typeof id).toBe("string");
  });
});

describe("getValidAccessToken() — SESSION_VALID_SINCE cutoff", () => {
  it("deletes-on-read and returns null when iat < cutoff (no GitHub call)", async () => {
    const fetchSpy = stubUser({ ok: true, identity: IDENTITY });
    const store = new CapturingStore();
    const id = asSessionId("cut");
    await persist(store, id, grant({ expires_at: Date.now() + 3_600_000 }), { iat: 1000 } as SessionData);
    // persist pinned iat=1000 (from prior); cutoff 2000 evicts it.
    const token = await getValidAccessToken(cfg(2000), store, id);
    expect(token).toBeNull();
    expect(store.deletes).toContain(id);
    expect(store.map.has(id)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the cached token when iat ≥ cutoff and the access token is unexpired (no refresh)", async () => {
    const fetchSpy = stubUser({ ok: true, identity: IDENTITY });
    const store = new CapturingStore();
    const id = asSessionId("live");
    await persist(store, id, grant({ access_token: "cached", expires_at: Date.now() + 3_600_000 }), { iat: 5000 } as SessionData);
    const token = await getValidAccessToken(cfg(1000), store, id);
    expect(token).toBe("cached");
    expect(store.deletes).not.toContain(id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("getIdentity() — lazy on-read backfill", () => {
  it("upgrades a v1 record in place: GET /user, write-back version 2 + identity at DEFAULT_TTL, tokens unchanged", async () => {
    const fetchSpy = stubUser({ ok: true, identity: IDENTITY });
    const store = new CapturingStore();
    const id = asSessionId("v1");
    // A legacy (v1) blob: no version/iat/identity, just the token triple.
    store.map.set(id, {
      access_token: "legacy-at",
      refresh_token: "legacy-rt",
      expires_at: 12345,
    } as unknown as SessionData);

    const identity = await getIdentity(cfg(), store, id, "legacy-at");
    expect(identity).toEqual(IDENTITY);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const upgraded = store.map.get(id)!;
    expect(upgraded.version).toBe(2);
    expect(upgraded.identity).toEqual(IDENTITY);
    expect(upgraded.access_token).toBe("legacy-at"); // token triple carried unchanged
    expect(upgraded.refresh_token).toBe("legacy-rt");
    expect(upgraded.expires_at).toBe(12345);
    expect(typeof upgraded.iat).toBe("number");

    // A SINGLE write-back, and its KV TTL is DEFAULT_TTL — the safe-side horizon
    // that can only LENGTHEN a session we just proved live, never truncate it to
    // the access token's short expiry. This is the blocking-fix guard.
    expect(store.puts).toHaveLength(1);
    expect(store.puts[0].ttl).toBe(DEFAULT_TTL);
  });

  it("returns a present identity WITHOUT any GET /user", async () => {
    const fetchSpy = stubUser({ ok: true, identity: IDENTITY });
    const store = new CapturingStore();
    const id = asSessionId("v2");
    await persist(store, id, grant(), null, IDENTITY);
    store.puts.length = 0; // ignore the seed write

    const identity = await getIdentity(cfg(), store, id, "at");
    expect(identity).toEqual(IDENTITY);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.puts).toHaveLength(0); // no write-back
  });

  it("returns null when the record is gone", async () => {
    stubUser({ ok: true, identity: IDENTITY });
    const store = new CapturingStore();
    expect(await getIdentity(cfg(), store, asSessionId("missing"), "at")).toBeNull();
  });

  it("PROPAGATES a GET /user failure — no placeholder stamp, record preserved", async () => {
    const fetchSpy = stubUser({ ok: false, status: 500 });
    const store = new CapturingStore();
    const id = asSessionId("v1-fail");
    store.map.set(id, {
      access_token: "at",
      refresh_token: "rt",
      expires_at: 999,
    } as unknown as SessionData);

    await expect(getIdentity(cfg(), store, id, "at")).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // The record is untouched: no delete, no placeholder write-back.
    expect(store.deletes).toHaveLength(0);
    expect(store.puts).toHaveLength(0);
    expect(store.map.get(id)!.identity).toBeUndefined();
  });
});
