import type { SessionData, SessionStore } from "../core/store";

const key = (id: string) => `sess:${id}`;
const MIN_TTL = 60;
const DEFAULT_TTL = 60 * 60 * 24 * 180;

function clampTtl(seconds: number): number {
  return Number.isFinite(seconds) && seconds >= MIN_TTL ? Math.floor(seconds) : DEFAULT_TTL;
}

/**
 * SessionStore backed by Workers KV. Native per-key TTL is the entire cleanup
 * story — no DO/D1/cron. This adapter is the ONLY place the core touches a
 * KVNamespace; everything in src/core stays portable.
 */
export class KvSessionStore implements SessionStore {
  constructor(private kv: KVNamespace) {}

  get(id: string): Promise<SessionData | null> {
    return this.kv.get<SessionData>(key(id), "json");
  }

  async put(id: string, data: SessionData, ttlSeconds: number): Promise<void> {
    await this.kv.put(key(id), JSON.stringify(data), { expirationTtl: clampTtl(ttlSeconds) });
  }

  async delete(id: string): Promise<void> {
    await this.kv.delete(key(id));
  }
}
