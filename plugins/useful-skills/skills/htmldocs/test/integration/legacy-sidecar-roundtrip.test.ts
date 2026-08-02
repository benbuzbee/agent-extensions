// A pre-existing LEGACY sidecar loads, mutates, and persists format-unchanged.
// Reuses the real drift-exact-preserved fixture (already a legacy comment on
// disk) to prove the on-disk *.comments.json shape is UNTOUCHED by the transport
// convergence — SidecarStore reads Thread[] out of the legacy JSON and writes
// the legacy JSON back, so existing files keep working with zero migration.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarStore } from '../../src/comments/adapters/local/sidecar-store';
import { readSidecarFile, writeSidecarFile } from './sidecar-fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/drift-exact-preserved/index.comments.json');

const DOC = { repo: '', ref: 'default', path: '/index.html' };
const AUTHOR = { login: 'user', name: null };

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-legacy-rt.'));
  file = path.join(dir, 'index.comments.json');
  await fs.copyFile(FIXTURE, file);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeStore(): SidecarStore {
  return new SidecarStore(
    { load: () => readSidecarFile(file, 'index.html'), save: (m) => writeSidecarFile(file, m) },
    'index.html',
  );
}

describe('legacy sidecar round-trip — on-disk format unchanged', () => {
  it('loads the legacy comment as a Thread', async () => {
    const threads = await makeStore().list(DOC);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.id).toBe('c1');
    expect(threads[0]!.anchor.exact).toBe('quick brown fox');
    expect(threads[0]!.root.body).toBe('Is this still the right metaphor here?');
    // Legacy author string -> internal Author with login + null name.
    expect(threads[0]!.root.author).toEqual({ login: 'user', name: null });
    // createdAt is a numeric epoch-ms Timestamp internally.
    expect(typeof threads[0]!.root.createdAt).toBe('number');
    expect(threads[0]!.resolvedAt).toBeNull();
  });

  it('a resolve persists back in the unchanged legacy JSON shape', async () => {
    await makeStore().resolve(DOC, { op: 'resolve', threadId: 'c1' as never }, AUTHOR);

    // Read the raw file — it must still be the LEGACY shape, not the internal one.
    const raw = JSON.parse(await fs.readFile(file, 'utf-8'));
    expect(raw.doc).toBe('index.html');
    expect(raw.schema).toBe(1);
    expect(raw.comments).toHaveLength(1);
    const c = raw.comments[0];
    expect(c.id).toBe('c1');
    // author is a legacy STRING, created_at is a legacy ISO string.
    expect(c.author).toBe('user');
    expect(typeof c.created_at).toBe('string');
    expect(c.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // resolve stamped an ISO resolved_at (mirroring created_at) — no new fields
    // beyond the documented legacy ones, no internal { root, replies } leakage.
    expect(typeof c.resolved_at).toBe('string');
    expect(c.resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(c.root).toBeUndefined();
    expect(c.replies).toBeUndefined();
    // The anchor stays in the legacy flat quad (sections/prefix/exact/suffix).
    expect(c.anchor).toEqual({
      sections: ['alpha'],
      prefix: 'talks about the ',
      exact: 'quick brown fox',
      suffix: ' and then continues',
    });
  });
});
