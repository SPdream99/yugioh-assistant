#!/usr/bin/env node
import fs from "node:fs";
import { getVersion } from "../utils/version.js";
import { applyDataRoot } from "../utils/paths.js";
import { banner, heading, log, style } from "./ui.js";
import { runDocs } from "./commands/docs.js";
import { runDoctor } from "./commands/doctor.js";
import { runInstall, runStatus, runUninstall } from "./commands/install.js";
import { installSkill, skillTargetPath } from "./commands/skill.js";
import { printToolHelp, runCall, runTools } from "./commands/tools.js";
import { runClean } from "./commands/clean.js";
import { runStats } from "./commands/stats.js";
import { runOffline } from "./commands/offline.js";
import { runFetchData } from "./commands/fetch-data.js";
import { CLIENTS } from "./clients.js";
import { resolveMode, type InstallMode } from "./entry.js";
import { toolCount } from "./tooling.js";

interface Flags {
  values: Record<string, string | boolean>;
  positionals: string[];
}

function readFlags(tokens: string[], valued: string[] = []): Flags {
  const values: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const equals = body.indexOf("=");
    if (equals > 0) {
      values[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    if (body.startsWith("no-")) {
      values[body.slice(3)] = false;
      continue;
    }
    if (valued.includes(body)) {
      const next = tokens[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values[body] = next;
        index += 1;
        continue;
      }
    }
    values[body] = true;
  }
  return { values, positionals };
}

function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags.values[name];
  return typeof value === "string" ? value : undefined;
}

function boolFlag(flags: Flags, name: string, fallback = false): boolean {
  const value = flags.values[name];
  if (value === undefined) return fallback;
  return value !== false;
}

const HELP = `ygo — Yu-Gi-Oh! Assistant

  An MCP server and CLI that gives any AI agent a tournament-grade
  Yu-Gi-Oh! judge, deck builder and market analyst.

USAGE
  ygo <command> [options]

COMMANDS
  install       Connect this server to your AI clients (auto-detects them)
  setup         Alias for install (modern one-word entry point)
  init          Alias for install
  mcp           Alias for serve (stdio MCP server)
  uninstall     Remove the server from those clients
  status        Show which clients are detected and configured
  serve         Run the MCP server over stdio (clients call this)
  tools         List every tool, grouped by task
  call          Invoke a single tool from the shell
  doctor        Check runtime, build, Python, network and client wiring
  docs          Regenerate the tool tables in README and docs/
  skill         Install the Claude skill file
  clean         Prune old deck exports, renders and studio output
  stats         Show cache sizes, data age and the last smoke result
  cache         Alias for stats; cache --clear market --yes frees a cache area
  offline       Report which subsystems work without a connection
  fetch-data    Download the card database, rulebook and judge corpus

EXAMPLES
  ygo install
  ygo install --client claude-code,cursor --dry-run
  ygo call ygo_get_card --name "Dark Magician"
  ygo call ygo_judge_card --passcode 14558127
  echo '{"name":"Ash Blossom"}' | ygo call ygo_get_card --stdin

OPTIONS
  -h, --help       Show help for a command
  -v, --version    Print the version
      --json       Machine-readable output where supported
      --no-color   Disable colour
      --dry-run    Preview changes without writing files

Every command accepts --help. Configuration is written surgically: existing
comments and formatting in your client config files are preserved.
`;

