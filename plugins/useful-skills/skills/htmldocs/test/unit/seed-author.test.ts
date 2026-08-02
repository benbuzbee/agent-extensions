import { describe, it, expect } from 'vitest';
import { parseAuthor } from '../../src/comments/review-ux/types';
import { LOCAL_AUTHOR } from '../../src/comments/adapters/local/author';

// parseAuthor is the ONLY route from seed JSON to an Author the widget will
// trust. It parses, never casts: a full valid shape comes back as a fresh
// object, anything less is rejected whole — the widget then falls back to
// LOCAL_AUTHOR, so a malformed seed can never smuggle in a partial identity.
describe('parseAuthor — seed identity is parsed, never cast', () => {
  it('accepts a full author and rebuilds it field by field', () => {
    expect(parseAuthor({ login: 'octocat', name: 'Mona', id: 7 })).toEqual({
      login: 'octocat',
      name: 'Mona',
      id: 7,
    });
  });

  it('normalizes an absent name to null and omits an absent id', () => {
    expect(parseAuthor({ login: 'octocat' })).toEqual({ login: 'octocat', name: null });
  });

  it('rejects a wrong-typed name or id rather than letting it leak', () => {
    expect(parseAuthor({ login: 'octocat', name: 42 })).toBeNull();
    expect(parseAuthor({ login: 'octocat', id: 'seven' })).toBeNull();
  });

  it('rejects a missing/empty login and non-object values', () => {
    expect(parseAuthor({ name: 'Mona' })).toBeNull();
    expect(parseAuthor({ login: '' })).toBeNull();
    expect(parseAuthor(null)).toBeNull();
    expect(parseAuthor('octocat')).toBeNull();
    expect(parseAuthor(undefined)).toBeNull();
  });
});

describe('LOCAL_AUTHOR — the shared fixed identity', () => {
  it('matches the legacy sidecar author string on its login', () => {
    // threadToLegacy persists author.login as the on-disk author, so this
    // login is part of the sidecar format.
    expect(LOCAL_AUTHOR).toEqual({ login: 'user', name: null });
  });
});
