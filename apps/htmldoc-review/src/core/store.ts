// The seam that keeps core portable. Core's session logic (refresh, expiry)
// operates on this interface; the Worker implements it with Workers KV, and a
// future local pipeline can implement it with memory or a file. Core never
// touches a KVNamespace directly.
export interface SessionData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface SessionStore {
  get(id: string): Promise<SessionData | null>;
  /** Persist `data` for `ttlSeconds`; implementations enforce their own min TTL. */
  put(id: string, data: SessionData, ttlSeconds: number): Promise<void>;
  delete(id: string): Promise<void>;
}
