/// <reference types="@cloudflare/vitest-pool-workers/types" />
// D1Store round-trips, exercised INSIDE the Workers runtime against a real
// migrated Cloudflare D1 in Miniflare (no HTTP route — the comment API is not
// mounted until PR4). The schema is built in beforeAll by applying migrations/
// (parsed Node-side in vitest.config.ts, delivered as the TEST_MIGRATIONS JSON
// binding) into COMMENTS_DB. isolatedStorage does NOT roll back D1 row writes,
// so the beforeEach below wipes the comments table — that DELETE (not
// isolatedStorage) is what gives every test a migrated-but-empty table to start
// from; do not remove it.
//
// Nothing here touches real GitHub or credentials — D1Store is pure persistence.
import { env, applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, it, expect } from "vitest";
import { D1Store } from "../../src/worker/d1-store";
import { isNotFoundError, NotImplementedError } from "@shared/api/thread-ops";
import { asThreadId, asCommentId } from "@shared/review-ux/types";
import type {
  DocKey,
  Author,
  CreateOp,
  Op,
  OpResult,
} from "@shared/review-ux/types";

// TEST_MIGRATIONS is injected as a JSON binding by vitest.config.ts; COMMENTS_DB
// comes from wrangler.toml's [[d1_databases]] block.
// `env` from cloudflare:test is typed as `Cloudflare.Env` in pool-workers 0.16
// (populated from the wrangler-generated worker-configuration.d.ts, so COMMENTS_DB
// is already present). We only add the test-only TEST_MIGRATIONS binding that
// vitest.config.ts injects via Miniflare; declaration merging combines it in.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const AUTHOR: Author = { login: "alice", name: "Alice Example", id: 42 };
const DOC: DocKey = { repo: "app-ios", ref: "main", path: "guide.html" };

function createOp(text: string, exact = "the quick brown fox"): CreateOp {
  return {
    op: "create",
    anchor: { exact, prefix: "pre-", suffix: "-suf", sections: ["intro"] },
    text,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await applyD1Migrations(env.COMMENTS_DB, env.TEST_MIGRATIONS);
});

// D1 rows are NOT rolled back between tests by isolatedStorage, so wipe the
// table (kept — the schema is created once in beforeAll) before each test for a
// deterministic empty start.
beforeEach(async () => {
  await env.COMMENTS_DB.prepare("DELETE FROM comments").run();
});

function newStore(): D1Store {
  return new D1Store(env.COMMENTS_DB);
}

// A duck-typed D1 facade that reproduces the SELECT -> UPDATE race
// deterministically: any UPDATE on the comments table is preceded by a hard
// DELETE of the victim row (through the real db), so the UPDATE matches zero
// rows — exactly what a concurrent delete between the store's lookup and its
// write produces. Everything else passes straight through.
function deleteBeforeUpdate(db: D1Database, victimId: string): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      if (!sql.startsWith("UPDATE comments")) return stmt;
      return new Proxy(stmt, {
        get(target, prop, receiver) {
          if (prop !== "bind") return Reflect.get(target, prop, receiver);
          return (...args: unknown[]) => {
            const bound = target.bind(...args);
            return new Proxy(bound, {
              get(boundTarget, boundProp, boundReceiver) {
                if (boundProp !== "run") return Reflect.get(boundTarget, boundProp, boundReceiver);
                return async () => {
                  await db.prepare("DELETE FROM comments WHERE id = ?").bind(victimId).run();
                  return boundTarget.run();
                };
              },
            });
          };
        },
      });
    },
  } as unknown as D1Database;
}

