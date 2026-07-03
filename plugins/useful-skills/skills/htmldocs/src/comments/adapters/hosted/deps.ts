// Builds MountDeps for the hosted Worker runtime: the browser HostedStore over
// the `?comments` body-op API + the real GitHub author carried on the injected
// seed (stamped server-side at login, read out in main.ts and passed in here).

import type { MountDeps } from '../../review-ux/store';
import type { Author } from '../../review-ux/types';
import { HostedStore } from './store';

export function buildHostedDeps(author: Author): MountDeps {
  return { store: new HostedStore(), author };
}
