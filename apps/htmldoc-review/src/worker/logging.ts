import { configure, getConsoleSink, jsonLinesFormatter } from "@logtape/logtape";

/**
 * WORKER logging init. This is the Cloudflare Worker's entrypoint configuration
 * for LogTape and lives in src/worker/ on purpose: configure() is process-global
 * and must be owned by an entrypoint, never by portable src/core/ modules (they
 * only ever call getLogger()).
 *
 * A future local server/CLI (conceptually src/local/) MUST run its OWN configure()
 * separately — do NOT import this from there. LogTape is runtime-agnostic, so the
 * shared src/core/ code logs identically under both; only the sink wiring differs
 * per entrypoint (e.g. local might use prettyFormatter or a file sink instead).
 *
 * We emit one JSON object per line via jsonLinesFormatter; Cloudflare natively
 * captures structured JSON written to the console.
 */
let configured = false;

export async function initWorkerLogging(): Promise<void> {
  // configure() throws if called twice without reset; guard so the once-per-
  // isolate init is cheap and idempotent across many fetch invocations.
  if (configured) return;
  configured = true;

  await configure({
    sinks: {
      console: getConsoleSink({ formatter: jsonLinesFormatter }),
    },
    loggers: [
      { category: ["htmldoc-review"], sinks: ["console"], lowestLevel: "info" },
      // Silence LogTape's own meta logger.
      { category: ["logtape", "meta"], sinks: [], lowestLevel: "warning" },
    ],
  });
}
