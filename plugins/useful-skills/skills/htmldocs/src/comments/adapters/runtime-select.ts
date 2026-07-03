// Runtime discriminator — the pure hosted-vs-local choice, extracted so it is
// unit-testable without constructing a DOM-bound store.
//
// The injected seed carries a top-level `author` ONLY on the hosted Worker path
// (stamped from the captured session identity); the local seed never stamps one.
// So a non-null seed author means "hosted"; its absence means "local". NOTE both
// builders now construct the SAME HttpCommentsStore — the discriminator only
// selects the author (real GitHub identity vs. fixed "user"), not the store.
// Node-safe and DOM-free: it takes the resolved author and the two builders and
// returns the chosen MountDeps, constructing nothing itself.

import type { Author } from '../review-ux/types';
import type { MountDeps } from '../review-ux/store';

export function chooseDeps(
  seedAuthor: Author | null,
  buildHosted: (author: Author) => MountDeps,
  buildLocal: () => MountDeps,
): MountDeps {
  return seedAuthor ? buildHosted(seedAuthor) : buildLocal();
}
