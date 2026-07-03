// The seam that keeps core portable. Core's session logic (refresh, expiry)
// operates on this interface; the Worker implements it with Workers KV, and a
// future local pipeline can implement it with memory or a file. Core never
// touches a KVNamespace directly.
// A session id is an opaque lookup key, never a token. The brand keeps a raw
// `string` from being passed where a vetted session id is expected: the only
// way to get one is `asSessionId`, applied where an id originates (a freshly
// minted UUID, or the value read out of the session cookie).
export type SessionId = string & { readonly __brand: "SessionId" };

/** Brand a raw string as a SessionId. Use only where the id originates. */
export function asSessionId(raw: string): SessionId {
  return raw as SessionId;
}

// Captured GitHub identity for the logged-in reviewer. Minted once from GET
// /user (login-time in completeLogin, or a lazy on-read backfill for a
// pre-identity record) and carried on the session for its lifetime. `name` may
// be null (GitHub users can leave their display name blank); `id` is the stable
// numeric key we'd reconcile on if a login is ever renamed. Never a token.
export interface Identity {
  login: string;
  name: string | null;
  id: number;
}

// The session record. Two eras coexist in KV: pre-identity (version 1) records
// shipped by Deliverable 1 lack `version`/`iat`/`identity`, so every read site
// normalizes the missing fields (version -> 1, iat -> 0, identity -> null). The
// type keeps them required because persist() (session.ts) is the ONLY writer and
// always emits the full shape — a v1 record only ever exists until its first
// read, which upgrades it in place. NB: there is no `refresh_ttl` field — the KV
// expirationTtl is write-only (not readable back), so the lazy-upgrade path
// derives its TTL explicitly (session.ts grantFrom) rather than round-tripping it.
export interface SessionData {
  version: number;
  iat: number;
  identity: Identity | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface SessionStore {
  get(id: SessionId): Promise<SessionData | null>;
  /** Persist `data` for `ttlSeconds`; implementations enforce their own min TTL. */
  put(id: SessionId, data: SessionData, ttlSeconds: number): Promise<void>;
  delete(id: SessionId): Promise<void>;
}
