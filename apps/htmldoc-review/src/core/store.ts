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

/**
 * The ONLY form of a session id that may appear in a log line. The full id is
 * the credential the cookie carries — logging it would put a working session
 * token in every log sink. An 8-char prefix of the UUID (32 of 122 random bits)
 * is useless for reconstruction but still correlates the log lines of one
 * session.
 */
export function auditId(id: SessionId): string {
  return id.slice(0, 8);
}

// Captured GitHub identity for the logged-in reviewer. Minted once from GET
// /user at login time (completeLogin — a capture failure fails the login) and
// carried on the session for its lifetime. `name` may be null (GitHub users
// can leave their display name blank); `id` is the stable numeric key we'd
// reconcile on if a login is ever renamed. Never a token.
export interface Identity {
  login: string;
  name: string | null;
  id: number;
}

// The session record. Older records in KV can lack fields (a pre-identity
// Deliverable 1 blob has no `version`/`iat`/`identity`), so reads normalize the
// missing fields (version -> 1, iat -> 0, identity -> null). The type keeps
// them required because persist() (session.ts) is the ONLY writer and always
// emits the full shape. NB: there is no `refresh_ttl` field — the KV
// expirationTtl is write-only (not readable back).
export interface SessionData {
  version: number;
  iat: number;
  // null only for a record that predates fatal identity capture (completeLogin
  // fails a login whose GET /user fails, so it never writes one). Such records
  // never serve a request: getValidAccessToken deletes them on read, forcing a
  // fresh login — which is why every read site past token resolution may
  // assume the identity is present.
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