describe("D1Store round-trips", () => {
  it("create -> list preserves author, body, anchor, timestamps", async () => {
    const store = newStore();
    const created = await store.create(DOC, createOp("first comment"), AUTHOR);

    const threads = await store.list(DOC);
    expect(threads).toHaveLength(1);
    const t = threads[0]!;
    expect(t.id).toBe(created.id);
    // The numeric author id round-trips through the author_id column.
    expect(t.root.author).toEqual({ login: "alice", name: "Alice Example", id: 42 });
    expect(t.root.body).toBe("first comment");
    // Anchor JSON blob survives unchanged.
    expect(t.anchor).toEqual({
      exact: "the quick brown fox",
      prefix: "pre-",
      suffix: "-suf",
      sections: ["intro"],
    });
    expect(typeof t.root.createdAt).toBe("number");
    expect(t.resolvedAt).toBeNull();
    expect(t.replies).toEqual([]);
  });

  it("an id-less author (placeholder author_id 0) reads back with NO id field", async () => {
    const store = newStore();
    await store.create(DOC, createOp("agent comment"), { login: "agent", name: null });

    const threads = await store.list(DOC);
    expect(threads).toHaveLength(1);
    // The stored placeholder 0 is storage-only — it must not surface as a
    // "real" numeric GitHub id on the way back out.
    expect(threads[0]!.root.author).toEqual({ login: "agent", name: null });
    expect("id" in threads[0]!.root.author).toBe(false);
  });

  it("lists multiple threads in created_at order", async () => {
    const store = newStore();
    await store.create(DOC, createOp("A"), AUTHOR);
    await sleep(2);
    await store.create(DOC, createOp("B"), AUTHOR);
    await sleep(2);
    await store.create(DOC, createOp("C"), AUTHOR);

    const threads = await store.list(DOC);
    expect(threads.map((t) => t.root.body)).toEqual(["A", "B", "C"]);
    for (let i = 1; i < threads.length; i++) {
      expect(threads[i]!.root.createdAt).toBeGreaterThanOrEqual(threads[i - 1]!.root.createdAt);
    }
  });

  it("orders equal created_at ties by id", async () => {
    // Raw INSERTs (not create()) pin an IDENTICAL created_at on every row, so
    // only the id tiebreaker can produce the expected order — ids are inserted
    // deliberately out of order to catch an insertion-order accident too.
    const ts = Date.now();
    for (const id of ["c-tie", "a-tie", "b-tie"]) {
      await env.COMMENTS_DB.prepare(
        "INSERT INTO comments" +
          " (id, repo, ref, path, anchor, body, author_login, author_name, author_id, created_at, resolved_at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      )
        .bind(
          id,
          DOC.repo,
          DOC.ref,
          DOC.path,
          JSON.stringify({ exact: "x", prefix: "", suffix: "", sections: [] }),
          `body of ${id}`,
          AUTHOR.login,
          AUTHOR.name,
          AUTHOR.id,
          ts,
        )
        .run();
    }

    const threads = await newStore().list(DOC);
    expect(threads.map((t) => t.id)).toEqual(["a-tie", "b-tie", "c-tie"]);
  });

  it("resolve stamps resolved_at and keeps the row visible in list", async () => {
    const store = newStore();
    const created = await store.create(DOC, createOp("resolve me"), AUTHOR);

    const resolved = await store.resolve(DOC, { op: "resolve", threadId: created.id }, AUTHOR);
    expect(typeof resolved.resolvedAt).toBe("number");

    // Soft-close: still returned by list.
    const threads = await store.list(DOC);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.resolvedAt).toBe(resolved.resolvedAt);
  });

  it("reopen clears resolved_at back to null on the same row", async () => {
    const store = newStore();
    const created = await store.create(DOC, createOp("toggle"), AUTHOR);
    await store.resolve(DOC, { op: "resolve", threadId: created.id }, AUTHOR);

    const reopened = await store.reopen(DOC, { op: "reopen", threadId: created.id }, AUTHOR);
    expect(reopened.resolvedAt).toBeNull();
    const threads = await store.list(DOC);
    expect(threads[0]!.resolvedAt).toBeNull();
  });

  it("delete hard-purges the row", async () => {
    const store = newStore();
    const created = await store.create(DOC, createOp("delete me"), AUTHOR);

    const purged = await store.delete(DOC, { op: "delete", threadId: created.id }, AUTHOR);
    expect(purged).toBe(created.id);
    expect(await store.list(DOC)).toHaveLength(0);
  });

  it("resolve/reopen/delete of an unknown threadId reject with NotFoundError", async () => {
    const store = newStore();
    const ghost = asThreadId("no-such-thread");

    await expect(store.resolve(DOC, { op: "resolve", threadId: ghost }, AUTHOR)).rejects.toSatisfy(
      isNotFoundError,
    );
    await expect(store.reopen(DOC, { op: "reopen", threadId: ghost }, AUTHOR)).rejects.toSatisfy(
      isNotFoundError,
    );
    await expect(store.delete(DOC, { op: "delete", threadId: ghost }, AUTHOR)).rejects.toSatisfy(
      isNotFoundError,
    );
  });

  it("scopes mutations to the doc — a valid threadId under a different DocKey is not_found", async () => {
    const store = newStore();
    const created = await store.create(DOC, createOp("in doc A"), AUTHOR);
    // A different doc the caller might be authorized for (checkAccess only ever
    // authorizes the doc in the URL). The thread lives in DOC, not otherDoc.
    const otherDoc: DocKey = { repo: "app-ios", ref: "main", path: "other.html" };

    await expect(
      store.resolve(otherDoc, { op: "resolve", threadId: created.id }, AUTHOR),
    ).rejects.toSatisfy(isNotFoundError);
    await expect(
      store.reopen(otherDoc, { op: "reopen", threadId: created.id }, AUTHOR),
    ).rejects.toSatisfy(isNotFoundError);
    await expect(
      store.delete(otherDoc, { op: "delete", threadId: created.id }, AUTHOR),
    ).rejects.toSatisfy(isNotFoundError);

    // The thread is untouched in its own doc: still open, still present.
    const threads = await store.list(DOC);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.resolvedAt).toBeNull();
  });

  it("resolve is idempotent — a second resolve keeps the original resolved_at", async () => {
    const store = newStore();
    const created = await store.create(DOC, createOp("idempotent"), AUTHOR);

    const first = await store.resolve(DOC, { op: "resolve", threadId: created.id }, AUTHOR);
    await sleep(2);
    const second = await store.resolve(DOC, { op: "resolve", threadId: created.id }, AUTHOR);
    expect(second.resolvedAt).toBe(first.resolvedAt);
  });

  it("resolve: a thread hard-deleted between lookup and UPDATE rejects not_found (no phantom success)", async () => {
    const created = await newStore().create(DOC, createOp("race me"), AUTHOR);
    const racing = new D1Store(deleteBeforeUpdate(env.COMMENTS_DB, created.id));

    await expect(
      racing.resolve(DOC, { op: "resolve", threadId: created.id }, AUTHOR),
    ).rejects.toSatisfy(isNotFoundError);
  });

  it("reopen: a thread hard-deleted between lookup and UPDATE rejects not_found", async () => {
    const store = newStore();
    const created = await store.create(DOC, createOp("race me too"), AUTHOR);
    await store.resolve(DOC, { op: "resolve", threadId: created.id }, AUTHOR);
    const racing = new D1Store(deleteBeforeUpdate(env.COMMENTS_DB, created.id));

    await expect(
      racing.reopen(DOC, { op: "reopen", threadId: created.id }, AUTHOR),
    ).rejects.toSatisfy(isNotFoundError);
  });
});

