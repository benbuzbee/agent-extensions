// The single authorization chokepoint. `checkAccess` answers exactly one
// question — "can this already-resolved token see this doc on GitHub?" — by
// issuing ONE Contents probe (see core/docsource.probeContents). It sits in
// index.ts BEFORE the request forks into serveDoc vs. the comment handler, so
// every authenticated branch (present and future) rides the same gate and the
// probe can never be forgotten.
//
// It is PURELY the visibility gate: no session store, no token refresh, no store
// touch. The token is resolved (and, for a session, proactively refreshed)
// upstream, so a session store param would be dead weight — hence the trimmed
// `checkAccess(cfg, token, repo, ref, path)` signature. serveDoc keeps its own
// 401-refresh-retry for the narrow probe-200-then-fetch-401 in-flight window.
//
// Deny is uniform: GitHub 403 AND 404 (and anything else non-2xx/304) collapse
// to the shared neutral 404, so comment/doc endpoints stay indistinguishable
// from "no such doc" for a caller who lacks access — no existence leak.

import type { Config } from "../core/config";
import { probeContents } from "../core/docsource";
import { neutral } from "../core/responses";

/**
 * Result of the access gate. On deny we carry the ready-made `denialResponse`
 * (the neutral 404) rather than a status, so the caller returns it verbatim and
 * cannot accidentally craft a different, leakier response.
 */
export type Access =
  | { ok: true }
  | { ok: false; denialResponse: Response };

/**
 * Probe GitHub once for `(repo, ref, path)` with the caller's token. 200 (or a
 * future conditional 304) → access granted. Every other status → deny with the
 * neutral 404. `ref` is passed through as-is (undefined → GitHub's default
 * branch, exactly like fetchDoc — never the literal 'default').
 */
export async function checkAccess(
  cfg: Config,
  token: string,
  repo: string,
  ref: string | undefined,
  path: string
): Promise<Access> {
  const status = await probeContents(cfg, token, repo, path, ref);
  if (status === 200 || status === 304) {
    return { ok: true };
  }
  return { ok: false, denialResponse: neutral() };
}
