// Minimal file-backed sidecar I/O for the integration tests: read/write the
// v2 SidecarModel JSON on disk (the same shape serve.ts's disk layer uses).
// Kept tiny and dependency-free so tests can wire a real SidecarPersistence
// without importing serve.ts (which pulls in http/yargs).
import * as fs from 'node:fs/promises';
import type { SidecarModel } from '../../src/comments/adapters/local/sidecar-store';

export async function readSidecarFile(file: string, docLabel: string): Promise<SidecarModel> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { doc: docLabel, schema: 2, threads: [] };
    }
    throw err;
  }
  if (!text.trim()) return { doc: docLabel, schema: 2, threads: [] };
  return JSON.parse(text) as SidecarModel;
}

export async function writeSidecarFile(file: string, model: SidecarModel): Promise<void> {
  await fs.writeFile(file, JSON.stringify(model, null, 2) + '\n', 'utf-8');
}