const COMMAND_HELP: Record<string, string> = {
  install: `ygo install [--client <ids>] [--scope user|project] [--mode auto|local|npm] [--dry-run]

  Without --client, every detected AI client is configured.
  --client accepts a comma-separated list, or "all".`,
  setup: `ygo setup [--client <ids>] [--scope user|project] [--mode auto|local|npm] [--dry-run]

  Alias for install. Preferred one-word entry point for agents and MCP registries.`,
  init: `ygo init [--client <ids>] [--scope user|project] [--mode auto|local|npm] [--dry-run]

  Alias for install.`,
  mcp: `ygo mcp

  Alias for serve. Run the MCP server over stdio.`,
  uninstall: `ygo uninstall [--client <ids>] [--scope user|project] [--dry-run]`,
  status: `ygo status [--json]`,
  tools: `ygo tools [--json] [--verbose]`,
  call: `ygo call <tool> [--flag value ...] [--args '<json>'] [--args-file <path>] [--stdin] [--json]

  Flags map to the tool's parameters. Values are parsed as JSON when possible.
  Relative file paths resolve against the current directory.`,
  doctor: `ygo doctor [--json] [--offline] [--sources] [--fix]

  --sources  ping every upstream API and report status + latency
  --fix      download missing data (card database, rulebook, judge corpus) first`,
  docs: `ygo docs [--check]`,
  serve: `ygo serve [--offline]`,
  skill: `ygo skill install [--target <path>] [--dry-run]`,
  clean: `ygo clean [--days 30] [--dry-run] [--json]`,
  stats: `ygo stats [--json] [--clear <area>] [--yes] [--dry-run]

  Areas: cards, engine, scripts, rulebook, judge, wiki, generated, custom,
  exports, renders, market, all. Clearing is a dry run unless --yes is passed.`,
  cache: `ygo cache [--json] [--clear <area>] [--yes] [--dry-run]

  Alias for stats. Examples:
    ygo cache                       # sizes and ages
    ygo cache --clear market --yes  # delete daily price snapshots`,
  offline: `ygo offline [--json] [--max-age-days 14]`,
  "fetch-data": `ygo fetch-data [--force] [--json]`
};

function mainHelp(): void {
  banner(getVersion(), `${toolCount()} tools · MCP over stdio · local-first`);
  process.stdout.write(HELP);
}

