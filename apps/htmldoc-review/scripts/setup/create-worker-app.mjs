#!/usr/bin/env node
// Helper for the GitHub App Manifest flow: creates the org's GitHub App, captures
// the credentials GitHub returns, and wires them into the Worker setup (printed to
// stdout for deploy.sh to capture). Run by deploy.sh AFTER the first deploy, so the
// Worker's real callback URL is known and can be baked into the App at creation.
//
// What it does (within GitHub's 1-hour, single-use code window):
//   1) Read --org and --callback-url; mint a random CSRF `state` nonce. Build the
//      App manifest object inline (no static template file): it carries two URLs
//      that are easy to confuse, so they're set explicitly and cross-referenced:
//        - redirect_url : SETUP-ONLY. Where GitHub sends the one-time ?code= right
//                         after creation. We point it at THIS script's own localhost
//                         server (known only once it's listening -> built in listen()).
//                         It has no runtime role and is irrelevant once the App exists.
//        - callback_urls: RUNTIME OAuth login callback. MUST equal CALLBACK_URL in
//                         wrangler.toml (the Worker builds its redirect from that, and
//                         GitHub rejects login unless it matches a registered URL).
//   2) Start an ephemeral localhost http server with two endpoints:
//        GET /                     -> an auto-submitting <form method=post> to GitHub's
//                                     "new app from manifest" URL (?state=NONCE) carrying
//                                     a single hidden field named `manifest`.
//        GET /manifest/callback?code=&state=
//                                  -> verify state === NONCE, then POST
//                                     https://api.github.com/app-manifests/{code}/conversions
//                                     (Accept: application/vnd.github+json, version pinned,
//                                     NO auth). On 201 keep ONLY client_id + client_secret
//                                     (id/pem/webhook_secret discarded -- unused in D1).
//   3) Print client_id + client_secret to stdout for deploy.sh to capture. Returned
//      exactly ONCE by GitHub and cannot be re-fetched.
//
// Usage (paths relative to apps/htmldoc-review):
//   node scripts/setup/create-worker-app.mjs --org my-org --callback-url https://x.workers.dev/auth/callback
//   node scripts/setup/create-worker-app.mjs --org my-user --personal --callback-url ...
// Env overrides: ORG, ACCOUNT_TYPE=org|personal, PORT, NO_OPEN=1

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import open from "open";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--org") out.org = argv[++i];
    else if (a === "--callback-url") out.callbackUrl = argv[++i];
    else if (a === "--personal") out.personal = true;
    else if (a === "--port") out.port = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ORG = args.org ?? process.env.ORG;
const CALLBACK_URL = args.callbackUrl ?? process.env.CALLBACK_URL;
const PERSONAL = args.personal || process.env.ACCOUNT_TYPE === "personal";
const PORT = args.port ?? Number(process.env.PORT ?? 0); // 0 -> OS-assigned free port

if (!ORG) {
  console.error("error: missing ORG. Use --org <name> (or set ORG env).");
  process.exit(2);
}
if (!CALLBACK_URL) {
  console.error("error: missing --callback-url (the Worker's /auth/callback URL).");
  process.exit(2);
}

const nonce = randomUUID();

// GitHub's "create app from manifest" target. Org vs. personal account differ.
const newAppUrl = PERSONAL
  ? `https://github.com/settings/apps/new?state=${encodeURIComponent(nonce)}`
  : `https://github.com/organizations/${encodeURIComponent(ORG)}/settings/apps/new?state=${encodeURIComponent(nonce)}`;

// Build the App manifest. `redirect_url` is filled in once the server is listening
// (it must point at our own localhost port); everything else is known now.
//   public:false                  -> single-org App, not listed.
//   request_oauth_on_install:true -> install + user-authorize happen together.
//   default_permissions.contents:read -> the only scope we need to fetch docs.
//   callback_urls                 -> RUNTIME OAuth callback; MUST match CALLBACK_URL
//                                    in wrangler.toml (kept in lockstep by deploy.sh).
const callbackOrigin = new URL(CALLBACK_URL).origin;
function buildManifest(redirectUrl) {
  return {
    name: `htmldoc-review-${ORG}`,
    url: callbackOrigin,
    redirect_url: redirectUrl,
    callback_urls: [CALLBACK_URL],
    public: false,
    request_oauth_on_install: true,
    default_permissions: { contents: "read" },
  };
}

