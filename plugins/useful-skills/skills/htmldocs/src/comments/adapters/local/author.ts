// The local runtime's fixed reviewer identity. The local server stamps it into
// the injected seed (inject.ts), and the widget uses it as the fallback when a
// seed carries no parseable author — both ends agree on one identity. The
// login doubles as the legacy sidecar author string (threadToLegacy persists
// author.login), so it is part of the on-disk format; change it only with the
// legacy layer in view.

import type { Author } from '../../review-ux/types';

export const LOCAL_AUTHOR: Author = { login: 'user', name: null };
