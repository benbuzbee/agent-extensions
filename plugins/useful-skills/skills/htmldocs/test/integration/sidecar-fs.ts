// Minimal file-backed legacy-sidecar I/O for the integration tests: read/write
// the legacy CommentsModel JSON on disk (the same shape serve.ts's disk layer
// uses). Kept tiny and dependency-free so tests can wire a real SidecarPersistence
// without importing serve.ts (which pulls in http/yargs).
import * as fs from 'node:fs/promises';
import type { CommentsModel } from '../../src/comments/adapters/local/legacy-format';

export async function readSidecarFile(file: string, docLabel: string): Promise<CommentsModel> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { doc: docLabel, schema: 1, comments: [] };
    }
    throw err;
  }
  if (!text.trim()) return { doc: docLabel, schema: 1, comments: [] };
  return JSON.parse(text) as CommentsModel;
}

export async function writeSidecarFile(file: string, model: CommentsModel): Promise<void> {
  await fs.writeFile(file, JSON.stringify(model, null, 2) + '\n', 'utf-8');
}
