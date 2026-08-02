# Developing htmldocs

Consumers of this skill need **only Node** — `dist/comments.mjs` and `dist/serve.mjs`
are committed, so `node dist/serve.mjs` runs with no `npm install`. Everything below is for
working *on* the skill.

## Setup

```bash
cd plugins/useful-skills/skills/htmldocs
npm ci
npx playwright install --with-deps chromium
```

## Checks

```bash
npm run check      # typecheck + build + playwright + serve smoke
```

Individually: `npm run typecheck`, `npm run build`, `npm test`, `npm run test:smoke`.

## Generated artifacts

`dist/*.mjs` is built by esbuild and **committed on purpose** — it's how the skill
ships without an install step. After changing anything under `src/comments/`, run
`npm run build` and commit the rebuilt `dist/`. `npm run check` rebuilds, so a dirty
`dist/` after a green check means you forgot to commit it.

## Test fixture gotcha

`test/specs/sniff-check.spec.js` is parameterized over **every** directory in
`test/fixtures/` via `readdirSync`. A new fixture is opted in automatically, so it
must include the widget bundle like the others:

```html
<script type="module" src="../../../dist/comments.mjs"></script>
```
