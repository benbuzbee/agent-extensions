/// <reference types="@cloudflare/vitest-pool-workers/types" />
// Worker suite for PR6 widget injection: the unified fragment-parity check, the
// hosted-injection e2e (create -> reload -> resolve on a real doc view), and the
// neutral-404 doc-view non-leak. Runs INSIDE Miniflare so it gets HTMLRewriter,
// real KV (sessions), and a real migrated D1 (comments). GitHub is mocked via
// fetch-mock; sessions are seeded straight into KV. Mirrors the setup in
// comments-api.workers.test.ts.
import {
  env,
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
  type D1Migration,
} from "cloudflare:test";
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import worker, { type Env } from "../../src/worker/index";
import { injectWidget, COMMENTS_WIDGET_SRC } from "../../src/worker/inject";
import { injectionFragment } from "@shared/review-ux/inject";
import { injectIntoHtml } from "@shared/adapters/local/inject";
import { asThreadId, asCommentId, asTimestamp } from "@shared/review-ux/types";
import type { Thread, Author, CommentsSeed } from "@shared/review-ux/types";
import { fetchMock } from "./fetch-mock";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

// ---------------------------------------------------------------------------
const ORIGIN = "https://docs.my-org.dev";
const REPO = "app-ios";
const DOC_PATH = "guide.html";
const REF = "main";
const KNOWN_TOKEN = "gho_canned_access_token";
const NEUTRAL_BODY = "Not found or no access";
const SEEDED_IDENTITY = { login: "octocat", name: "Mona Lisa", id: 583231 };
const DOC_HTML = "<html><head><title>D</title></head><body><h1>Doc</h1></body></html>";

const sessKey = (id: string) => `sess:${id}`;

async function seedSession(id: string): Promise<string> {
  await env.SESSIONS.put(
    sessKey(id),
    JSON.stringify({
      version: 2,
      iat: Date.now(),
      identity: SEEDED_IDENTITY,
      access_token: KNOWN_TOKEN,
      refresh_token: "refresh_canned",
      expires_at: Date.now() + 3_600_000,
    }),
    { expirationTtl: 3600 },
  );
  return id;
}

// Queue a single-use mock for the checkAccess probe (path-only match, so the
// same interceptor path the doc fetch uses).
function mockProbe(status: number, ref: string | undefined = REF) {
  const query = ref !== undefined ? `?ref=${encodeURIComponent(ref)}` : "";
  fetchMock
    .get("https://api.github.com")
    .intercept({ method: "GET", path: `/repos/${env.REPO_ORG}/${REPO}/contents/${DOC_PATH}${query}` })
    .reply(status, "", { headers: { "content-type": "application/json" } });
}

// Queue the doc-fetch mock (fetchDoc, raw+json). Same path as the probe; queued
// AFTER the probe so checkAccess consumes the probe and fetchDoc consumes this.
function mockDoc(html: string, ref: string | undefined = REF) {
  const query = ref !== undefined ? `?ref=${encodeURIComponent(ref)}` : "";
  fetchMock
    .get("https://api.github.com")
    .intercept({ method: "GET", path: `/repos/${env.REPO_ORG}/${REPO}/contents/${DOC_PATH}${query}` })
    .reply(200, html, { headers: { "content-type": "application/json" } });
}

async function call(url: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function withSession(id: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), cookie: `sid=${id}` } };
}

const docUrl = `${ORIGIN}/${REPO}/${DOC_PATH}?ref=${REF}`;
const commentsUrl = `${docUrl}&comments`;

// Pull the inline { threads } JSON seed out of an injected HTML document.
function parseSeed(html: string): (CommentsSeed & { author?: Author }) | null {
  const marker = 'id="__htmldocs_comments">';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const from = start + marker.length;
  const end = html.indexOf("</script>", from);
  return JSON.parse(html.slice(from, end));
}

function thread(id: string, body: string, resolvedAt: number | null): Thread {
  return {
    id: asThreadId(id),
    anchor: { exact: `anchor for ${id}` },
    root: {
      id: asCommentId(id),
      author: { login: "user", name: null },
      body,
      createdAt: asTimestamp(1000),
    },
    replies: [],
    resolvedAt: resolvedAt === null ? null : asTimestamp(resolvedAt),
  };
}

// ---------------------------------------------------------------------------
beforeAll(async () => {
  await applyD1Migrations(env.COMMENTS_DB, env.TEST_MIGRATIONS);
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
beforeEach(async () => {
  await env.COMMENTS_DB.prepare("DELETE FROM comments").run();
});
afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});
afterAll(() => {
  fetchMock.deactivate();
});

