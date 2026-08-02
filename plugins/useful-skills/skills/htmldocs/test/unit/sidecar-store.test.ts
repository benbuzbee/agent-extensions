import { describe, it, expect } from 'vitest';
import { SidecarStore } from '../../src/comments/adapters/local/sidecar-store';
import type { SidecarPersistence } from '../../src/comments/adapters/local/sidecar-store';
import type { CommentsModel, CreateOp } from '../../src/comments/review-ux/types';
import { asThreadId } from '../../src/comments/review-ux/types';

const DOC = { repo: '', ref: 'default', path: '/doc.html' };
const AUTHOR = { login: 'user', name: null };

function memoryPersistence(): SidecarPersistence & { model: CommentsModel } {
  const state = { model: { doc: 'doc.html', schema: 1, comments: [] } as CommentsModel };
  return {
    get model() { return state.model; },
    async load() { return state.model; },
    async save(model: CommentsModel) { state.model = model; },
  };
}

describe('SidecarStore', () => {
  it('create → list round-trips', async () => {
    const p = memoryPersistence();
    const store = new SidecarStore(p, 'doc.html');
    const op: CreateOp = { op: 'create', anchor: { exact: 'hello' }, text: 'a note' };
    const thread = await store.create(DOC, op, AUTHOR);
    const listed = await store.list(DOC);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(thread.id);
    expect(listed[0]!.root.body).toBe('a note');
  });

  it('resolve is idempotent at the store level', async () => {
    const p = memoryPersistence();
    const store = new SidecarStore(p, 'doc.html');
    const thread = await store.create(DOC, { op: 'create', anchor: { exact: 'x' }, text: 'hi' }, AUTHOR);
    const first = await store.resolve(DOC, { op: 'resolve', threadId: thread.id }, AUTHOR);
    const second = await store.resolve(DOC, { op: 'resolve', threadId: thread.id }, AUTHOR);
    expect(second.resolvedAt).toBe(first.resolvedAt);
  });

  it('delete purges the thread', async () => {
    const p = memoryPersistence();
    const store = new SidecarStore(p, 'doc.html');
    const thread = await store.create(DOC, { op: 'create', anchor: { exact: 'x' }, text: 'hi' }, AUTHOR);
    await store.delete(DOC, { op: 'delete', threadId: thread.id }, AUTHOR);
    expect(await store.list(DOC)).toHaveLength(0);
  });

  it('missing threadId surfaces a not_found-tagged error', async () => {
    const p = memoryPersistence();
    const store = new SidecarStore(p, 'doc.html');
    await expect(
      store.resolve(DOC, { op: 'resolve', threadId: asThreadId('ghost') }, AUTHOR),
    ).rejects.toMatchObject({ opError: { code: 'not_found' } });
  });

  it('serialized output matches the legacy CommentsModel shape', async () => {
    const p = memoryPersistence();
    const store = new SidecarStore(p, 'doc.html');
    await store.create(DOC, { op: 'create', anchor: { sections: ['main'], prefix: 'a ', exact: 'note', suffix: ' here' }, text: 'body' }, AUTHOR);
    const m = p.model;
    expect(m.schema).toBe(1);
    expect(m.doc).toBe('doc.html');
    expect(m.comments).toHaveLength(1);
    const c = m.comments[0]!;
    expect(c.author).toBe('user');            // legacy: author is a string
    expect(typeof c.created_at).toBe('string'); // legacy: ISO string
    expect(c.anchor).toEqual({ sections: ['main'], prefix: 'a ', exact: 'note', suffix: ' here' });
  });
});
