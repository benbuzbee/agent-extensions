// The v2 sidecar disk layer: readSidecar loads the internal Thread[] verbatim
// and refuses anything that isn't the v2 model. A parseable object that fails
// v2 validation (e.g. an older schema:1 file) is not silently dropped — it
// warns once per read so the reviewer knows prior comments aren't shown; only
// ENOENT, blank files, and unparseable JSON stay silent-empty.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readSidecar, startReviewServer } from '../../src/comments/serve';

// A schema:1 legacy file — the retired on-disk shape. readSidecar must reject
// it (warn + empty) rather than trying to interpret it.
const LEGACY_SCHEMA1 = {
  doc: 'index.html',
  schema: 1,
  comments: [{
    id: 'c1',
    anchor: { sections: ['alpha'], prefix: 'talks about the ', exact: 'quick brown fox', suffix: ' and then continues' },
    body: 'Is this still the right metaphor here?',
    author: 'user',
    created_at: '2026-05-25T10:00:00Z',
  }],
};

// A well-formed v2 model carrying one internal Thread verbatim.
const V2_MODEL = {
  doc: 'index.html',
  schema: 2,
  threads: [{
    id: 'c1',
    anchor: { exact: 'quick brown fox', prefix: 'talks about the ', suffix: ' and then continues', sections: ['alpha'] },
    root: { id: 'c1', author: { login: 'user', name: null }, body: 'Is this still the right metaphor?', createdAt: 1779098400000 },
    replies: [],
    resolvedAt: null,
  }],
};

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-v2.'));
  file = path.join(dir, 'index.comments.json');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readSidecar — v2 on-disk model', () => {
  it('loads a v2 file as its internal Thread[] verbatim', async () => {
    await fs.writeFile(file, JSON.stringify(V2_MODEL), 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const model = await readSidecar(file, 'index.html');
    expect(model.schema).toBe(2);
    expect(model.threads).toHaveLength(1);
    expect(model.threads[0]!.id).toBe('c1');
    expect(model.threads[0]!.root.author).toEqual({ login: 'user', name: null });
    expect(model.threads[0]!.root.createdAt).toBe(1779098400000);
    expect(model.threads[0]!.resolvedAt).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns exactly once and loads empty for a schema:1 file', async () => {
    await fs.writeFile(file, JSON.stringify(LEGACY_SCHEMA1), 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const model = await readSidecar(file, 'index.html');
    expect(model).toEqual({ doc: 'index.html', schema: 2, threads: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `[serve] ignoring sidecar ${file}: unsupported schema (expected 2); loading as empty`,
    );
  });

  it('warns and loads empty for a parseable-but-junk object', async () => {
    await fs.writeFile(file, JSON.stringify({ hello: 'world' }), 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const model = await readSidecar(file, 'index.html');
    expect(model).toEqual({ doc: 'index.html', schema: 2, threads: [] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is silently empty for unparseable JSON', async () => {
    await fs.writeFile(file, 'this is not json {', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const model = await readSidecar(file, 'index.html');
    expect(model).toEqual({ doc: 'index.html', schema: 2, threads: [] });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('startReviewServer — schema:1 sidecar loads as empty end-to-end', () => {
  it('serves the doc and injects a seed with zero threads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-v2-root.'));
    const sidecarDir = await fs.mkdtemp(path.join(os.tmpdir(), 'htmldocs-v2-sidecar.'));
    await fs.writeFile(path.join(root, 'index.html'), '<!DOCTYPE html><html><body><p>hi</p></body></html>', 'utf-8');
    await fs.writeFile(path.join(sidecarDir, 'index.comments.json'), JSON.stringify(LEGACY_SCHEMA1), 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handle = await startReviewServer({ root, sidecarDir });
    try {
      const res = await fetch(`${handle.url}/index.html`);
      expect(res.status).toBe(200);
      const html = await res.text();
      const m = html.match(/<script type="application\/json" id="__htmldocs_comments">(.*?)<\/script>/);
      expect(m).not.toBeNull();
      const seed = JSON.parse(m![1]!.replace(/\\u003c/g, '<'));
      expect(seed.threads).toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      await handle.close();
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(sidecarDir, { recursive: true, force: true });
    }
  });
});
