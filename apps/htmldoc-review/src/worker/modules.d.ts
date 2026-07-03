// Ambient declaration for `.txt` string imports. Wrangler (and
// @cloudflare/vitest-pool-workers, which reads the same wrangler config) imports
// `.txt` files as a UTF-8 string via its DEFAULT Text-module rule — no
// wrangler.toml [[rules]] entry needed (declaring one for a built-in extension
// risks a duplicate-rule build error). This satisfies the app typecheck for the
// widget-bundle import in inject.ts. Lives under src/ so tsconfig's include
// covers it.
declare module "*.txt" {
  const content: string;
  export default content;
}
