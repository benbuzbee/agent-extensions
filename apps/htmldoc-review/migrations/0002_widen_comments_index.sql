-- Rebuild idx_comments_doc so it covers list()'s ORDER BY (created_at, id) in
-- addition to its predicate (repo, ref, path), making the per-load list a single
-- ordered index scan with no post-sort.
--
-- Why a rebuild instead of only creating it in 0001: 0001's index definition was
-- widened after it had already run on a live database, and migrations apply once
-- per database — so a database can arrive here with EITHER shape. This converges
-- both: a narrow (repo, ref, path) index is replaced by the wide one, and an
-- already-wide index is rebuilt identically. An index is derived data, so neither
-- path touches a row; list() stays correct throughout via its explicit ORDER BY.
DROP INDEX IF EXISTS idx_comments_doc;
CREATE INDEX idx_comments_doc ON comments (repo, ref, path, created_at, id);
