-- Migration 0001 — the v1 comments table (schema_version = 1).
-- One row per thread root. Timestamps are epoch-ms INTEGERs end to end (the
-- same number crosses JSON unchanged — no ISO strings). A missing ?ref= is
-- stored as the literal sentinel 'default' (never '' or NULL); route and store
-- agree on that sentinel.
CREATE TABLE comments (
  id           TEXT PRIMARY KEY,               -- server-minted uuid
  repo         TEXT NOT NULL,                  -- e.g. "internal-automation"
  ref          TEXT NOT NULL DEFAULT 'default',-- branch/tag/sha; 'default' == no ref requested
  path         TEXT NOT NULL,                  -- doc path within the repo
  anchor       TEXT NOT NULL,                  -- JSON: {sections, prefix, exact, suffix}
  body         TEXT NOT NULL,
  author_login TEXT NOT NULL,                  -- GitHub login, from the session (snapshot)
  author_name  TEXT,                           -- display name, from the session (nullable, snapshot)
  author_id    INTEGER NOT NULL,               -- stable GitHub numeric id from the resolved identity (session capture, or GET /user for a bearer mutation); 0 only if an id-less author ever reaches the store (no Worker path stamps one). Snapshot; NOT resolved at render
  created_at   INTEGER NOT NULL,               -- epoch-ms; the same number crosses JSON unchanged (no ISO)
  resolved_at  INTEGER                         -- nullable epoch-ms; NULL == open
);

-- Covers Q1's predicate (repo, ref, path) AND its ORDER BY (created_at, id), so
-- list() is a single ordered index scan — no post-sort, deterministic on
-- created_at ties (id, the PK, breaks them).
CREATE INDEX idx_comments_doc ON comments (repo, ref, path, created_at, id);