// ===========================================================================
describe("unified injection (both placements emit the identical fragment)", () => {
  it("HTMLRewriter append === injectionFragment === the string-splice fragment", () => {
    // Threads carrying BOTH an open and a resolved thread (each with its own
    // resolvedAt semantics) plus an author.
    const threads = [
      thread("t-open", "still open", null),
      thread("t-done", "resolved but visible", 2000),
    ];
    // The seed carries open AND resolved verbatim — resolvedAt only on the resolved.
    expect(threads).toHaveLength(2);
    expect(threads.find((t) => t.id === "t-open")!.resolvedAt).toBeNull();
    expect(threads.find((t) => t.id === "t-done")!.resolvedAt).toBeTruthy();

    const author: Author = { login: "octocat", name: "Mona", id: 7 };
    const expected = injectionFragment(threads, COMMENTS_WIDGET_SRC, author);

    // Hosted placement: HTMLRewriter append inside <body>.
    const fixture = "<html><body><p>hi</p></body></html>";
    const res = new Response(fixture, { headers: { "Content-Type": "text/html" } });
    return injectWidget(res, threads, COMMENTS_WIDGET_SRC, author)
      .text()
      .then((appended) => {
        // Local placement: the real local adapter. Its seed carries no author
        // by design, so its parity target is the authorless fragment.
        const localExpected = injectionFragment(threads, COMMENTS_WIDGET_SRC);
        const spliced = injectIntoHtml(fixture, threads);

        // Placement differs, the emitted fragment is byte-identical in both.
        expect(appended).toContain(expected);
        expect(spliced).toContain(localExpected);
        // And the </script> breakout escaping survives HTMLRewriter verbatim.
        expect(appended).toContain('id="__htmldocs_comments"');
        expect(appended).toContain('<script type="module" src="' + COMMENTS_WIDGET_SRC + '">');
      });
  });
});

describe("hosted-injection e2e (create -> reload -> resolve, seed-level)", () => {
  it("seed carries the comment, persists across reload, and stays visible-but-green after resolve", async () => {
    await seedSession("s-e2e");

    // 1. Create a comment via the ?comments API.
    mockProbe(200);
    const created = await call(
      commentsUrl,
      withSession("s-e2e", {
        method: "POST",
        body: JSON.stringify({ op: "create", anchor: { exact: "the intro" }, text: "first note" }),
      }),
    );
    expect(created.status).toBe(200);
    const threadId = ((await created.json()) as { thread: { id: string } }).thread.id;

    // 2. Reload the doc view -> the seed contains the created comment (persisted).
    mockProbe(200);
    mockDoc(DOC_HTML);
    const view1 = await call(docUrl, withSession("s-e2e"));
    expect(view1.status).toBe(200);
    const html1 = await view1.text();
    const seed1 = parseSeed(html1)!;
    expect(seed1).not.toBeNull();
    const c1 = seed1.threads.find((t) => t.id === threadId)!;
    expect(c1.root.body).toBe("first note");
    expect(c1.resolvedAt).toBeNull(); // open
    // The captured session author rides on the seed for the future MountDeps.
    expect(seed1.author).toEqual(SEEDED_IDENTITY);
    // The widget script tag is injected too.
    expect(html1).toContain('<script type="module" src="' + COMMENTS_WIDGET_SRC + '">');

    // 3. Resolve it.
    mockProbe(200);
    const resolved = await call(
      commentsUrl,
      withSession("s-e2e", {
        method: "POST",
        body: JSON.stringify({ op: "resolve", threadId }),
      }),
    );
    expect(resolved.status).toBe(200);

    // 4. Reload -> the comment is STILL in the seed (visible) and now carries
    // resolved_at (green indicator). Soft-close, never hidden.
    mockProbe(200);
    mockDoc(DOC_HTML);
    const view2 = await call(docUrl, withSession("s-e2e"));
    const seed2 = parseSeed(await view2.text())!;
    const c2 = seed2.threads.find((t) => t.id === threadId)!;
    expect(c2).toBeDefined();
    expect(c2.root.body).toBe("first note");
    expect(c2.resolvedAt).toBeTruthy();
  });
});

describe("doc-view neutral-404 injects no widget", () => {
  for (const status of [403, 404]) {
    it(`probe(${status}) on a doc view -> neutral 404, no seed, no script tag, no doc fetch`, async () => {
      await seedSession(`s-deny-${status}`);
      // ONLY a probe interceptor. If serveDoc/fetchDoc ran, its unmocked doc
      // fetch would trip net-disabled; afterEach confirms the probe was consumed.
      mockProbe(status);
      const res = await call(docUrl, withSession(`s-deny-${status}`));
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).toBe(NEUTRAL_BODY);
      expect(body).not.toContain("__htmldocs_comments");
      expect(body).not.toMatch(/<script type="module"/);
    });
  }
});
