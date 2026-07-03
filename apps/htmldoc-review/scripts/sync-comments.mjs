#!/usr/bin/env node
// Sync the DOM-free shared comment sources from the htmldocs skill into this
// app (src/comments/), verbatim. The skill is the single editable source of
// truth; src/comments/ is a GENERATED vendored copy.
//
// Why vendor at all: the Worker mounts D1Store (src/worker/d1-store.ts), which
// imports the shared ICommentsStore + op semantics + Zod envelope validator via
// src/core/comments-seam.ts. wrangler bundles from src/worker/index.ts, so those
// shared sources must live INSIDE the app root — an import that climbs above the
// app (../../../../plugins/...) cannot be carried by vendor.sh (it rsyncs only
// apps/htmldoc-review) and would break `wrangler deploy` from a vendored copy.
// Copying the six DOM-free files here keeps every import non-escaping.
//
// Only the six files the Worker actually imports are copied — the closure is
// DOM-free (branded types, ICommentsStore, thread-ops, the Zod schema, the
// handlers, and the api barrel). The DOM-tainted review-ux widget files
// (composer/popover/gutter/highlight/mount/anchor/inject) are deliberately NOT
// copied: the Worker never imports them and they would break its DOM-less,
// es2022-only typecheck.
//
// Idempotent: re-running produces byte-identical files. Drift (someone edited the
// app copy instead of upstream) is caught by the gate's
// `git diff --exit-code -- src/comments` after this script runs.
//
// Workflow: edit the sources in the skill, then run `npm run sync:comments`.

import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdirSync, copyFileSync } from "node:fs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "..", "..");

const SRC = resolve(
  repoRoot,
  "plugins/useful-skills/skills/htmldocs/src/comments",
);
const DEST = join(appRoot, "src", "comments");

// The six-file DOM-free closure the Worker imports (see header). Paths are
// relative to SRC / DEST and preserve the review-ux/ + api/ layout so the files'
// own internal relative imports (./types, ../review-ux/types, ...) stay valid.
const FILES = [
  "review-ux/types.ts",
  "review-ux/store.ts",
  "api/thread-ops.ts",
  "api/schemas.ts",
  "api/handlers.ts",
  "api/index.ts",
];

for (const rel of FILES) {
  const from = join(SRC, rel);
  const to = join(DEST, rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`synced ${rel}`);
}

console.log(`\n${FILES.length} files synced from\n  ${SRC}\ninto\n  ${DEST}`);
