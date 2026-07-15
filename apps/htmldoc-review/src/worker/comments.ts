// HTTP adapter for the comments API on the Worker. Thin by design: it does the
// Cloudflare/HTTP-specific work (parse the JSON body, build D1Store from the
// binding, serialize the handler's {status, json} to a Response) and delegates
// ALL comment semantics to the shared, runtime-agnostic handleCommentsRequest.
// The doc key is already parsed + access-checked upstream (checkAccess ran
// before the fork), so this function assumes the caller may see the doc.

import { D1Store } from "./d1-store";
import { handleCommentsRequest } from "@shared/api/handlers";
import type { Author, DocKey } from "@shared/review-ux/types";

// GitHub identity is not captured yet — capturing the session/token-derived
// {login, name, id} is a later concern. Until then every write is stamped with
// this server-supplied placeholder, which satisfies the NOT NULL author columns
// (author_login) without reaching forward to identity capture. The value is
// deliberately non-real so a placeholder-authored comment is visibly
// distinguishable. The author is ALWAYS server-supplied here — never read from
// the request body.
const PLACEHOLDER_AUTHOR: Author = { login: "unknown", name: null };

/**
 * Serve one comments-API request for an already-authorized doc.
 *
 *   GET  → 200 {threads}
 *   POST → single op (200 / op-status) or batch array (207 {results})
 *
 * A POST body that is not valid JSON is a client syntax error: reject with 400
 * BEFORE touching the store (mirrors the envelope 400, which also precedes any
 * store call). A GET carries no body, so we only parse on POST.
 */
export async function handleComments(
  db: D1Database,
  req: Request,
  doc: DocKey
): Promise<Response> {
  const method = req.method.toUpperCase();

  let body: unknown;
  if (method === "POST") {
    const text = await req.text();
    // An empty POST body parses as "no ops" downstream; only non-empty,
    // syntactically-broken JSON is a 400 here.
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        return json(400, { error: "invalid JSON body" });
      }
    }
  }

  const store = new D1Store(db);
  const { status, json: payload } = await handleCommentsRequest({
    method,
    body,
    store,
    doc,
    author: PLACEHOLDER_AUTHOR,
  });
  return json(status, payload);
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
