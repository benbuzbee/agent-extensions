// Stub — D1Store implementation for the hosted Worker adapter.
//
// The concrete D1Store lives in the Worker app, not here: it depends on the
// Cloudflare `D1Database` global (which this skill package has no types for)
// and is validated with real-D1-in-Miniflare round-trips. See
// apps/htmldoc-review/src/worker/d1-store.ts. A later "physical-home" phase
// relocates the shared comments sources into the app so the Worker can import
// this contract without escaping its root; until then this alias just names the
// seam the Worker fulfils.

import type { ICommentsStore } from '../../review-ux/store';

export type D1StoreType = ICommentsStore;
