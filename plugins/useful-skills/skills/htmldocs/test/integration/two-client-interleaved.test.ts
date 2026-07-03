// Two SidecarStore instances over ONE shared file-backed persistence, driven
// with interleaved create/resolve ops. This proves PER-OP no-clobber: because
// each op is an independent load -> apply -> save against the shared sidecar,
// two "clients" writing in turn never overwrite each other's whole-file state
// the way the old model PUT did. It is NOT transactional and makes no atomicity
// or concurrency-isolation claim — the ops here are interleaved sequentially,
// one settled before the next starts; the point is that every op lands.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SidecarStore } from '../../src/comments/adapters/local/sidecar-store';
import type { SidecarPersistence } from '../../src/comments/adapters/local/sidecar-store';
import { readSidecarFile, writeSidecarFile } from './sidecar-fs';

const DOC = { repo: '', ref: 'default', path: '/doc.html' };
const AUTHOR = { login: 'user', name: null };

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-2client.'));
  file = path.join(dir, 'doc.comments.json');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// Both stores share ONE file: every op reloads the current on-disk state, so a
// store always sees the other's committed writes before applying its own.
function makeStore(mintPrefix: string): SidecarStore {
  let n = 0;
  const persistence: SidecarPersistence = {
    load: () => readSidecarFile(file, 'doc.html'),
    save: (model) => writeSidecarFile(file, model),
  };
  return new SidecarStore(persistence, 'doc.html', () => `${mintPrefix}-${++n}`);
}

describe('two clients over one shared sidecar — per-op no-clobber', () => {
  it('interleaved create/resolve across two stores: every op lands, none clobbers another', async () => {
    const a = makeStore('a');
    const b = makeStore('b');

    // Interleave: A creates, B creates (must NOT drop A's), A resolves its own,
    // B creates again, A creates again, B resolves its first.
    const t1 = await a.create(DOC, { op: 'create', anchor: { exact: 'one' }, text: 'from A #1' }, AUTHOR);
    const t2 = await b.create(DOC, { op: 'create', anchor: { exact: 'two' }, text: 'from B #1' }, AUTHOR);
    await a.resolve(DOC, { op: 'resolve', threadId: t1.id }, AUTHOR);
    const t3 = await b.create(DOC, { op: 'create', anchor: { exact: 'three' }, text: 'from B #2' }, AUTHOR);
    const t4 = await a.create(DOC, { op: 'create', anchor: { exact: 'four' }, text: 'from A #2' }, AUTHOR);
    await b.resolve(DOC, { op: 'resolve', threadId: t2.id }, AUTHOR);

    // Read the final state through a fresh store — no op was clobbered.
    const listed = await makeStore('c').list(DOC);
    const byId = new Map(listed.map((t) => [t.id, t]));
    expect(listed).toHaveLength(4);
    expect([...byId.keys()].sort()).toEqual([t1.id, t2.id, t3.id, t4.id].sort());

    // Both the ops that resolved are resolved; the others stay open.
    expect(byId.get(t1.id)!.resolvedAt).not.toBeNull();
    expect(byId.get(t2.id)!.resolvedAt).not.toBeNull();
    expect(byId.get(t3.id)!.resolvedAt).toBeNull();
    expect(byId.get(t4.id)!.resolvedAt).toBeNull();

    // Bodies survived intact — B's creates never overwrote A's and vice-versa.
    expect(byId.get(t1.id)!.root.body).toBe('from A #1');
    expect(byId.get(t2.id)!.root.body).toBe('from B #1');
    expect(byId.get(t3.id)!.root.body).toBe('from B #2');
    expect(byId.get(t4.id)!.root.body).toBe('from A #2');
  });
});
