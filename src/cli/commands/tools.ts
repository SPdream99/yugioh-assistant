import fs from "node:fs";
import { TOOLS } from "../../tools/index.js";
import { stripMedia } from "../../mcp-media.js";
import { readTextFileSafe } from "../../utils/safe-path.js";
import { buildCatalog, renderToolsJson, uncategorizedTools, CATEGORIES } from "../tooling.js";
import { heading, log, printTable, style } from "../ui.js";

export interface ListOptions {
  json: boolean;
  verbose: boolean;
}

export async function runTools(options: ListOptions): Promise<number> {
  const orphaned = uncategorizedTools();

  if (options.json) {
    process.stdout.write(renderToolsJson() + "\n");
    return 0;
  }

  heading(
    `${TOOLS.length} tools`,
    "Every tool is stateless, runs locally, and is reachable over MCP or the shell."
  );

  const catalog = buildCatalog();
  for (const category of CATEGORIES) {
    const tools = catalog.filter((tool) => tool.category === category.id);
    if (tools.length === 0) continue;
    process.stdout.write(`\n  ${style.bold(category.title)} ${style.muted(`(${tools.length})`)}\n`);
    for (const tool of tools) {
      process.stdout.write(`    ${style.info(tool.name)}\n`);
      if (options.verbose) {
        process.stdout.write(`      ${style.muted(tool.summaryEn)}\n`);
        for (const param of tool.parameters) {
          if (param.path.includes(".")) continue;
          const required = param.required ? "" : style.muted("?");
          process.stdout.write(
            `      ${style.muted(`${param.path}${required}: ${param.type}`)}\n`
          );
        }
      }
    }
  }

  if (orphaned.length > 0) {
    process.stdout.write(`\n  ${style.bold("Other")}\n`);
    for (const name of orphaned) process.stdout.write(`    ${style.info(name)}\n`);
  }

  process.stdout.write(
    `\n  ${style.muted("Inspect one tool:")} ygo tools --verbose\n` +
      `  ${style.muted("Call it:")}         ygo call <tool> --help\n`
  );
  return 0;
}

export interface CallOptions {
  json: boolean;
  compact: boolean;
}

function closestKey(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(input.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  // Only suggest a genuinely close match (roughly a typo, not a different word).
  return best && bestDistance <= Math.max(2, Math.floor(best.length / 3)) ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[cols - 1];
}

function coerce(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

function parseFlags(argv: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      const equals = token.indexOf("=");
      if (equals > 0) {
        input[token.slice(0, equals)] = coerce(token.slice(equals + 1));
        continue;
      }
      throw new Error(`Unexpected argument '${token}'. Use --name value pairs.`);
    }
    const body = token.slice(2);
    const equals = body.indexOf("=");
    if (equals > 0) {
      const key = body.slice(0, equals);
      const value = body.slice(equals + 1);
      assign(input, key, coerce(value));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      assign(input, body, true);
      continue;
    }
    assign(input, body, coerce(next));
    index += 1;
  }
  return input;
}

function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key in target) {
    const current = target[key];
    target[key] = Array.isArray(current) ? [...current, value] : [current, value];
    return;
  }
  target[key] = value;
}

function resolveTool(name: string) {
  const normalized = name.replace(/^ygo[-_]/, "");
  return (
    TOOLS.find((tool) => tool.name === name) ??
    TOOLS.find((tool) => tool.name === `ygo_${normalized}`) ??
    TOOLS.find((tool) => tool.name.replace(/^ygo_/, "") === normalized)
  );
}

