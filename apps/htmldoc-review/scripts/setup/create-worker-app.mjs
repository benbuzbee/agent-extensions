#!/usr/bin/env node
// Minimal helper for the GitHub App Manifest flow (run by setup.sh).
//
// What it does (within GitHub's 1-hour, single-use code window):
//   1) Read ORG (and optional account type); mint a random CSRF `state` nonce.
//      Render the manifest from app-manifest.json with the ORG placeholder substituted.
//   2) Start an ephemeral localhost http server with two endpoints:
//        GET /                     -> an HTML page with an auto-submitting <form method=post>
//                                     whose action is GitHub's "new app from manifest" URL
//                                     (?state=NONCE) and which carries a single hidden field
//                                     literally named `manifest` = JSON.stringify(manifest).
//        GET /manifest/callback?code=&state=
//                                  -> verify state === NONCE, then immediately
//                                     POST https://api.github.com/app-manifests/{code}/conversions
//                                     (Accept: application/vnd.github+json,
//                                      X-GitHub-Api-Version: 2022-11-28, NO auth).
//                                     On 201 extract ONLY client_id + client_secret
//                                     (id/pem/webhook_secret are discarded -- unused in D1).
//   3) Print client_id + client_secret to stdout for setup.sh to capture. These are
//      returned exactly ONCE by GitHub and cannot be re-fetched.
//
// Usage (paths relative to apps/htmldoc-review):
//   node scripts/setup/create-worker-app.mjs --org my-org             # GitHub organization
//   node scripts/setup/create-worker-app.mjs --org my-user --personal # personal account
// Env overrides: ORG, ACCOUNT_TYPE=org|personal, PORT, MANIFEST_FILE, NO_OPEN=1

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--org") out.org = argv[++i];
    else if (a === "--personal") out.personal = true;
    else if (a === "--port") out.port = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ORG = args.org ?? process.env.ORG;
const PERSONAL = args.personal || process.env.ACCOUNT_TYPE === "personal";
const PORT = args.port ?? Number(process.env.PORT ?? 0); // 0 -> OS-assigned free port
// This script lives in scripts/setup/; app-manifest.json lives at the app root
// (two levels up). Resolve the default relative to the app root, not __dirname.
const APP_ROOT = resolve(__dirname, "..", "..");
const MANIFEST_FILE = process.env.MANIFEST_FILE
  ? resolve(process.env.MANIFEST_FILE)
  : resolve(APP_ROOT, "app-manifest.json");

if (!ORG) {
  console.error("error: missing ORG. Use --org <name> (or set ORG env).");
  process.exit(2);
}

// 1) Load + render the manifest template (substitute the ORG placeholder everywhere).
const template = await readFile(MANIFEST_FILE, "utf8");
let manifest;
try {
  manifest = JSON.parse(template.replaceAll("ORG", ORG));
} catch (e) {
  console.error(`error: ${MANIFEST_FILE} is not valid JSON after ORG substitution: ${e.message}`);
  process.exit(1);
}

const nonce = randomUUID();

// GitHub's "create app from manifest" target. Org vs. personal account differ.
const newAppUrl = PERSONAL
  ? `https://github.com/settings/apps/new?state=${encodeURIComponent(nonce)}`
  : `https://github.com/organizations/${encodeURIComponent(ORG)}/settings/apps/new?state=${encodeURIComponent(nonce)}`;

function escapeHtmlAttr(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// The form field MUST be named exactly `manifest`; value is JSON.stringify(manifest).
const formPage = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Create GitHub App: ${escapeHtmlAttr(ORG)}</title></head>
<body>
  <p>Submitting the GitHub App manifest for <strong>${escapeHtmlAttr(ORG)}</strong>&hellip;</p>
  <p>If this does not redirect automatically, click the button below.</p>
  <form id="f" method="post" action="${escapeHtmlAttr(newAppUrl)}">
    <input type="hidden" name="manifest" value="${escapeHtmlAttr(JSON.stringify(manifest))}">
    <button type="submit">Create GitHub App</button>
  </form>
  <script>document.getElementById("f").submit();</script>
</body>
</html>`;

function callbackPage(message) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Done</title></head>
<body><p>${escapeHtmlAttr(message)}</p><p>You can close this tab and return to the terminal.</p></body></html>`;
}

let settled = false;
function finish(server, code) {
  if (settled) return;
  settled = true;
  server.close(() => process.exit(code));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(formPage);
    return;
  }

  if (url.pathname === "/manifest/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    // Verify the CSRF state nonce.
    if (!state || state !== nonce) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackPage("State mismatch -- aborting (possible CSRF). No app created."));
      console.error("error: state mismatch on /manifest/callback");
      finish(server, 1);
      return;
    }
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackPage("Missing ?code from GitHub -- aborting."));
      console.error("error: missing code on /manifest/callback");
      finish(server, 1);
      return;
    }

    // Convert the temporary code into the app's credentials. NO auth header.
    try {
      const conv = await fetch(
        `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "htmldoc-review-setup",
          },
        },
      );

      if (conv.status !== 201) {
        const text = await conv.text();
        res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
        res.end(callbackPage(`GitHub conversion failed (HTTP ${conv.status}).`));
        console.error(`error: /conversions returned ${conv.status}: ${text}`);
        finish(server, 1);
        return;
      }

      const data = await conv.json();
      // Keep ONLY what D1 needs. id/pem/webhook_secret are discarded.
      const clientId = data.client_id;
      const clientSecret = data.client_secret;
      if (!clientId || !clientSecret) {
        res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
        res.end(callbackPage("Conversion succeeded but client_id/client_secret missing."));
        console.error("error: conversion response missing client_id/client_secret");
        finish(server, 1);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackPage("GitHub App created. Credentials captured in the terminal."));

      // Print for setup.sh to capture. These are returned ONCE and are unrecoverable.
      process.stdout.write(`GITHUB_CLIENT_ID=${clientId}\n`);
      process.stdout.write(`GITHUB_CLIENT_SECRET=${clientSecret}\n`);
      finish(server, 0);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackPage("Network error talking to GitHub."));
      console.error(`error: conversion request failed: ${e?.message ?? e}`);
      finish(server, 1);
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = server.address();
  const localUrl = `http://127.0.0.1:${addr.port}/`;

  // NOTE: the manifest's redirect_url is https://docs.ORG.dev/manifest/callback.
  // For this local flow GitHub redirects there; the admin must be able to reach the
  // callback locally. Easiest: temporarily point the manifest redirect_url at this
  // localhost during setup, OR run this on the box that serves docs.ORG.dev. We print
  // the local URL so the admin can drive the browser flow.
  console.error(`create-app: open ${localUrl} in your browser to create the GitHub App for "${ORG}".`);
  console.error(`create-app: GitHub will redirect to ${PERSONAL ? "your personal account's" : "the org's"} new-app page, then back to /manifest/callback.`);

  if (!process.env.NO_OPEN) {
    const opener =
      process.platform === "darwin" ? "open" :
      process.platform === "win32" ? "cmd" : "xdg-open";
    const openerArgs = process.platform === "win32" ? ["/c", "start", "", localUrl] : [localUrl];
    try {
      const child = spawn(opener, openerArgs, { stdio: "ignore", detached: true });
      child.on("error", () => { /* no browser available; admin uses the printed URL */ });
      child.unref();
    } catch {
      /* ignore: admin can open the URL manually */
    }
  }
});
