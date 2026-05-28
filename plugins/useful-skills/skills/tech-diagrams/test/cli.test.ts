import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, "..", "src");
const cliPath = resolve(srcDir, "cli.ts");
const tsxBin = resolve(srcDir, "node_modules", ".bin", "tsx");
const fixturesDir = resolve(here, "fixtures");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [cliPath, ...args], {
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function makeTmp(): string {
  return mkdtempSync(tmpdir() + sep + "tech-diagrams-test-");
}

describe("cli — exit codes and output channels", () => {
  test("help prints to stdout and exits 0", async () => {
    const r = await runCli(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/diagram/i);
    expect(r.stderr).toBe("");
  });

  test("render of valid input with .excalidraw output infers excalidraw format", async () => {
    const tmp = makeTmp();
    try {
      const out = resolve(tmp, "out.excalidraw");
      const r = await runCli(["render", resolve(fixturesDir, "pipeline.yaml"), "-o", out]);
      expect(r.code).toBe(0);
      const stdoutJson = JSON.parse(r.stdout);
      expect(stdoutJson.ok).toBe(true);
      expect(stdoutJson.output).toBe(out);
      expect(stdoutJson.format).toBe("excalidraw");
      expect(stdoutJson.elements).toBeGreaterThan(0);
      const scene = JSON.parse(readFileSync(out, "utf8"));
      expect(scene.type).toBe("excalidraw");
      expect(scene.elements.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("render with no -o and no --format defaults to svg in cwd", async () => {
    const tmp = makeTmp();
    try {
      const r = await runCli(["render", resolve(fixturesDir, "pipeline.yaml")], { cwd: tmp });
      expect(r.code).toBe(0);
      const j = JSON.parse(r.stdout);
      expect(j.ok).toBe(true);
      expect(j.format).toBe("svg");
      expect(j.output).toBe(resolve(tmp, "pipeline.svg"));
      expect(j.bytes).toBeGreaterThan(0);
      const svg = readFileSync(j.output, "utf8");
      expect(svg.startsWith("<svg")).toBe(true);
      // SVG file ends with newline (consistency with excalidraw branch).
      expect(svg.endsWith("\n")).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("render with -o foo.svg writes valid SVG", async () => {
    const tmp = makeTmp();
    try {
      const out = resolve(tmp, "out.svg");
      const r = await runCli(["render", resolve(fixturesDir, "pipeline.yaml"), "-o", out]);
      expect(r.code).toBe(0);
      const j = JSON.parse(r.stdout);
      expect(j.format).toBe("svg");
      expect(j.output).toBe(out);
      const svg = readFileSync(out, "utf8");
      expect(svg).toMatch(/^<svg[\s>]/);
      expect(svg).toContain("</svg>");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("--format excalidraw overrides default; -o without extension is honored", async () => {
    const tmp = makeTmp();
    try {
      const out = resolve(tmp, "out");
      const r = await runCli([
        "render",
        resolve(fixturesDir, "pipeline.yaml"),
        "--format",
        "excalidraw",
        "-o",
        out,
      ]);
      expect(r.code).toBe(0);
      const j = JSON.parse(r.stdout);
      expect(j.format).toBe("excalidraw");
      const scene = JSON.parse(readFileSync(out, "utf8"));
      expect(scene.type).toBe("excalidraw");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("--format conflict with -o extension exits 3 (both directions)", async () => {
    const tmp = makeTmp();
    try {
      for (const [fmt, ext] of [["excalidraw", "out.svg"], ["svg", "out.excalidraw"]] as const) {
        const out = resolve(tmp, ext);
        const r = await runCli([
          "render",
          resolve(fixturesDir, "pipeline.yaml"),
          "--format",
          fmt,
          "-o",
          out,
        ]);
        expect(r.code).toBe(3);
        expect(r.stdout).toBe("");
        const errJson = JSON.parse(r.stderr);
        expect(errJson.errors[0].code).toBe("usage");
        expect(errJson.errors[0].message).toMatch(/conflict/i);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("validation error exits 1, emits structured errors to stderr, stdout stays empty", async () => {
    const r = await runCli(["render", resolve(fixturesDir, "invalid-typo-shape.yaml")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    const errJson = JSON.parse(r.stderr);
    expect(errJson.ok).toBe(false);
    expect(Array.isArray(errJson.errors)).toBe(true);
    const e = errJson.errors[0];
    expect(typeof e.path).toBe("string");
    expect(typeof e.code).toBe("string");
    expect(typeof e.message).toBe("string");
  });

  test("missing input exits 3 with clean usage error (no raw Node stack trace)", async () => {
    // Regression guard: missing positional used to leak a TypeError stack
    // through the top-level catch when yargs' .fail() didn't abort the
    // command handler. Stack content with absolute paths is a contract
    // breach the agent-facing error tests only enforce on validation paths.
    const r = await runCli(["render"]);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
    const errJson = JSON.parse(r.stderr);
    expect(errJson.ok).toBe(false);
    expect(errJson.errors[0].code).toBe("usage");
    expect(errJson.errors[0].message).not.toMatch(/TypeError/);
    expect(errJson.errors[0].message).not.toMatch(/at\s+\w+\s*\(/);
  });

  test("nonexistent file exits 3", async () => {
    const r = await runCli(["render", "/no/such/path.yaml"]);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
  });

  test("unknown flag exits 3 with usage error — using VALID fixture to prove strict mode actually rejects the flag", async () => {
    // Regression guard: previously this test used a nonexistent fixture
    // ("foo.yaml"), so the exit 3 came from the ENOENT read failure, not
    // from the unknown-flag rejection. With a valid fixture, exit 3 here
    // proves yargs' .strict() is wired correctly.
    const r = await runCli(["render", resolve(fixturesDir, "pipeline.yaml"), "--unknown-flag"]);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
    const errJson = JSON.parse(r.stderr);
    expect(errJson.ok).toBe(false);
    expect(errJson.errors[0].code).toBe("usage");
  });

  test("--version is disabled (no auto-version short-circuit)", async () => {
    // yargs auto-handles --version unless .version(false) is set. If
    // re-enabled accidentally, this would exit 0 with stdout = "0.1.0",
    // which JSON.parse can't consume and which silently bypasses render.
    const r = await runCli(["render", resolve(fixturesDir, "pipeline.yaml"), "--version"]);
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
  });

  test("--validate-only on valid input exits 0, writes no file", async () => {
    const tmp = makeTmp();
    try {
      const out = resolve(tmp, "must-not-exist.svg");
      const r = await runCli([
        "render",
        resolve(fixturesDir, "pipeline.yaml"),
        "--validate-only",
        "-o",
        out,
      ]);
      expect(r.code).toBe(0);
      const j = JSON.parse(r.stdout);
      expect(j.ok).toBe(true);
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("validate subcommand on invalid input exits 1 with errors on stderr", async () => {
    const r = await runCli(["validate", resolve(fixturesDir, "invalid-bad-edge-ref.yaml")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    const errJson = JSON.parse(r.stderr);
    expect(errJson.errors.some((e: { code: string }) => e.code === "bad_reference")).toBe(true);
  });
}, { timeout: 20000 });

describe("cli — agent-facing error contract", () => {
  test("error messages are imperative-actionable, no raw stack traces", async () => {
    const r = await runCli(["render", resolve(fixturesDir, "invalid-bad-edge-ref.yaml")]);
    expect(r.code).toBe(1);
    const errJson = JSON.parse(r.stderr);
    for (const e of errJson.errors) {
      expect(e.message).not.toMatch(/ZodError/);
      expect(e.message).not.toMatch(/at\s+\w+\.<anonymous>/);
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  test("error JSON is parseable on its own — no log noise interleaved", async () => {
    const r = await runCli(["render", resolve(fixturesDir, "invalid-typo-shape.yaml")]);
    expect(r.code).toBe(1);
    expect(() => JSON.parse(r.stderr)).not.toThrow();
  });

  test("typo errors include suggestions", async () => {
    const r = await runCli(["render", resolve(fixturesDir, "invalid-typo-shape.yaml")]);
    const errJson = JSON.parse(r.stderr);
    const withSuggestion = errJson.errors.find((e: { suggestion?: string }) => e.suggestion);
    expect(withSuggestion).toBeDefined();
    expect(withSuggestion.suggestion).toMatch(/rectangle/);
  });
}, { timeout: 20000 });
