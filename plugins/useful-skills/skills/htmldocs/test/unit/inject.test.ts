// Unit tests for the shared injection helpers + the local injector's delegation
// to them. Plain vitest (node) — the hosted HTMLRewriter side is exercised in the
// Worker app's inject.workers.test.ts, the only runtime with HTMLRewriter.
import { describe, it, expect } from 'vitest';
import {
  seedJsonScript,
  widgetScriptTag,
  injectionFragment,
} from '../../src/comments/review-ux/inject';
import { injectIntoHtml } from '../../src/comments/adapters/local/inject';
import { LOCAL_AUTHOR } from '../../src/comments/adapters/local/author';
import type { Thread, Author } from '../../src/comments/review-ux/types';
import { asThreadId, asCommentId, asTimestamp } from '../../src/comments/review-ux/types';

const SRC = '/__htmldocs/comments.mjs';

function threadWith(body: string): Thread {
  return {
    id: asThreadId('c1'),
    anchor: { exact: 'anchor text' },
    root: {
      id: asCommentId('c1'),
      author: { login: 'user', name: null },
      body,
      createdAt: asTimestamp(1000),
    },
    replies: [],
    resolvedAt: null,
  };
}

describe('seedJsonScript escaping', () => {
  it('escapes < so a </script> in a comment body cannot break out', () => {
    const seed = seedJsonScript([threadWith('malicious </script><img src=x> body')]);
    // The raw sequence never appears before the seed element's own closing tag.
    const inner = seed.slice(0, seed.lastIndexOf('</script>'));
    expect(inner).not.toContain('</script>');
    expect(inner).toContain('\\u003c/script>');
  });

  it('round-trips the exact body through JSON.parse of the seed text', () => {
    const body = 'weird </script> & <b> chars';
    const seed = seedJsonScript([threadWith(body)]);
    const json = seed.slice(
      seed.indexOf('>') + 1,
      seed.lastIndexOf('</script>'),
    );
    const parsed = JSON.parse(json) as { threads: Thread[] };
    expect(parsed.threads[0]!.root.body).toBe(body);
  });
});

describe('seed shape + author carriage', () => {
  it('the seed is { threads } when no author is supplied', () => {
    const threads = [threadWith('hello')];
    const legacy =
      '<script type="application/json" id="__htmldocs_comments">' +
      JSON.stringify({ threads }).replace(/</g, '\\u003c') +
      '</script>';
    expect(seedJsonScript(threads)).toBe(legacy);
    expect(seedJsonScript(threads, undefined)).toBe(legacy);
  });

  it('supplying author merges it as a top-level field alongside threads', () => {
    const threads = [threadWith('hello')];
    const author: Author = { login: 'octocat', name: 'Mona', id: 42 };
    const seed = seedJsonScript(threads, author);
    const json = seed.slice(
      seed.indexOf('>') + 1,
      seed.lastIndexOf('</script>'),
    );
    const parsed = JSON.parse(json) as { threads: Thread[]; author: Author };
    expect(parsed.author).toEqual(author);
    // The threads payload is otherwise unchanged.
    expect(parsed.threads).toEqual(threads);
  });
});

describe('injectionFragment', () => {
  it('is the seed + script tag + trailing newlines', () => {
    const threads = [threadWith('hi')];
    expect(injectionFragment(threads, SRC)).toBe(
      seedJsonScript(threads) + '\n' + widgetScriptTag(SRC) + '\n',
    );
  });
});

describe('local injector delegates to the shared fragment', () => {
  const html = '<html><head></head><body><p>doc</p></body></html>';
  const threads = [threadWith('a comment')];

  it('splices exactly the LOCAL_AUTHOR-stamped fragment before </body>', () => {
    const out = injectIntoHtml(html, threads);
    const fragment = injectionFragment(threads, SRC, LOCAL_AUTHOR);
    // The spliced fragment lands immediately before </body>...
    expect(out).toContain(fragment + '</body>');
    // ...and removing the fragment restores the original html byte-for-byte,
    // proving the injector adds ONLY the shared fragment.
    expect(out.replace(fragment, '')).toBe(html);
  });

  it('appends the fragment when there is no </body>', () => {
    const bodyless = '<div>fragment doc</div>';
    const out = injectIntoHtml(bodyless, threads);
    expect(out).toBe(bodyless + '\n' + injectionFragment(threads, SRC, LOCAL_AUTHOR));
  });
});