export async function runCall(toolName: string, argv: string[], options: CallOptions): Promise<number> {
  const tool = resolveTool(toolName);
  if (!tool) {
    log.fail(`Unknown tool '${toolName}'.`);
    log.muted("Run 'ygo tools' to list every tool.");
    return 2;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    printToolHelp(toolName);
    return 0;
  }

  /*
   * Transport flags (--args, --args-file, --stdin) belong to the CLI, not to the
   * tool, so they are lifted out before the remaining flags are mapped onto the
   * tool's parameters.
   */
  let argsJson: string | undefined;
  let argsFile: string | undefined;
  let readStdin = false;
  const toolArgv: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--stdin") {
      readStdin = true;
      continue;
    }
    if (token === "--args" && argv[index + 1] !== undefined) {
      argsJson = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith("--args=")) {
      argsJson = token.slice("--args=".length);
      continue;
    }
    if (token === "--args-file" && argv[index + 1] !== undefined) {
      argsFile = argv[index + 1];
      index += 1;
      continue;
    }
    toolArgv.push(token);
  }

  let input: Record<string, unknown> = {};
  try {
    if (argsFile) {
      const read = readTextFileSafe(argsFile, 1_000_000);
      if (!read.ok) throw new Error(read.reason);
      input = { ...input, ...JSON.parse(read.text!) };
    }
    if (argsJson) {
      if (argsJson.length > 1_000_000) throw new Error("--args JSON exceeds the 1 MB limit.");
      input = { ...input, ...JSON.parse(argsJson) };
    }
    if (readStdin) {
      const stdin = fs.readFileSync(0, "utf-8").trim();
      if (stdin.length > 1_000_000) throw new Error("stdin JSON exceeds the 1 MB limit.");
      if (stdin.length > 0) input = { ...input, ...JSON.parse(stdin) };
    }
    input = { ...input, ...parseFlags(toolArgv) };
  } catch (error) {
    log.fail((error as Error).message);
    return 2;
  }

  // Zod strips unknown keys by default, which silently turns `--query X` into
  // an unfiltered call. Reject unknown flags instead, and suggest the real one.
  const shape = (tool.parameters as any)?.shape as Record<string, unknown> | undefined;
  if (shape) {
    const allowed = Object.keys(shape);
    const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
      log.fail(`Unknown flag${unknown.length > 1 ? "s" : ""} for ${tool.name}: ${unknown.map((k) => `--${k}`).join(", ")}`);
      let suggested = false;
      for (const key of unknown) {
        const suggestion = closestKey(key, allowed);
        if (suggestion) {
          log.muted(`Did you mean --${suggestion}?`);
          suggested = true;
        }
      }
      if (!suggested) {
        log.muted(`Valid flags: ${allowed.map((k) => `--${k}`).join(", ")}`);
      }
      log.blank();
      printToolHelp(tool.name);
      return 2;
    }
  }

  const parsed = (tool.parameters as any).safeParse(input);
  if (!parsed.success) {
    log.fail(`Invalid arguments for ${tool.name}`);
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      log.muted(`${path}: ${issue.message}`);
    }
    log.blank();
    printToolHelp(tool.name);
    return 2;
  }

  try {
    const result = await tool.handler(parsed.data);
    // Media descriptors are an MCP-edge concern; the CLI prints only the JSON payload.
    const clean = stripMedia(result);
    const text =
      typeof clean === "string"
        ? clean
        : JSON.stringify(clean, null, options.compact ? 0 : 2);
    process.stdout.write(`${text}\n`);
    return 0;
  } catch (error) {
    log.fail(`${tool.name} failed: ${(error as Error).message}`);
    return 1;
  }
}

export function printToolHelp(name: string): void {
  const tool = resolveTool(name);
  if (!tool) {
    log.fail(`Unknown tool '${name}'.`);
    return;
  }
  const catalog = buildCatalog();
  const doc = catalog.find((entry) => entry.name === tool.name);
  process.stdout.write(`\n  ${style.bold(tool.name)}\n`);
  process.stdout.write(`  ${style.muted(doc?.summaryEn ?? tool.description)}\n\n`);
  if (doc && doc.parameters.length > 0) {
    printTable(
      ["Flag", "Type", "Required", "Description"],
      doc.parameters.map((param) => [
        `--${param.path}`,
        param.type,
        param.required ? "yes" : "no",
        param.description + (param.fallback ? ` (default ${param.fallback})` : "")
      ])
    );
  }
  process.stdout.write(
    `\n  ${style.muted("Example:")} ygo call ${tool.name} ` +
      (doc?.parameters.find((param) => param.required)?.path
        ? `--${doc.parameters.find((param) => param.required)?.path} <value>`
        : "") +
      "\n"
  );
}
