// HTTP adapter for the comments API on the Worker. Thin by design: it does the
// Cloudflare/HTTP-specific work (parse the JSON body, build D1Store from the
// binding, serialize the handler's {status, json} to a Response) and delegates
// ALL comment semantics to the shared, runtime-agnostic handleCommentsRequest.
// The doc key is already parsed + access-checked upstream (checkAccess ran
// before the fork), so this function assumes the caller may see the doc.

import { D1Store } from "./d1-store";
import { handleCommentsRequest } from "@shared/api/handlers";
import type { Author, DocKey, OpResult } from "@shared/review-ux/types";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["htmldoc-review", "comments"]);

/**
 * Serve one comments-API request for an already-authorized doc.
 *
 *   GET  → 200 {threads}
 *   POST → single op (200 / op-status) or batch array (207 {results})
 *
 * The `author` is stamped server-side by the caller (index.ts) — the captured
 * session identity, or the distinguishable {login:"agent"} placeholder for a
 * bearer/agent request — never read from the request body. `sessionId`/`actor`
 * feed the audit log only.
 *
 * A POST body that is not valid JSON is a client syntax error: reject with 400
 * BEFORE touching the store (mirrors the envelope 400, which also precedes any
 * store call). A GET carries no body, so we only parse on POST.
 */
export async function handleComments(
  db: D1Database,
  req: Request,
  doc: DocKey,
  author: Author,
  sessionId: string | null,
  actor: "bearer" | "session"
): Promise<Response> {
  const method = req.method.toUpperCase();

  let body: unknown;
  if (method === "POST") {
    const text = await req.text();
    // An empty POST body stays undefined and fails envelope validation
    // downstream (parseEnvelope -> the envelope 400, before any store call);
    // the 400 HERE is only for a non-empty body that is not syntactic JSON.
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
    author,
  });
  auditMutations(payload, author, sessionId, actor, doc);
  return json(status, payload);
}

// Audit the create/resolve mutations in a response. We log identity ON PURPOSE
// (public GitHub login/name, for "who left / resolved this" — resolve is the
// most audit-worthy mutation, being the agent's primary verb). Tokens and the
// session record are NEVER logged. Non-mutating GETs and other ops are skipped.
function auditMutations(
  payload: unknown,
  author: Author,
  sessionId: string | null,
  actor: "bearer" | "session",
  doc: DocKey
): void {
  for (const r of resultsOf(payload)) {
    if (r.op !== "create" && r.op !== "resolve") continue;
    log.info(`comment ${r.op}`, {
      author_login: author.login,
      author_name: author.name,
      actor,
      sessionId,
      repo: doc.repo,
      ref: doc.ref,
      path: doc.path,
      outcome: r.ok ? "ok" : r.error.code,
    });
  }
}

// Normalize the handler payload to the OpResult list it carries: a batch is
// {results:[...]}, a single op is the bare OpResult (has an `op` field), and a
// GET ({threads}) / error ({error}) carries none.
function resultsOf(payload: unknown): OpResult[] {
  if (payload && typeof payload === "object") {
    const p = payload as { results?: unknown; op?: unknown };
    if (Array.isArray(p.results)) return p.results as OpResult[];
    if (typeof p.op === "string") return [payload as OpResult];
  }
  return [];
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
