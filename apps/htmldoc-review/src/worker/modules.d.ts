// Ambient declaration for the widget-bundle Text import. Wrangler (and
// @cloudflare/vitest-pool-workers, which reads the same wrangler config)
// imports the skill's dist/comments.mjs as a UTF-8 string via the scoped
// [[rules]] Text entry in wrangler.toml. The import MUST be a relative path,
// not a tsconfig-paths alias: Wrangler's module collector matches its rule
// globs against the import specifier as written, so an alias specifier never
// matches and the file falls through to the default ESModule handling.
// TypeScript can't type a bare .mjs (allowJs is off), so this wildcard ambient
// module supplies the string shape. Lives under src/ so tsconfig's include
// covers it.
declare module "*/dist/comments.mjs" {
  const content: string;
  export default content;
}
