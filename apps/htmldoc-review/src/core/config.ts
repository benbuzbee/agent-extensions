// Portable configuration for the core logic. The Worker builds this from its
// `Env` bindings; a future local pipeline builds it from a file / argv. Core
// never imports a Cloudflare type — it only sees this plain shape.
export interface Config {
  githubClientId: string;
  githubClientSecret: string;
  callbackUrl: string;
  stateSigningKey: string;
  // The GitHub account this Worker serves docs for: an org, or an individual
  // user account — anything that can own repos. One Worker serves one such
  // account. The repo and doc path come from the request URL
  // (`/{repo}/{...docPath}`), and the optional branch/tag/SHA from `?ref=`.
  // See core/docsource.ts.
  repoOrg: string;
  // Forced-re-login lever: a ms-epoch cutoff. getValidAccessToken deletes-on-read
  // any session whose login-time `iat` predates this, forcing a fresh login. 0
  // (the default) disables it — every session passes. Bumping it to "now" and
  // redeploying logs everyone out idempotently, with no KV enumeration. Sourced
  // from wrangler.toml [vars] SESSION_VALID_SINCE.
  sessionValidSince: number;
}
