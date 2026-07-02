// Builds MountDeps for the local runtime: LocalFileStore + fixed author.

import type { MountDeps } from '../../review-ux/store';
import { LocalFileStore } from './local-file-store';

export function buildLocalDeps(): MountDeps {
  return {
    store: new LocalFileStore(),
    author: { login: 'user', name: null },
  };
}
