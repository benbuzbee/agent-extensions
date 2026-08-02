// Zod envelope validation — no store. Every rejection is a parse-fail, which
// is the single source of the API's 400.
import { describe, it, expect } from 'vitest';
import { parseEnvelope } from '../../src/comments/api/schemas';

describe('parseEnvelope — anchor shape', () => {
  it('accepts a minimal create anchor {exact}', () => {
    const r = parseEnvelope({ op: 'create', anchor: { exact: 'hello' }, text: 'hi' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.isBatch).toBe(false);
      expect(r.ops[0]).toMatchObject({ op: 'create', anchor: { exact: 'hello' }, text: 'hi' });
    }
  });

  it('accepts a full anchor {prefix,exact,suffix,sections}', () => {
    const r = parseEnvelope({
      op: 'create',
      anchor: { prefix: 'as the ', exact: 'access probe', suffix: ' authorizes', sections: ['main'] },
      text: 'question?',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects create missing exact', () => {
    const r = parseEnvelope({ op: 'create', anchor: { prefix: 'x' }, text: 'hi' });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-string sections element', () => {
    const r = parseEnvelope({ op: 'create', anchor: { exact: 'x', sections: [1] }, text: 'hi' });
    expect(r.ok).toBe(false);
  });
});

describe('parseEnvelope — op envelope', () => {
  it('rejects an unknown op value', () => {
    const r = parseEnvelope({ op: 'frobnicate', threadId: 't' });
    expect(r.ok).toBe(false);
  });

  it('rejects create missing text', () => {
    const r = parseEnvelope({ op: 'create', anchor: { exact: 'x' } });
    expect(r.ok).toBe(false);
  });

  it('rejects resolve missing threadId', () => {
    const r = parseEnvelope({ op: 'resolve' });
    expect(r.ok).toBe(false);
  });

  it('rejects a body that is neither a valid op nor an array of ops', () => {
    expect(parseEnvelope('nope').ok).toBe(false);
    expect(parseEnvelope(42).ok).toBe(false);
    expect(parseEnvelope(null).ok).toBe(false);
    expect(parseEnvelope({ foo: 'bar' }).ok).toBe(false);
  });

  it('parses reserved reply/edit (rejection happens in the handler, not here)', () => {
    expect(parseEnvelope({ op: 'reply', threadId: 't', text: 'x' }).ok).toBe(true);
    expect(parseEnvelope({ op: 'edit', commentId: 'c', patch: { body: 'x' } }).ok).toBe(true);
  });

  it('recognizes an array body as a batch', () => {
    const r = parseEnvelope([{ op: 'resolve', threadId: 't1' }, { op: 'delete', threadId: 't2' }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.isBatch).toBe(true);
      expect(r.ops).toHaveLength(2);
    }
  });

  it('strips an author field smuggled in the body (never trusted)', () => {
    const r = parseEnvelope({ op: 'create', anchor: { exact: 'x' }, text: 'hi', author: 'evil' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ops[0] as Record<string, unknown>).not.toHaveProperty('author');
  });
});
