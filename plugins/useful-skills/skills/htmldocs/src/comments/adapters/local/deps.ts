// Builds MountDeps for the local runtime: the shared HttpCommentsStore (over the
// local server's ?comments route, backed by SidecarStore) + a fixed "user"
// author. The store is byte-for-byte the same client the hosted runtime builds;
// only the author differs.

import type { MountDeps } from '../../review-ux/store';
import { HttpCommentsStore } from '../http-store';

export function buildLocalDeps(): MountDeps {
  return {
    store: new HttpCommentsStore(),
    author: { login: 'user', name: null },
  };
}
