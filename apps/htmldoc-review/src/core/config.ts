// Portable configuration for the core logic. The Worker builds this from its
// `Env` bindings; a future local pipeline builds it from a file / argv. Core
// never imports a Cloudflare type — it only sees this plain shape.
export interface Config {
  githubClientId: string;
  githubClientSecret: string;
  callbackUrl: string;
  stateSigningKey: string;
  docOwner: string;
  docRepo: string;
  docBranch: string;
}
