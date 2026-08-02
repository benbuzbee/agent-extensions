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
import type { CommentsModel, Author } from '../../src/comments/review-ux/types';

const SRC = '/__htmldocs/comments.mjs';

function modelWith(body: string): CommentsModel {
  return {
    doc: 'doc.html',
    schema: 1,
    comments: [
      {
        id: 'c1',
        anchor: { sections: [], prefix: '', exact: 'anchor text', suffix: '' },
        body,
        author: 'user',
        created_at: '2026-07-01T00:00:00.000Z',
      },
    ],
  };
}

describe('seedJsonScript escaping', () => {
  it('escapes < so a </script> in a comment body cannot break out', () => {
    const model = modelWith('malicious </script><img src=x> body');
    const seed = seedJsonScript(model);
    // The raw sequence never appears before the seed element's own closing tag.
    const inner = seed.slice(0, seed.lastIndexOf('</script>'));
    expect(inner).not.toContain('</script>');
    expect(inner).toContain('\\u003c/script>');
  });

  it('round-trips the exact body through JSON.parse of the seed text', () => {
    const body = 'weird </script> & <b> chars';
    const model = modelWith(body);
    const seed = seedJsonScript(model);
    const json = seed.slice(
      seed.indexOf('>') + 1,
      seed.lastIndexOf('</script>'),
    );
    const parsed = JSON.parse(json) as CommentsModel;
    expect(parsed.comments[0].body).toBe(body);
  });
});

describe('author carriage', () => {
  it('omitting author is byte-identical to the Deliverable 1 seed', () => {
    const model = modelWith('hello');
    const legacy =
      '<script type="application/json" id="__htmldocs_comments">' +
      JSON.stringify(model).replace(/</g, '\\u003c') +
      '</script>';
    expect(seedJsonScript(model)).toBe(legacy);
    expect(seedJsonScript(model, undefined)).toBe(legacy);
  });

  it('supplying author merges it into the seed JSON', () => {
    const model = modelWith('hello');
    const author: Author = { login: 'octocat', name: 'Mona', id: 42 };
    const seed = seedJsonScript(model, author);
    const json = seed.slice(
      seed.indexOf('>') + 1,
      seed.lastIndexOf('</script>'),
    );
    const parsed = JSON.parse(json) as CommentsModel & { author: Author };
    expect(parsed.author).toEqual(author);
    // The model payload is otherwise unchanged.
    expect(parsed.comments).toEqual(model.comments);
  });
});

describe('injectionFragment', () => {
  it('is the seed + script tag + trailing newlines', () => {
    const model = modelWith('hi');
    expect(injectionFragment(model, SRC)).toBe(
      seedJsonScript(model) + '\n' + widgetScriptTag(SRC) + '\n',
    );
  });
});

describe('local injector delegates to the shared fragment', () => {
  const html = '<html><head></head><body><p>doc</p></body></html>';
  const model = modelWith('a comment');

  it('splices exactly injectionFragment(model, src) before </body>', () => {
    const out = injectIntoHtml(html, model);
    const fragment = injectionFragment(model, SRC);
    // The spliced fragment lands immediately before </body>...
    expect(out).toContain(fragment + '</body>');
    // ...and removing the fragment restores the original html byte-for-byte,
    // proving the injector adds ONLY the shared fragment.
    expect(out.replace(fragment, '')).toBe(html);
  });

  it('appends the fragment when there is no </body>', () => {
    const bodyless = '<div>fragment doc</div>';
    const out = injectIntoHtml(bodyless, model);
    expect(out).toBe(bodyless + '\n' + injectionFragment(model, SRC));
  });
});
