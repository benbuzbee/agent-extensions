# SPIKES — manual checklist (htmldoc-review, Deliverable 1)

The automated `vitest-pool-workers` suite mocks GitHub and proves the **contract**
(state CSRF, cookie shape, KV storage, neutral 404, silent refresh, re-login, logout).
It does **not** — and by design cannot — touch real GitHub or real credentials.

This file lists the checks that must be done **by hand** against a real GitHub App +
real repo, plus the upstream-behavior assumption that the whole "neutral 404" design
rests on and must be **confirmed live** before relying on it.

Run these against a real deployment (a throwaway test org/repo is fine) — they need a
real GitHub App, a real install, and at least two test users with different access.

---

## Spike 1 — Live intersection: real 200 vs real 404 (CANNOT run unattended)

**Why manual:** the test suite mocks the Contents API. Only a live call exercises real
GitHub tokens, real repo permissions, real `Accept: application/vnd.github.raw+json`
behavior, and the actual user<->repo access intersection. There are no canned responses
here — this is the one thing the unattended suite can never cover.

**Setup**

- A real GitHub App created via the manifest flow, installed on the test org, with
  **User-to-server token expiration ON**.
- A private repo matching `DOC_REPO` on `DOC_BRANCH`, containing at least one real HTML
  doc, e.g. `guide.html`.
- **User A**: a member who *has* access to `DOC_REPO`.
- **User B**: a logged-in GitHub user who does *not* have access to `DOC_REPO`.

**Steps & expected results**

| # | Action | Expected |
| --- | --- | --- |
| 1 | As **User A**, browse to `https://<host>/guide.html` with no session. | `302` to `/auth/login` -> GitHub -> back to `/guide.html`. |
| 2 | As **User A** (now authed), load `https://<host>/guide.html`. | **`200`**, body is the raw HTML of `guide.html`, `Content-Type: text/html; charset=utf-8`. The GitHub token appears **nowhere** in cookies, headers, or body. |
| 3 | As **User A**, load a path that does not exist, e.g. `https://<host>/does-not-exist.html`. | **`404`**, body matches `/not found or no access/i`. |
| 4 | As **User B** (authed, no repo access), load `https://<host>/guide.html`. | **`404`**, **byte-identical** status + body to step 3. "missing" and "forbidden" must be indistinguishable. |
| 5 | Diff the responses from steps 3 and 4. | No difference in status, body, or any distinguishing header. |

**Pass criteria:** step 2 serves real HTML; steps 3 and 4 are indistinguishable neutral
404s. If User B can tell their case (forbidden) apart from a missing file, the leak fix
in `docsource.ts` is wrong.

---

## Spike 2 — CONFIRM: GitHub returns 404 (not 403) for a no-access private file

**This is the load-bearing assumption.** The neutral-404 design assumes that when an
authenticated user lacks access to a private repo/file, the Contents API hides its
existence and returns **`404`**. `docsource.ts` collapses **both** `403` and `404` to
the same neutral `404`, so the design is robust either way — but we must **confirm
empirically** which code GitHub actually sends, because:

- if GitHub leaks a `403` (distinct from a `404` for a missing file), our collapse is
  what protects us, and we must verify the collapse is actually exercised;
- if GitHub's own behavior ever changes (e.g. starts returning a distinguishing body or
  header on `403`), the neutral page must still mask it.

**How to confirm (live, with a real token):**

1. As **User B** (no access to the private `DOC_REPO`), capture the **raw upstream**
   status code from
   `GET https://api.github.com/repos/{DOC_OWNER}/{DOC_REPO}/contents/guide.html?ref={DOC_BRANCH}`
   with `Authorization: Bearer <User B token>`,
   `Accept: application/vnd.github.raw+json`, `User-Agent: htmldoc-review-worker`.
   (Temporarily log the upstream status in `fetchDoc`, or replay the same request with
   `curl`/`gh api` using User B's token — do **not** ship the logging.)
2. Record the actual status: is it `404` or `403`?
3. Repeat for a **missing** file in a repo User B *can* read — record that status too.

**Pass criteria:**

- Whatever GitHub returns (`404` or `403`) for no-access, the user-facing response from
  the Worker is the **neutral `404`** ("Not found or no access").
- The no-access response is **indistinguishable** from the genuine-missing response
  (this is what Spike 1 step 5 checks end-to-end).

**Document the finding here after running it:**

```
[ ] Confirmed upstream status for no-access private file: ____ (404 / 403)
[ ] Confirmed upstream status for missing file:           ____ (404)
[ ] Worker masks both to neutral 404: yes / no
[ ] Date / GitHub API version observed: ____
```

If the observed behavior contradicts the assumption (e.g. a `403` that carries a
distinguishing body the neutral page does not mask), file a follow-up before shipping —
do not rely on the current `docsource.ts` collapse.

---

## Spike 3 — Live silent refresh (Tier 1) over a real 8h boundary

**Why manual:** the suite forces `expires_at: 0` and mocks the token endpoint. A real
test proves GitHub actually issues a refresh token (depends on "User-to-server token
expiration" being ON) and that `arctic.refreshAccessToken()` succeeds against live
GitHub with a real rotated refresh token.

**Steps**

1. Log in as User A; confirm a session row exists in KV (`sess:<id>`).
2. Either wait past the 8h access-token life, or temporarily seed the KV value's
   `expires_at` to a past timestamp (via `wrangler kv key put`).
3. Load `https://<host>/guide.html`.

**Pass criteria:** the request succeeds (`200`, no re-login bounce); exactly one refresh
happened; the KV value now holds a **new** `access_token` **and a rotated**
`refresh_token`; the **same** session id / cookie is retained.

---

## Spike 4 — Live re-login (Tier 2) on a dead refresh token

**Why manual:** the suite mocks an `OAuth2RequestError`. Confirm the real path when a
refresh token is revoked.

**Steps**

1. Log in as User A.
2. Revoke the App's authorization for User A (GitHub user settings -> Applications), or
   uninstall/re-install the App so the refresh token is invalidated.
3. Force an access-token refresh (as in Spike 3 step 2) and load `https://<host>/guide.html`.

**Pass criteria:** the viewer is redirected (`302`) to `/auth/login` — **not** a `5xx` —
and the dead session may be deleted from KV. After re-login they reach the doc again.

---

## Spike 5 — Live logout

**Steps**

1. Log in; confirm `sess:<id>` exists in KV.
2. Hit `https://<host>/auth/logout`.

**Pass criteria:** the KV session is deleted (`wrangler kv key get sess:<id>` -> not
found) and the session cookie is cleared (`Set-Cookie` with `Max-Age=0`). A subsequent
doc request bounces to `/auth/login`.

---

## Pre-ship summary checklist

```
[ ] Spike 1: live 200 serves raw HTML; live 404 and live forbidden are indistinguishable
[ ] Spike 2: CONFIRMED GitHub's actual no-access status (404 vs 403); both masked to neutral 404
[ ] Spike 3: live Tier-1 silent refresh works; refresh token rotated; session id unchanged
[ ] Spike 4: live Tier-2 dead-refresh-token -> 302 to /auth/login, not 5xx
[ ] Spike 5: live logout deletes KV session + clears cookie
[ ] "User-to-server token expiration" confirmed ON in the App's Optional features
[ ] No debug logging of upstream status or tokens left in shipped code
```
