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

export interface SessionData {
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
