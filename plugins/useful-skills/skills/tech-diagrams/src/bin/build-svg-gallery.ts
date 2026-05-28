#!/usr/bin/env tsx
// Build a single self-contained HTML gallery rendering every valid fixture in
// test/fixtures/ via the new to-svg emitter. Output:
//   skills/tech-diagrams/docs/svg-gallery.html
//
// One-shot artifact generator — not part of the skill's public interface.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../grammar/validate.ts";
import { desugar } from "../desugar/to-elk.ts";
import { layout } from "../layout/run.ts";
import { toSvg } from "../render/to-svg.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, "..", "..");
const FIXTURES_DIR = join(SKILL_ROOT, "test", "fixtures");
const OUT_PATH = join(SKILL_ROOT, "docs", "svg-gallery.html");

interface RenderedFixture {
  name: string;
  yaml: string;
  svg: string;
  nodeCount: number;
  edgeCount: number;
}

async function main(): Promise<number> {
  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".yaml") && !f.startsWith("invalid-"))
    .sort();

  const rendered: RenderedFixture[] = [];
  const failures: { name: string; reason: string }[] = [];

  for (const file of files) {
    const yamlPath = join(FIXTURES_DIR, file);
    const yaml = readFileSync(yamlPath, "utf8");
    const result = validate(yaml);
    if (!result.ok) {
      failures.push({ name: file, reason: "validate: " + JSON.stringify(result.errors) });
      continue;
    }
    try {
      const elk = desugar(result.diagram);
      const laidOut = await layout(elk);
      const slug = basename(file, ".yaml");
      const svg = toSvg(result.diagram, laidOut, { idPrefix: slug + "-" });
      rendered.push({
        name: slug,
        yaml,
        svg,
        nodeCount: Object.keys(result.diagram.nodes).length,
        edgeCount: result.diagram.edges?.length ?? 0,
      });
    } catch (e) {
      failures.push({ name: file, reason: (e as Error).message });
    }
  }

  const html = buildGallery(rendered, failures);
  writeFileSync(OUT_PATH, html);
  process.stdout.write(
    `wrote ${OUT_PATH}\n  rendered: ${rendered.length}\n  failed:   ${failures.length}\n`,
  );
  if (failures.length > 0) {
    for (const f of failures) process.stdout.write(`  - ${f.name}: ${f.reason}\n`);
  }
  // Surface wholesale breakage to CI: if nothing rendered, exit non-zero so a
  // future regression that breaks the whole pipeline is visible.
  if (rendered.length === 0) return 1;
  return 0;
}

function buildGallery(rendered: RenderedFixture[], failures: { name: string; reason: string }[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const toc = rendered.map((r) => `      <li><a href="#fx-${r.name}">${escape(r.name)}</a></li>`).join("\n");
  const articles = rendered.map(renderArticle).join("\n\n");
  const failureBlock = failures.length === 0
    ? ""
    : `\n<aside data-kind="failures"><strong>Failed fixtures (${failures.length}):</strong>\n  <ul>${failures.map((f) => `<li><code>${escape(f.name)}</code> — ${escape(f.reason)}</li>`).join("")}</ul>\n</aside>\n`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>tech-diagrams — SVG renderer gallery</title>
<style>
  :root {
    --bg: #fdfdfc;
    --fg: #1a1a1a;
    --muted: #6a6a6a;
    --accent: #2a5d9f;
    --border: #d8d8d4;
    --code-bg: #f3f3ef;
    --aside-bg: #f7f3e9;
    --aside-border: #d9c98a;
    --svg-bg: transparent;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115;
      --fg: #e6e6e6;
      --muted: #9aa0a6;
      --accent: #7fb1ff;
      --border: #2a2e36;
      --code-bg: #161a21;
      --aside-bg: #1d1a10;
      --aside-border: #5a4a16;
      --svg-bg: transparent;
    }
  }
  html { color-scheme: light dark; }
  body {
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    max-width: 960px;
    margin: 2rem auto;
    padding: 0 1.25rem;
  }
  h1, h2, h3 { line-height: 1.25; }
  h1 { font-size: 1.65rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.25rem; margin: 2rem 0 .5rem; border-bottom: 1px solid var(--border); padding-bottom: .25rem; }
  h3 { font-size: 1.02rem; margin: 1.25rem 0 .35rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  p.meta { color: var(--muted); font-size: .88rem; margin: .25rem 0 1rem; }
  nav.toc { border: 1px solid var(--border); border-radius: 6px; padding: .5rem .9rem; margin: 1rem 0 1.5rem; background: var(--code-bg); }
  nav.toc ol { margin: .25rem 0; padding-left: 1.25rem; column-count: 2; }
  nav.toc li { margin: .1rem 0; }
  article { margin: 2rem 0; border: 1px solid var(--border); border-radius: 6px; padding: .9rem 1.1rem; }
  article header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  article header h2 { border: 0; margin: 0; padding: 0; }
  article header .stats { color: var(--muted); font-size: .85rem; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  figure {
    margin: .75rem 0 .25rem;
    background: var(--svg-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1rem;
    overflow: auto;
  }
  figure svg { display: block; max-width: 100%; height: auto; }
  pre {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: .65rem .8rem;
    overflow-x: auto;
    font-size: .85rem;
  }
  code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .9em; }
  :not(pre) > code { background: var(--code-bg); padding: .05rem .3rem; border-radius: 3px; }
  details { margin: .5rem 0; }
  details summary { cursor: pointer; color: var(--accent); font-size: .9rem; }
  aside {
    background: var(--aside-bg);
    border-left: 3px solid var(--aside-border);
    padding: .55rem .85rem;
    margin: 1.5rem 0;
    border-radius: 0 4px 4px 0;
  }
</style>
</head>
<body>

<h1>tech-diagrams — SVG renderer gallery</h1>
<p class="meta" data-updated="${today}">Last updated ${today} — ${rendered.length} fixture${rendered.length === 1 ? "" : "s"} rendered via <code>render/to-svg.ts</code></p>

<nav class="toc" aria-label="Table of contents">
  <strong>Fixtures</strong>
  <ol>
${toc}
  </ol>
</nav>

<aside data-kind="about">
  Each article below is a single fixture from <code>test/fixtures/</code> run through the same
  <code>validate → desugar → ELK layout</code> pipeline as the Excalidraw emitter, then rendered by
  the new native SVG emitter. The YAML source is folded under each diagram. See
  <a href="./svg-renderer.html">svg-renderer.html</a> for the plan and acceptance criteria.
</aside>
${failureBlock}
${articles}

</body>
</html>
`;
}

function renderArticle(r: RenderedFixture): string {
  // Both `id` and the TOC `href` go through the same escape so they remain in
  // sync for any fixture name (today's slugs are inert; this defends against
  // future fixtures with special characters in their filenames).
  const idAttr = escape(r.name);
  return `<article id="fx-${idAttr}" data-kind="fixture" data-nodes="${r.nodeCount}" data-edges="${r.edgeCount}">
  <header>
    <h2>${escape(r.name)}</h2>
    <span class="stats">${r.nodeCount} node${r.nodeCount === 1 ? "" : "s"} · ${r.edgeCount} edge${r.edgeCount === 1 ? "" : "s"}</span>
  </header>
  <figure>
${indent(r.svg, 4)}
  </figure>
  <details>
    <summary>YAML source</summary>
    <pre><code>${escape(r.yaml)}</code></pre>
  </details>
</article>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s.split("\n").map((l) => pad + l).join("\n");
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`unexpected: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(1);
  });
