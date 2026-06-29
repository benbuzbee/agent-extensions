import type { Env } from "./index";
import { refresh } from "./oauth";
import * as arctic from "arctic";

export interface SessionData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const key = (id: string) => `sess:${id}`;

const MIN_TTL = 60;
const DEFAULT_TTL = 60 * 60 * 24 * 180;
const SKEW_MS = 30_000;

function ttlOf(seconds: number | undefined): number {
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= MIN_TTL) {
    return Math.floor(seconds);
  }
  return DEFAULT_TTL;
}

export async function createSession(
  env: Env,
  data: SessionData,
  refreshTtlSeconds?: number
): Promise<string> {
  const id = crypto.randomUUID() + crypto.randomUUID();
  await env.SESSIONS.put(key(id), JSON.stringify(data), {
    expirationTtl: ttlOf(refreshTtlSeconds),
  });
  return id;
}

async function doRefresh(
  env: Env,
  id: string,
  refreshToken: string
): Promise<string | null> {
  try {
    const tokens = await refresh(env, refreshToken);
    const next: SessionData = {
      access_token: tokens.accessToken(),
      refresh_token: tokens.refreshToken(),
      expires_at: tokens.accessTokenExpiresAt().getTime(),
    };
    const refreshTtl = Number(
      (tokens.data as Record<string, unknown>).refresh_token_expires_in
    );
    await env.SESSIONS.put(key(id), JSON.stringify(next), {
      expirationTtl: ttlOf(Number.isFinite(refreshTtl) ? refreshTtl : undefined),
    });
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
      await deleteSession(env, id);
      return null;
    }
    throw e;
  }
}

export async function getValidAccessToken(
  env: Env,
  id: string,
  _ctx: ExecutionContext,
  forceRefresh = false
): Promise<string | null> {
  const s = await env.SESSIONS.get<SessionData>(key(id), "json");
  if (!s) return null;

  if (!forceRefresh && Date.now() < s.expires_at - SKEW_MS) {
    return s.access_token;
  }

  return doRefresh(env, id, s.refresh_token);
}

export async function deleteSession(env: Env, id: string): Promise<void> {
  await env.SESSIONS.delete(key(id));
}
