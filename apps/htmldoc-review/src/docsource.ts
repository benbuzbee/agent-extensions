import type { Env } from "./index";

function neutral(): Response {
  return new Response("Not found or no access", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Treat `path` as an opaque repo-relative path. Reject traversal / empty /
 * absolute segments, then percent-encode each segment so that `?`, `#`, `&`,
 * and `..` in the path can never escape the DOC_OWNER/DOC_REPO confinement or
 * inject query parameters (e.g. override ref).
 */
function safeRepoPath(path: string): string | null {
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return null;
  }
  return segments.map(encodeURIComponent).join("/");
}

export async function fetchDoc(
  env: Env,
  token: string,
  path: string
): Promise<Response> {
  const safePath = safeRepoPath(path);
  if (safePath === null) {
    // A traversal/empty path can only ever map to "no such doc".
    return neutral();
  }

  const url =
    `https://api.github.com/repos/${env.DOC_OWNER}/${env.DOC_REPO}/contents/${safePath}` +
    `?ref=${encodeURIComponent(env.DOC_BRANCH)}`;

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw+json",
      "User-Agent": "htmldoc-review-worker",
    },
  });

  if (r.status === 200) {
    return new Response(await r.text(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (r.status === 401) {
    return new Response(null, { status: 401 });
  }

  return neutral();
}
