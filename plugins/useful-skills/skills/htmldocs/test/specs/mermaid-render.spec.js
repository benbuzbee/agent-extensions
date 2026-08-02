import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Proves the inline-Mermaid contract (references/mermaid.md): one per-document
// CDN script renders every <pre class="mermaid"> to SVG in-browser, the DSL
// stays on disk as the canonical source, and a failed CDN load degrades to the
// readable DSL text (no doc-breaking failure).
//
// CDN choice: rendering needs the mermaid@11 ESM bundle. Vendoring it here is
// impractical — it's a large multi-file ESM graph we can't pin offline without
// committing a brittle copy. So the POSITIVE case hits the real jsdelivr CDN
// (guarded by a generous timeout; this case NEEDS NETWORK and will fail if the
// runner is offline). The NEGATIVE case is fully deterministic: page.route()
// aborts the jsdelivr request to simulate offline, asserting the fallback.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureFile = path.resolve(here, '../fixtures/mermaid/index.html');
const FIXTURE = '/test/fixtures/mermaid/index.html';
const CDN_GLOB = 'https://cdn.jsdelivr.net/npm/mermaid@11/**';

test('positive: one script renders every diagram to SVG; DSL stays on disk (needs network)', async ({ page }) => {
  await page.goto(FIXTURE);

  // mermaid.run() rewrites each pre.mermaid into a rendered <svg>. Wait on the
  // CDN round-trip with a generous budget rather than a fixed sleep.
  await expect(page.locator('#flow svg')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#seq svg')).toBeVisible({ timeout: 30_000 });

  // Both figures rendered from a single script.
  await expect(page.locator('figure[data-kind="diagram"] svg')).toHaveCount(2);

  // The visible DSL text is gone — the <pre>'s source DSL no longer shows.
  await expect(page.locator('#flow')).not.toContainText('flowchart LR');
  await expect(page.locator('#seq')).not.toContainText('participant W as Worker');

  // The escaping rule held: the decoded ->> arrow parsed (Worker/Postgres
  // participants render as labels) rather than erroring on the raw entities.
  // Use the retrying toContainText matcher, not a one-shot textContent() read:
  // mermaid.run() makes the <svg> visible before it finishes populating the
  // sequence diagram's label text nodes, so a single snapshot can race and see
  // an empty string.
  await expect(page.locator('#seq svg')).toContainText('Worker');
  await expect(page.locator('#seq svg')).toContainText('Postgres');

  // Canonical source is ephemeral-SVG in the live DOM but durable DSL on disk:
  // the on-disk fixture still holds the authored <pre class="mermaid"> blocks.
  const source = await readFile(fixtureFile, 'utf8');
  expect(source).toContain('<pre class="mermaid">flowchart LR');
  expect(source).toContain('W-&gt;&gt;DB: write row');
});

test('negative: CDN failure degrades to DSL-as-text, no SVG (offline fallback)', async ({ page }) => {
  // Simulate offline: abort the mermaid import so nothing renders.
  await page.route(CDN_GLOB, (route) => route.abort());
  await page.goto(FIXTURE);
  // Let the doomed import settle so this proves rendering FAILED, not that it
  // merely hasn't started yet (a bare count-0 at t=0 would be trivially true).
  await page.waitForLoadState('networkidle');

  // mermaid.run() stamps data-processed="true" on each block it renders. With the
  // import aborted, run() never executes, so the attribute stays absent — a stable
  // proof rendering did not occur (it can't flip true later).
  expect(await page.locator('#flow pre.mermaid').getAttribute('data-processed')).toBeNull();
  expect(await page.locator('#seq pre.mermaid').getAttribute('data-processed')).toBeNull();
  await expect(page.locator('figure[data-kind="diagram"] svg')).toHaveCount(0);

  // The <pre class="mermaid"> still shows its DSL as readable text — the
  // designed fallback, not a broken doc.
  await expect(page.locator('#flow pre.mermaid')).toContainText('flowchart LR');
  await expect(page.locator('#seq pre.mermaid')).toContainText('write row');
});
