#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { validate } from "./grammar/validate.ts";
import { emitErrors, type ErrorCode } from "./errors.ts";

type Format = "svg" | "excalidraw";
const DEFAULT_FORMAT: Format = "svg";

const EXIT_CODES = [
  "Exit codes:",
  "  0  success",
  "  1  validation error (JSON errors on stderr)",
  "  2  layout/render error",
  "  3  usage / unexpected error",
].join("\n");

const FORMAT_HELP = [
  "Format selection:",
  "  --format and -o extension must agree when both given (exit 3 on conflict).",
  "  Otherwise: --format is used, or inferred from -o extension, or defaults to svg.",
].join("\n");

function inferFormatFromExt(p: string): Format | undefined {
  const ext = extname(p).toLowerCase();
  if (ext === ".svg") return "svg";
  if (ext === ".excalidraw") return "excalidraw";
  return undefined;
}

function buildParser(argv: string[]) {
  return yargs(argv)
    .scriptName("diagram")
    .usage("$0 — render YAML diagram specs to SVG (default) or Excalidraw JSON")
    .strict()
    .version(false)
    .command(
      "render <input>",
      "Render a YAML diagram spec to SVG or Excalidraw JSON",
      (y) =>
        y
          .positional("input", { type: "string", demandOption: true, describe: "YAML spec path" })
          .option("output", {
            alias: "o",
            type: "string",
            describe: "Output path; format inferred from extension if --format omitted",
          })
          .option("format", {
            type: "string",
            choices: ["svg", "excalidraw"] as const,
            describe: `Output format (default: ${DEFAULT_FORMAT})`,
          })
          .option("validate-only", {
            type: "boolean",
            default: false,
            describe: "Validate input and exit without rendering",
          })
          // yargs doesn't propagate parent .epilogue() into subcommand --help,
          // so attach per-command for `diagram render --help` to be useful.
          .epilogue(FORMAT_HELP + "\n\n" + EXIT_CODES),
    )
    .command(
      "validate <input>",
      "Validate a YAML diagram spec without rendering",
      (y) => y.positional("input", { type: "string", demandOption: true }).epilogue(EXIT_CODES),
    )
    .demandCommand(1, "command required: render | validate")
    .help()
    .alias("help", "h")
    .epilogue(FORMAT_HELP + "\n\n" + EXIT_CODES)
    .fail((msg, err) => {
      // Throw so the surrounding try/catch traps the failure BEFORE yargs
      // continues into the matched command handler. Without throwing, yargs
      // invokes this callback and then still runs the handler, silently
      // bypassing --strict (unknown flags become no-ops, missing positionals
      // leak undefined into downstream code).
      throw err ?? new Error(msg ?? "usage error");
    });
}

function fail(code: ErrorCode, message: string): void {
  process.stderr.write(emitErrors([{ path: "", code, message }]) + "\n");
}

function resolveFormat(
  explicit: Format | undefined,
  output: string | undefined,
): { format: Format } | { error: string } {
  const inferred = output ? inferFormatFromExt(output) : undefined;
  if (explicit && inferred && explicit !== inferred) {
    return {
      error: `--format ${explicit} conflicts with output extension (${inferred} from ${output})`,
    };
  }
  return { format: explicit ?? inferred ?? DEFAULT_FORMAT };
}

function defaultOutputPath(inputPath: string, format: Format): string {
  const ext = extname(inputPath);
  const base = basename(inputPath, ext);
  const outExt = format === "svg" ? ".svg" : ".excalidraw";
  return resolve(process.cwd(), `${base}${outExt}`);
}

async function main(): Promise<number> {
  const raw = hideBin(process.argv);

  // No args → print help and exit cleanly. yargs would otherwise emit a
  // 'command required' error via .fail(), which is correct but unfriendly
  // for the "user ran the binary with no args to see what it does" case.
  if (raw.length === 0) {
    await buildParser(["--help"]).parseAsync();
    return 0;
  }

  let argv: Awaited<ReturnType<ReturnType<typeof buildParser>["parseAsync"]>>;
  try {
    argv = await buildParser(raw).parseAsync();
  } catch (e) {
    fail("usage", (e as Error).message);
    return 3;
  }

  const command = String(argv._[0] ?? "");
  if (command !== "render" && command !== "validate") {
    fail("usage", `unknown command: ${command}`);
    return 3;
  }

  const input = argv.input as string | undefined;
  if (!input) {
    fail("usage", "input file required");
    return 3;
  }

  const inputPath = resolve(input);
  let text: string;
  try {
    text = readFileSync(inputPath, "utf8");
  } catch (e) {
    fail("usage", `cannot read ${inputPath}: ${(e as Error).message}`);
    return 3;
  }

  const result = validate(text);
  if (!result.ok) {
    process.stderr.write(emitErrors(result.errors) + "\n");
    return 1;
  }

  if (command === "validate" || argv["validate-only"]) {
    process.stdout.write(JSON.stringify({ ok: true }, null, 2) + "\n");
    return 0;
  }

  const fmtResolution = resolveFormat(
    argv.format as Format | undefined,
    argv.output as string | undefined,
  );
  if ("error" in fmtResolution) {
    fail("usage", fmtResolution.error);
    return 3;
  }
  const format = fmtResolution.format;

  // Lazy-import the layout/render path so `--help` and `validate` don't pay
  // the elkjs load cost (~150ms).
  let payload: { text: string; elements: number };
  try {
    const { desugar } = await import("./desugar/to-elk.ts");
    const { layout } = await import("./layout/run.ts");
    const elkInput = desugar(result.diagram);
    const laidOut = await layout(elkInput);
    if (format === "svg") {
      const { toSvg } = await import("./render/to-svg.ts");
      // Trailing newline so the SVG file ends-with-newline like the
      // excalidraw branch — matters for editorconfig / prettier checks.
      const svg = toSvg(result.diagram, laidOut) + "\n";
      payload = { text: svg, elements: 0 };
    } else {
      const { toExcalidraw } = await import("./render/to-excalidraw.ts");
      const scene = toExcalidraw(result.diagram, laidOut);
      payload = { text: JSON.stringify(scene, null, 2) + "\n", elements: scene.elements.length };
    }
  } catch (e) {
    fail("internal", `layout/render failure: ${(e as Error).message}`);
    return 2;
  }

  const outputPath = (argv.output as string | undefined) ?? defaultOutputPath(inputPath, format);
  try {
    writeFileSync(outputPath, payload.text);
  } catch (e) {
    fail("internal", `cannot write ${outputPath}: ${(e as Error).message}`);
    return 2;
  }

  const envelope: Record<string, unknown> = { ok: true, output: outputPath, format };
  if (format === "excalidraw") envelope.elements = payload.elements;
  else envelope.bytes = Buffer.byteLength(payload.text, "utf8");
  process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    fail("internal", `unexpected: ${(e as Error).stack ?? String(e)}`);
    process.exit(3);
  });
