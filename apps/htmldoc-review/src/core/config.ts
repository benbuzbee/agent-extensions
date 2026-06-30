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
}
