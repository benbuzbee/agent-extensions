// Portable configuration for the core logic. The Worker builds this from its
// `Env` bindings; a future local pipeline builds it from a file / argv. Core
// never imports a Cloudflare type — it only sees this plain shape.
export interface Config {
  githubClientId: string;
  githubClientSecret: string;
  callbackUrl: string;
  stateSigningKey: string;
  // The GitHub org/owner this Worker is scoped to. One Worker == one org.
  // The repo and doc path are NOT configured here — they come from the request
  // URL (`/{repo}/{...docPath}`), and the optional branch/tag/SHA comes from
  // `?ref=`. See core/docsource.ts.
  docOwner: string;
}