function parseClients(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function run(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    mainHelp();
    return 0;
  }

  const command = argv[0];
  const rest = argv.slice(1);

  if (command === "-v" || command === "--version" || command === "version") {
    process.stdout.write(`${getVersion()}\n`);
    return 0;
  }
  if (command === "-h" || command === "--help" || command === "help") {
    if (rest[0] && COMMAND_HELP[rest[0]]) {
      process.stdout.write(`${COMMAND_HELP[rest[0]]}\n`);
      return 0;
    }
    mainHelp();
    return 0;
  }
  if (command.startsWith("-")) {
    log.fail(`Unknown option '${command}'`);
    mainHelp();
    return 2;
  }

  // `call --help` is tool-specific and handled inside runCallCommand.
  if (command !== "call" && (rest.includes("--help") || rest.includes("-h"))) {
    if (COMMAND_HELP[command]) {
      process.stdout.write(`${COMMAND_HELP[command]}\n`);
      return 0;
    }
  }

  switch (command) {
    case "install":
    case "init":
    case "setup": {
      const flags = readFlags(rest, ["client", "scope", "mode"]);
      const scope = stringFlag(flags, "scope") === "project" ? "project" : "user";
      const requested = stringFlag(flags, "mode");
      const mode: InstallMode =
        requested === "local" || requested === "npm" || requested === "auto" ? requested : "auto";
      return runInstall({
        clients: parseClients(stringFlag(flags, "client")),
        scope,
        mode,
        dryRun: boolFlag(flags, "dry-run"),
        json: boolFlag(flags, "json"),
        withSkill: boolFlag(flags, "skill", true)
      });
    }

    case "uninstall":
    case "remove": {
      const flags = readFlags(rest, ["client", "scope"]);
      return runUninstall({
        clients: parseClients(stringFlag(flags, "client")),
        scope: stringFlag(flags, "scope") === "project" ? "project" : "user",
        mode: "auto",
        dryRun: boolFlag(flags, "dry-run"),
        json: boolFlag(flags, "json"),
        withSkill: false
      });
    }

    case "status": {
      const flags = readFlags(rest);
      return runStatus(boolFlag(flags, "json"));
    }

    case "serve":
    case "mcp":
    case "stdio": {
      const flags = readFlags(rest);
      if (boolFlag(flags, "offline")) process.env.YGO_OFFLINE = "1";
      applyDataRoot();
      const { runMcpServer } = await import("../index.js");
      await runMcpServer();
      return 0;
    }

    case "tools":
    case "list": {
      const flags = readFlags(rest);
      return runTools({ json: boolFlag(flags, "json"), verbose: boolFlag(flags, "verbose") });
    }

    case "call":
    case "run":
      return runCallCommand(rest);

    case "doctor":
    case "check": {
      const flags = readFlags(rest);
      return runDoctor({
        json: boolFlag(flags, "json"),
        offline: boolFlag(flags, "offline"),
        sources: boolFlag(flags, "sources"),
        fix: boolFlag(flags, "fix")
      });
    }

    case "clean": {
      const flags = readFlags(rest, ["days"]);
      const daysRaw = Number(stringFlag(flags, "days"));
      return runClean({
        days: Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 30,
        dryRun: boolFlag(flags, "dry-run"),
        json: boolFlag(flags, "json")
      });
    }

    case "stats":
    case "cache": {
      const flags = readFlags(rest, ["clear"]);
      return runStats({
        json: boolFlag(flags, "json"),
        clear: stringFlag(flags, "clear"),
        yes: boolFlag(flags, "yes"),
        dryRun: boolFlag(flags, "dry-run")
      });
    }

    case "offline": {
      const flags = readFlags(rest, ["max-age-days"]);
      const age = Number(stringFlag(flags, "max-age-days"));
      return runOffline({
        json: boolFlag(flags, "json"),
        maxAgeDays: Number.isFinite(age) && age > 0 ? age : 14
      });
    }

    case "fetch-data":
    case "fetch": {
      const flags = readFlags(rest);
      return runFetchData({ json: boolFlag(flags, "json"), force: boolFlag(flags, "force") });
    }

    case "docs": {
      const flags = readFlags(rest);
      return runDocs({ check: boolFlag(flags, "check") });
    }

    case "skill": {
      const flags = readFlags(rest, ["target"]);
      const action = flags.positionals[0] ?? "install";
      if (action === "path") {
        process.stdout.write(`${skillTargetPath()}\n`);
        return 0;
      }
      if (action !== "install") {
        log.fail(`Unknown skill action '${action}'. Use: install | path`);
        return 2;
      }
      const result = installSkill({
        dryRun: boolFlag(flags, "dry-run"),
        target: stringFlag(flags, "target")
      });
      if (result.status === "failed" || result.status === "missing-source") {
        log.fail(result.message ?? "Skill installation failed");
        return 1;
      }
      log.ok(`${result.status} → ${result.path}`);
      return 0;
    }

    default:
      log.fail(`Unknown command '${command}'`);
      mainHelp();
      return 2;
  }
}

async function runCallCommand(rest: string[]): Promise<number> {
  const toolName = rest[0];
  if (!toolName) {
    log.fail("Which tool? e.g. ygo call ygo_get_card --name \"Dark Magician\"");
    log.muted("Run 'ygo tools' for the full list.");
    return 2;
  }

  const argv = rest.slice(1);
  if (argv.includes("--help") || argv.includes("-h")) {
    printToolHelp(toolName);
    return 0;
  }

  const json = argv.includes("--json");
  const compact = argv.includes("--compact") || argv.includes("--raw");
  const offline = argv.includes("--offline");
  if (offline) process.env.YGO_OFFLINE = "1";
  const toolArgv = argv.filter((token) => token !== "--json" && token !== "--compact" && token !== "--raw" && token !== "--no-color" && token !== "--offline");
  return runCall(toolName, toolArgv, { json, compact });
}

export function start(): void {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      log.fail((error as Error)?.message ?? String(error));
      process.exitCode = 1;
    });
}

const invokedDirectly =
  process.argv[1] !== undefined && /[\\/]cli[\\/]index\.(js|ts)$/.test(process.argv[1]);

if (invokedDirectly) {
  start();
}
