import type { Config } from "./config";
import type { SessionData, SessionStore } from "./store";
import { refresh } from "./oauth";
import * as arctic from "arctic";

export type { SessionData } from "./store";

const DEFAULT_TTL = 60 * 60 * 24 * 180;
const SKEW_MS = 30_000;

function refreshTtlOf(tokens: arctic.OAuth2Tokens): number {
  const t = Number((tokens.data as Record<string, unknown>).refresh_token_expires_in);
  return Number.isFinite(t) ? t : DEFAULT_TTL;
}

export async function createSession(
  store: SessionStore,
  data: SessionData,
  refreshTtlSeconds = DEFAULT_TTL
): Promise<string> {
  const id = crypto.randomUUID() + crypto.randomUUID();
  await store.put(id, data, refreshTtlSeconds);
  return id;
}

async function doRefresh(
  cfg: Config,
  store: SessionStore,
  id: string,
  refreshToken: string
): Promise<string | null> {
  try {
    const tokens = await refresh(cfg, refreshToken);
    const next: SessionData = {
      access_token: tokens.accessToken(),
      refresh_token: tokens.refreshToken(),
      expires_at: tokens.accessTokenExpiresAt().getTime(),
    };
    await store.put(id, next, refreshTtlOf(tokens));
    return next.access_token;
  } catch (e) {
    // A network failure must NOT nuke the session -- let it surface as 5xx.
    if (e instanceof arctic.ArcticFetchError) throw e;
    // Any other arctic error (OAuth2RequestError, or a non-200/unexpected token
    // response which arctic v3 surfaces as UnexpectedResponseError /
    // UnexpectedErrorResponseBodyError) means the refresh token is dead ->
    // purge the session and force a full re-login.
    if (
      e instanceof arctic.OAuth2RequestError ||
      e instanceof arctic.UnexpectedResponseError ||
      e instanceof arctic.UnexpectedErrorResponseBodyError
    ) {
      await store.delete(id);
      return null;
    }
    throw e;
  }
}

export async function getValidAccessToken(
  cfg: Config,
  store: SessionStore,
  id: string,
  forceRefresh = false
): Promise<string | null> {
  const s = await store.get(id);
  if (!s) return null;

  if (!forceRefresh && Date.now() < s.expires_at - SKEW_MS) {
    return s.access_token;
  }

  return doRefresh(cfg, store, id, s.refresh_token);
}

export async function deleteSession(store: SessionStore, id: string): Promise<void> {
  await store.delete(id);
}