describe("D1Store ref sentinel", () => {
  it("stores + queries a missing/empty ref as the literal 'default'", async () => {
    const store = newStore();
    const noRefDoc: DocKey = { repo: "app-ios", ref: "", path: "guide.html" };
    const created = await store.create(noRefDoc, createOp("no ref"), AUTHOR);

    // Queryable under the explicit 'default' sentinel...
    const asDefault = await store.list({ repo: "app-ios", ref: "default", path: "guide.html" });
    expect(asDefault.map((t) => t.id)).toContain(created.id);
    // ...and under an empty ref (normalized to the same sentinel).
    const asEmpty = await store.list(noRefDoc);
    expect(asEmpty.map((t) => t.id)).toContain(created.id);
  });

  it("scopes by ref — a 'main' comment is excluded from the 'default' view", async () => {
    const store = newStore();
    await store.create({ repo: "app-ios", ref: "main", path: "guide.html" }, createOp("on main"), AUTHOR);

    const defaultView = await store.list({ repo: "app-ios", ref: "default", path: "guide.html" });
    expect(defaultView).toHaveLength(0);
  });
});

describe("D1Store batch", () => {
  it("loops single-op methods best-effort, in request order, without rollback", async () => {
    const store = newStore();
    const keep = await store.create(DOC, createOp("keep"), AUTHOR);
    const ghost = asThreadId("missing");

    const ops: Op[] = [
      { op: "resolve", threadId: keep.id }, // ok
      { op: "resolve", threadId: ghost }, // not_found
      createOp("added in batch"), // ok
    ];
    const results = await store.batch(DOC, ops, AUTHOR);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ ok: true, op: "resolve" });
    expect(results[1]).toEqual({
      ok: false,
      op: "resolve",
      error: {
        code: "not_found",
        threadId: ghost,
        message: `the document is accessible but thread '${ghost}' was not found`,
      },
    });
    expect(results[2]).toMatchObject({ ok: true, op: "create" });

    // No rollback of the successful ops: keep is resolved AND the new thread exists.
    const threads = await store.list(DOC);
    expect(threads).toHaveLength(2);
    const kept = threads.find((t) => t.id === keep.id)!;
    expect(kept.resolvedAt).not.toBeNull();
    expect(threads.some((t) => t.root.body === "added in batch")).toBe(true);
  });

  it("surfaces reserved reply/edit ops as per-op transient results", async () => {
    const store = newStore();
    const ops: Op[] = [
      { op: "reply", threadId: asThreadId("t1"), text: "hi" },
      { op: "edit", commentId: asCommentId("c1"), patch: { body: "changed" } },
    ];
    const results: OpResult[] = await store.batch(DOC, ops, AUTHOR);

    expect(results).toEqual([
      // reply names a threadId, so its error echoes it; edit names only a
      // commentId, so it carries none.
      { ok: false, op: "reply", error: { code: "transient", message: "op not yet supported", threadId: asThreadId("t1") } },
      { ok: false, op: "edit", error: { code: "transient", message: "op not yet supported" } },
    ]);
  });

  it("reply/edit reject with the shared NotImplementedError type", async () => {
    const store = newStore();
    await expect(
      store.reply(DOC, { op: "reply", threadId: asThreadId("t1"), text: "hi" }, AUTHOR),
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(
      store.edit(DOC, { op: "edit", commentId: asCommentId("c1"), patch: { body: "x" } }, AUTHOR),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});
