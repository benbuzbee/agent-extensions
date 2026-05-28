import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Tests serve from skills/htmldocs/ so HTML fixtures can import comments.mjs
// at the stable URL /src/comments.mjs. The file:// spec opts out via a direct
// file URL — for that path we launch with --allow-file-access-from-files.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8123',
  },
  webServer: {
    // http-server's --silent consumes the next positional arg, so the
    // serve-root path must precede --silent on the command line. -y on npx
    // avoids the install prompt on a clean checkout.
    command: `npx -y http-server "${skillRoot}" -p 8123 -c-1 --silent`,
    url: 'http://localhost:8123/test/fixtures/clean/index.html',
    // Always spin up a fresh server — a leftover instance from another
    // checkout on this port would silently serve unrelated code.
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--allow-file-access-from-files'],
        },
      },
    },
  ],
});
