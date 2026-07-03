/// <reference types="@cloudflare/vitest-pool-workers/types" />
// Worker suite for the mounted comments API (PR4): the ?comments branch on the
// catch-all doc route + the checkAccess chokepoint in front of it. Runs INSIDE
// the Workers runtime (Miniflare) so it gets real KV (sessions) + a real migrated
// D1 (comments) + the fetch handler.
//
// Two things are mocked, exactly as the doc suite does it:
//   * outbound GitHub via fetchMock — the ONLY GitHub call the API makes is the
//     access PROBE (GET Contents, object+json). fetch-mock matches by
//     origin+method+path (it ignores Accept), so the probe interceptor uses the
//     SAME /repos/{org}/{repo}/contents/{path}[?ref] path the doc fetch would.
//   * sessions seeded directly into KV (no OAuth dance).
//
// D1 rows are NOT rolled back by isolatedStorage, so beforeEach wipes the
// comments table (the schema is created once in beforeAll via applyD1Migrations).
import {
  env,
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
  type D1Migration,
} from "cloudflare:test";
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import worker, { type Env } from "../../src/worker/index";
import { D1Store } from "../../src/worker/d1-store";
import { asThreadId } from "@shared/review-ux/types";
import type { CreateOp, DocKey, Author } from "@shared/review-ux/types";
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
const AGENT_TOKEN = "ghs_agent_bearer_token";

// The neutral 404 the doc route returns — comment denies must be byte-identical.
const NEUTRAL_BODY = "Not found or no access";

const PLACEHOLDER: Author = { login: "unknown", name: null };
const DOC: DocKey = { repo: REPO, ref: REF, path: DOC_PATH };

// The identity a v2 session carries. A create on such a session stamps THIS
// author (login/name/id), never the PR4 placeholder and never a body-supplied one.
const SEEDED_IDENTITY = { login: "octocat", name: "Mona Lisa", id: 583231 };

const sessKey = (id: string) => `sess:${id}`;

// Seed a v2 (identity-bearing) session so the comment ops don't trip an unmocked
// GET /user — getIdentity returns the cached identity with no backfill.
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

// Seed a pre-identity (version 1) session — the Deliverable 1 record shape, with
// NO version/iat/identity — to exercise the lazy on-read GET /user backfill.
async function seedV1Session(id: string): Promise<string> {
  await env.SESSIONS.put(
    sessKey(id),
    JSON.stringify({
      access_token: KNOWN_TOKEN,
      refresh_token: "refresh_canned",
      expires_at: Date.now() + 3_600_000,
    }),
    { expirationTtl: 3600 },
  );
  return id;
}

// Queue a single-use mock for the identity backfill's GET /user.
function mockUser(identity: { login: string; name: string | null; id: number }) {
  fetchMock
    .get("https://api.github.com")
    .intercept({ method: "GET", path: "/user" })
    .reply(200, identity, { headers: { "content-type": "application/json" } });
}

/**
 * Queue a single-use mock for the checkAccess probe. The probe hits the GitHub
 * Contents endpoint (object+json), but fetch-mock matches path only, so the
 * interceptor path is the same one the doc fetch uses. `ref` defaults to REF.
 */
function mockProbe(
  status: number,
  opts: { repo?: string; path?: string; ref?: string } = {},
) {
  const repo = opts.repo ?? REPO;
  const path = opts.path ?? DOC_PATH;
  const ref = "ref" in opts ? opts.ref : REF;
  const query = ref !== undefined ? `?ref=${encodeURIComponent(ref)}` : "";
  fetchMock
    .get("https://api.github.com")
    .intercept({ method: "GET", path: `/repos/${env.REPO_ORG}/${repo}/contents/${path}${query}` })
    .reply(status, "", { headers: { "content-type": "application/json" } });
}

/** Drive the Worker and flush any ctx work. */
async function call(url: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** The comments collection URL for the default fixture. */
function commentsUrl(extra = ""): string {
  return `${ORIGIN}/${REPO}/${DOC_PATH}?ref=${REF}&comments${extra}`;
}

function withSession(id: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), cookie: `sid=${id}` } };
}

