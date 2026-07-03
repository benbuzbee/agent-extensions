// Builds MountDeps for the hosted Worker runtime: the shared HttpCommentsStore
// over the `?comments` body-op API + the real GitHub author carried on the
// injected seed (stamped server-side at login, read out in main.ts and passed
// in here). The store is the SAME one the local runtime builds — only the
// author differs.

import type { MountDeps } from '../../review-ux/store';
import type { Author } from '../../review-ux/types';
import { HttpCommentsStore } from '../http-store';

export function buildHostedDeps(author: Author): MountDeps {
  return { store: new HttpCommentsStore(), author };
}
