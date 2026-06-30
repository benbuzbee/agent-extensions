// Shared response builders for the portable core.
//
// These live in core/ (not worker/) because they are pure, dependency-free
// `Response` constructors — no Worker bindings, no KV, no env. Keeping them
// here lets core/docsource.ts and the Worker entrypoint share one source of
// truth without dragging a Worker-only import into the portable layer.

/**
 * The single "neutral" 404 used whenever a doc is missing OR the viewer lacks
 * access. We deliberately collapse "not found" and "forbidden" into one
 * indistinguishable response: revealing which one applies would leak the
 * existence of private repos/paths to viewers who cannot see them. Any caller
 * that wants to deny access without leaking should return exactly this.
 */
export function neutral(): Response {
  return new Response("Not found or no access", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