function escapeHtmlAttr(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// The form field MUST be named exactly `manifest`; value is JSON.stringify(manifest).
function buildFormPage(manifest) {
  return `<!doctype html>
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
}

function callbackPage(message) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Done</title></head>
<body><p>${escapeHtmlAttr(message)}</p><p>You can close this tab and return to the terminal.</p></body></html>`;
}

// The form page embeds the manifest, whose redirect_url needs the listening port,
// so it's built in listen() (below) and stored here for the "/" route to serve.
let formPage = "";

let settled = false;
function closeAndExit(server, code) {
  if (settled) return;
  settled = true;
  server.close(() => process.exit(code));
}

// Why a hand-rolled node:http server (and not an OAuth-callback library): the GitHub
// App MANIFEST flow is not standard OAuth. Its final step POSTs the temporary code to
// /app-manifests/{code}/conversions and gets back an app *config* (client_id/secret),
// not an OAuth token. OAuth-callback libs don't model that, so adopting one would still
// leave the conversion POST and the manifest-form route hand-written. ~60 lines of
// node:http with no extra deps is the right call. The server also exists because the
// Manifest flow needs a redirect target to catch GitHub's ?code= callback (see the
// listen() call below for the full rationale).
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
      closeAndExit(server, 1);
      return;
    }
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackPage("Missing ?code from GitHub -- aborting."));
      console.error("error: missing code on /manifest/callback");
      closeAndExit(server, 1);
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
            // GitHub's REST API uses dated versions as stable identifiers (not a
            // "keep bumping" treadmill). We pin one so a future breaking version can't
            // silently change this call's behavior; 2026-03-10's breaking changes are
            // disjoint from /app-manifests/{code}/conversions (client_id/client_secret
            // are untouched). See:
            // https://docs.github.com/en/rest/about-the-rest-api/api-versions
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "htmldoc-review-setup",
          },
        },
      );

      if (conv.status !== 201) {
        const text = await conv.text();
        res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
        res.end(callbackPage(`GitHub conversion failed (HTTP ${conv.status}).`));
        console.error(`error: /conversions returned ${conv.status}: ${text}`);
        closeAndExit(server, 1);
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
        closeAndExit(server, 1);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackPage("GitHub App created. Credentials captured in the terminal."));

      // stdout carries ONLY the machine-readable credentials for deploy.sh to capture;
      // every human/status message goes to stderr (console.error) so the two streams
      // never mix and deploy.sh can parse stdout cleanly. These values are returned ONCE
      // by GitHub and are unrecoverable.
      process.stdout.write(`GITHUB_CLIENT_ID=${clientId}\n`);
      process.stdout.write(`GITHUB_CLIENT_SECRET=${clientSecret}\n`);
      closeAndExit(server, 0);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackPage("Network error talking to GitHub."));
      console.error(`error: conversion request failed: ${e?.message ?? e}`);
      closeAndExit(server, 1);
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

// Why a local http server exists at all: the GitHub App Manifest flow needs a redirect
// target to catch GitHub's ?code= callback after the admin submits the manifest form.
// Setup therefore spins up a throwaway localhost server purely to receive that callback.
// This script may be driven by an agent/admin rather than a human at a browser, so the
// server (plus the URLs we print to stderr) lets either drive the flow end to end.
server.listen(PORT, "127.0.0.1", async () => {
  const addr = server.address();
  const localUrl = `http://127.0.0.1:${addr.port}/`;

  // Now that we know our own port, point the manifest's SETUP-ONLY redirect_url at
  // this localhost server's /manifest/callback so GitHub hands the one-time ?code=
  // back to us. (This is unrelated to the App's runtime callback_urls, which point at
  // the deployed Worker.) Build the form page that embeds the finished manifest.
  const redirectUrl = `${localUrl}manifest/callback`; // localUrl ends in "/"
  formPage = buildFormPage(buildManifest(redirectUrl));

  console.error(`create-app: open ${localUrl} in your browser to create the GitHub App for "${ORG}".`);
  console.error(`create-app: GitHub will redirect to ${PERSONAL ? "your personal account's" : "the org's"} new-app page, then back to /manifest/callback.`);

  if (process.env.NO_OPEN) {
    // Auto-open suppressed: make sure a human/agent driving this can see exactly
    // what to do, since nothing will pop up on its own.
    console.error(`create-app: NO_OPEN set -- not launching a browser. Open this URL manually to continue:`);
    console.error(`create-app:   ${localUrl}`);
  } else {
    // The 'open' package handles the cross-platform cases a hand-rolled
    // process.platform switch gets wrong: WSL (open the Windows browser, not Linux
    // xdg-open), Windows arg-escaping, and Flatpak/Snap xdg-open.
    try {
      await open(localUrl);
    } catch {
      // No browser available; the admin must open the URL printed above manually.
      console.error(`create-app: could not launch a browser automatically. Open this URL manually:`);
      console.error(`create-app:   ${localUrl}`);
    }
  }
});
