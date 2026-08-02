// The local runtime's fixed reviewer identity. The local server stamps it into
// the injected seed (inject.ts), and the widget uses it as the fallback when a
// seed carries no parseable author — both ends agree on one identity.

import type { Author } from '../../review-ux/types';

export const LOCAL_AUTHOR: Author = { login: 'user', name: null };