async function commentCount(): Promise<number> {
  const row = await env.COMMENTS_DB.prepare("SELECT COUNT(*) AS n FROM comments").first<{ n: number }>();
  return row?.n ?? 0;
}

function createOp(text: string, exact = "the quick brown fox"): CreateOp {
  return { op: "create", anchor: { exact }, text };
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
describe("GET list", () => {
  it("returns threads ordered by created_at with a valid session + probe(200)", async () => {
    // Seed three threads directly (deterministic order via distinct createdAt).
    const store = new D1Store(env.COMMENTS_DB);
    await store.create(DOC, createOp("A"), PLACEHOLDER);
    await new Promise((r) => setTimeout(r, 2));
    await store.create(DOC, createOp("B"), PLACEHOLDER);
    await new Promise((r) => setTimeout(r, 2));
    await store.create(DOC, createOp("C"), PLACEHOLDER);

    await seedSession("s-list");
    mockProbe(200);
    const res = await call(commentsUrl(), withSession("s-list"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { threads: { root: { body: string } }[] };
    expect(body.threads.map((t) => t.root.body)).toEqual(["A", "B", "C"]);
  });
});

describe("POST single ops", () => {
  it("create stamps the captured session identity, never a body-supplied one", async () => {
    await seedSession("s-create");
    mockProbe(200);
    // Body carries an `author` field that MUST be ignored (author is server-side).
    const res = await call(
      commentsUrl(),
      withSession("s-create", {
        method: "POST",
        body: JSON.stringify({
          op: "create",
          anchor: { exact: "hello" },
          text: "first comment",
          author: { login: "attacker", name: "Mallory" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      op: string;
      thread: { id: string; root: { author: { login: string; name: string | null } } };
    };
    expect(body).toMatchObject({ ok: true, op: "create" });
    // The REAL captured author surfaces on the created thread (card validation).
    expect(body.thread.root.author.login).toBe(SEEDED_IDENTITY.login);
    expect(body.thread.root.author.name).toBe(SEEDED_IDENTITY.name);

    const row = await env.COMMENTS_DB.prepare(
      "SELECT author_login, author_name, author_id FROM comments WHERE id = ?",
    )
      .bind(body.thread.id)
      .first<{ author_login: string; author_name: string | null; author_id: number }>();
    expect(row?.author_login).toBe(SEEDED_IDENTITY.login);
    expect(row?.author_login).not.toBe("attacker");
    expect(row?.author_name).toBe(SEEDED_IDENTITY.name);
    // The stable numeric id round-trips from the session identity into the row.
    expect(row?.author_id).toBe(SEEDED_IDENTITY.id);
  });

  it("lazy-upgrades a v1 session on read: GET /user backfills identity, comment shows the real name", async () => {
    const BACKFILL = { login: "hubot", name: "Hubot", id: 776677 };
    await seedV1Session("s-v1");
    mockProbe(200);
    mockUser(BACKFILL); // the one-time on-read backfill call

    const res = await call(
      commentsUrl(),
      withSession("s-v1", {
        method: "POST",
        body: JSON.stringify(createOp("from a legacy session")),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      thread: { root: { author: { login: string; name: string | null } } };
    };
    // The backfilled name appears on the created comment...
    expect(body.thread.root.author.login).toBe(BACKFILL.login);
    expect(body.thread.root.author.name).toBe(BACKFILL.name);

    // ...and the KV record was upgraded IN PLACE to version 2 + identity, keeping
    // the same tokens (a single write-back, not a new session).
    const rec = await env.SESSIONS.get<{
      version: number;
      identity: { login: string; id: number } | null;
      access_token: string;
    }>(sessKey("s-v1"), "json");
    expect(rec?.version).toBe(2);
    expect(rec?.identity?.login).toBe(BACKFILL.login);
    expect(rec?.identity?.id).toBe(BACKFILL.id);
    expect(rec?.access_token).toBe(KNOWN_TOKEN);
  });

  it("resolve soft-closes (row stays visible) and delete hard-purges", async () => {
    const store = new D1Store(env.COMMENTS_DB);
    const t = await store.create(DOC, createOp("resolve me"), PLACEHOLDER);

    await seedSession("s-resolve");
    mockProbe(200);
    const resolved = await call(
      commentsUrl(),
      withSession("s-resolve", {
        method: "POST",
        body: JSON.stringify({ op: "resolve", threadId: t.id }),
      }),
    );
    expect(resolved.status).toBe(200);
    const rBody = (await resolved.json()) as { ok: boolean; op: string; thread: { resolvedAt: number | null } };
    expect(rBody).toMatchObject({ ok: true, op: "resolve" });
    expect(typeof rBody.thread.resolvedAt).toBe("number");
    // Soft-close: still listed.
    expect(await store.list(DOC)).toHaveLength(1);

    mockProbe(200);
    const deleted = await call(
      commentsUrl(),
      withSession("s-resolve", {
        method: "POST",
        body: JSON.stringify({ op: "delete", threadId: t.id }),
      }),
    );
    expect(deleted.status).toBe(200);
    expect((await deleted.json())).toMatchObject({ ok: true, op: "delete", threadId: t.id });
    expect(await store.list(DOC)).toHaveLength(0);
  });

  it("reopen clears resolvedAt", async () => {
    const store = new D1Store(env.COMMENTS_DB);
    const t = await store.create(DOC, createOp("toggle"), PLACEHOLDER);
    await store.resolve(DOC, { op: "resolve", threadId: t.id }, PLACEHOLDER);

    await seedSession("s-reopen");
    mockProbe(200);
    const res = await call(
      commentsUrl(),
      withSession("s-reopen", {
        method: "POST",
        body: JSON.stringify({ op: "reopen", threadId: t.id }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; op: string; thread: { resolvedAt: number | null } };
    expect(body).toMatchObject({ ok: true, op: "reopen" });
    expect(body.thread.resolvedAt).toBeNull();
  });
});

describe("POST batch", () => {
  it("207 with per-op results in request order, best-effort (one not_found among ok)", async () => {
    const store = new D1Store(env.COMMENTS_DB);
    const keep = await store.create(DOC, createOp("keep"), PLACEHOLDER);
    const ghost = asThreadId("missing");

    await seedSession("s-batch");
    mockProbe(200);
    const res = await call(
      commentsUrl(),
      withSession("s-batch", {
        method: "POST",
        body: JSON.stringify([
          { op: "resolve", threadId: keep.id },
          { op: "resolve", threadId: ghost },
          { op: "create", anchor: { exact: "new" }, text: "added in batch" },
        ]),
      }),
    );

    expect(res.status).toBe(207);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(3);
    expect(body.results[0]).toMatchObject({ ok: true, op: "resolve" });
    expect(body.results[1]).toEqual({
      ok: false,
      op: "resolve",
      error: { code: "not_found", threadId: ghost },
    });
    expect(body.results[2]).toMatchObject({ ok: true, op: "create" });

    // Best-effort: the successful ops persisted (no rollback of siblings).
    const threads = await store.list(DOC);
    expect(threads).toHaveLength(2);
    expect(threads.find((t) => t.id === keep.id)!.resolvedAt).not.toBeNull();
  });

  it("fires the access probe EXACTLY ONCE per batch, never per op", async () => {
    await seedSession("s-once");
    // A SINGLE probe interceptor. Three creates in the batch; a per-op re-probe
    // would find no interceptor and net-disabled throws. afterEach's
    // assertNoPendingInterceptors then confirms the one probe was consumed.
    mockProbe(200);
    const res = await call(
      commentsUrl(),
      withSession("s-once", {
        method: "POST",
        body: JSON.stringify([
          { op: "create", anchor: { exact: "1" }, text: "one" },
          { op: "create", anchor: { exact: "2" }, text: "two" },
          { op: "create", anchor: { exact: "3" }, text: "three" },
        ]),
      }),
    );
    expect(res.status).toBe(207);
    expect(await commentCount()).toBe(3);
  });
});

describe("reserved ops (reply/edit)", () => {
  it("single reserved op → 400 with zero store mutation", async () => {
    const store = new D1Store(env.COMMENTS_DB);
    await store.create(DOC, createOp("existing"), PLACEHOLDER);

    await seedSession("s-reserved");
    mockProbe(200);
    const res = await call(
      commentsUrl(),
      withSession("s-reserved", {
        method: "POST",
        body: JSON.stringify({ op: "reply", threadId: asThreadId("t1"), text: "hi" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "op not yet supported" });
    // No mutation: the pre-existing thread is untouched, nothing added.
    expect(await commentCount()).toBe(1);
  });

  it("reserved op inside a batch → per-op transient at 207", async () => {
    await seedSession("s-reserved-batch");
    mockProbe(200);
    const res = await call(
      commentsUrl(),
      withSession("s-reserved-batch", {
        method: "POST",
        body: JSON.stringify([
          { op: "reply", threadId: asThreadId("t1"), text: "hi" },
          { op: "edit", commentId: "c1", patch: { body: "changed" } },
        ]),
      }),
    );
    expect(res.status).toBe(207);
    expect((await res.json())).toEqual({
      results: [
        { ok: false, op: "reply", error: { code: "transient", message: "op not yet supported" } },
        { ok: false, op: "edit", error: { code: "transient", message: "op not yet supported" } },
      ],
    });
  });
});

describe("unauthorized doc (probe deny)", () => {
  for (const status of [403, 404]) {
    it(`probe(${status}) on a POST create → neutral 404, no widget markup, D1 unchanged`, async () => {
      await seedSession(`s-deny-${status}`);
      mockProbe(status);
      const res = await call(
        commentsUrl(),
        withSession(`s-deny-${status}`, {
          method: "POST",
          body: JSON.stringify(createOp("should never persist")),
        }),
      );
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).toBe(NEUTRAL_BODY);
      expect(body).not.toMatch(/<script|<div|thread/i);
      // The create never reached the store.
      expect(await commentCount()).toBe(0);
    });
  }
});

describe("envelope 400 vs access ordering (400 never precedes the gate)", () => {
  it("authorized + malformed envelope → 400, store untouched", async () => {
    const store = new D1Store(env.COMMENTS_DB);
    await store.create(DOC, createOp("pre"), PLACEHOLDER);

    await seedSession("s-env-ok");
    mockProbe(200);
    const res = await call(
      commentsUrl(),
      withSession("s-env-ok", {
        method: "POST",
        body: JSON.stringify({ op: "frobnicate", threadId: "t1" }),
      }),
    );
    expect(res.status).toBe(400);
    // Only the pre-seeded thread; the malformed op created nothing.
    expect(await commentCount()).toBe(1);
  });

  it("unauthorized + the SAME malformed body → neutral 404, NOT 400", async () => {
    await seedSession("s-env-deny");
    mockProbe(403);
    const res = await call(
      commentsUrl(),
      withSession("s-env-deny", {
        method: "POST",
        body: JSON.stringify({ op: "frobnicate", threadId: "t1" }),
      }),
    );
    // The access gate runs BEFORE envelope validation, so a malformed body on an
    // inaccessible doc can't be distinguished (400) from a well-formed one (404).
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NEUTRAL_BODY);
  });
});

describe("credential-less comments request", () => {
  it("no cookie and no bearer → 401 unauthorized(), no probe, no store call", async () => {
    // No probe interceptor queued: if the handler probed, net-disabled throws.
    const res = await call(commentsUrl(), { method: "POST", body: JSON.stringify(createOp("x")) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "authentication required" });
    expect(await commentCount()).toBe(0);
  });

  it("identical 401 for an existing vs a non-existing doc path (no leak)", async () => {
    const a = await call(commentsUrl());
    const b = await call(`${ORIGIN}/no-such-repo/missing.html?comments`);
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.text()).toBe(await b.text());
  });
});

describe("agent bearer path", () => {
  it("bearer, no cookie: probe(200) → op succeeds", async () => {
    mockProbe(200);
    const res = await call(commentsUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
      body: JSON.stringify(createOp("agent comment")),
    });
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, op: "create" });
    expect(await commentCount()).toBe(1);
  });

  it("bearer, no cookie: probe(403) → neutral 404, nothing persisted", async () => {
    mockProbe(403);
    const res = await call(commentsUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
      body: JSON.stringify(createOp("agent comment")),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NEUTRAL_BODY);
    expect(await commentCount()).toBe(0);
  });
});
