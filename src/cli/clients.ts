import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exists, expandHome, readIfExists, writeWithBackup } from "./files.js";
import { parseJsonc, removeJsonKey, upsertJsonKey } from "./jsonc.js";
import type { McpEntry } from "./entry.js";

export const SERVER_KEY = "yugioh-assistant-mcp";

export type ClientKind = "json" | "vscode" | "opencode" | "zed" | "codex-toml";

export interface ClientDefinition {
  id: string;
  label: string;
  vendor: string;
  docsUrl: string;
  kind: ClientKind;
  /** Absolute config path for user-scoped installs, or undefined when unsupported. */
  userPath?: string;
  /** Absolute config path for repository-scoped installs. */
  projectPath?: string;
  /** JSON pointer-ish path to the object that maps server names to entries. */
  container: string[];
  /** Files or directories that indicate the client is installed. */
  detectionPaths: string[];
}

const home = os.homedir();
const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
const codexHome = process.env.CODEX_HOME ?? path.join(home, ".codex");
const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");

function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((candidate) => exists(candidate));
}

function opencodeConfigPath(): string | undefined {
  const dir = path.join(xdgConfig, "opencode");
  return (
    firstExisting([
      path.join(dir, "opencode.jsonc"),
      path.join(dir, "opencode.json")
    ]) ?? path.join(dir, "opencode.jsonc")
  );
}

function zedConfigPath(): string | undefined {
  if (process.platform === "win32") return path.join(appData, "Zed", "settings.json");
  return path.join(xdgConfig, "zed", "settings.json");
}

function clineConfigPath(): string | undefined {
  const suffix = path.join(
    "globalStorage",
    "saoudrizwan.claude-dev",
    "settings",
    "cline_mcp_settings.json"
  );
  if (process.platform === "win32") return path.join(appData, "Code", "User", suffix);
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", suffix);
  }
  return path.join(xdgConfig, "Code", "User", suffix);
}

export const CLIENTS: ClientDefinition[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    vendor: "Anthropic",
    docsUrl: "https://docs.claude.com/en/docs/claude-code/mcp",
    kind: "json",
    userPath: path.join(home, ".claude.json"),
    projectPath: path.resolve(process.cwd(), ".mcp.json"),
    container: ["mcpServers"],
    detectionPaths: [path.join(home, ".claude.json"), path.join(home, ".claude")]
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    vendor: "Anthropic",
    docsUrl: "https://modelcontextprotocol.io/quickstart/user",
    kind: "json",
    userPath:
      process.platform === "win32"
        ? path.join(appData, "Claude", "claude_desktop_config.json")
        : process.platform === "darwin"
          ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
          : path.join(xdgConfig, "Claude", "claude_desktop_config.json"),
    container: ["mcpServers"],
    detectionPaths: [
      process.platform === "win32"
        ? path.join(appData, "Claude")
        : process.platform === "darwin"
          ? path.join(home, "Library", "Application Support", "Claude")
          : path.join(xdgConfig, "Claude")
    ]
  },
  {
    id: "codex",
    label: "Codex CLI",
    vendor: "OpenAI",
    docsUrl: "https://developers.openai.com/codex/mcp",
    kind: "codex-toml",
    userPath: path.join(codexHome, "config.toml"),
    container: ["mcp_servers"],
    detectionPaths: [codexHome]
  },
  {
    id: "opencode",
    label: "OpenCode",
    vendor: "OpenCode",
    docsUrl: "https://opencode.ai/docs/mcp-servers",
    kind: "opencode",
    userPath: opencodeConfigPath(),
    projectPath: path.resolve(process.cwd(), "opencode.json"),
    container: ["mcp", "servers"],
    detectionPaths: [path.join(xdgConfig, "opencode")]
  },
  {
    id: "cursor",
    label: "Cursor",
    vendor: "Anysphere",
    docsUrl: "https://docs.cursor.com/context/model-context-protocol",
    kind: "json",
    userPath: path.join(home, ".cursor", "mcp.json"),
    projectPath: path.resolve(process.cwd(), ".cursor", "mcp.json"),
    container: ["mcpServers"],
    detectionPaths: [path.join(home, ".cursor"), path.join(appData, "Cursor")]
  },
  {
    id: "vscode",
    label: "VS Code (Copilot)",
    vendor: "Microsoft",
    docsUrl: "https://code.visualstudio.com/docs/copilot/chat/mcp-servers",
    kind: "vscode",
    projectPath: path.resolve(process.cwd(), ".vscode", "mcp.json"),
    container: ["servers"],
    detectionPaths: [path.join(home, ".vscode"), path.join(appData, "Code")]
  },
  {
    id: "windsurf",
    label: "Windsurf",
    vendor: "Cognition",
    docsUrl: "https://docs.windsurf.com/windsurf/cascade/mcp",
    kind: "json",
    userPath: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
    container: ["mcpServers"],
    detectionPaths: [path.join(home, ".codeium", "windsurf")]
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    vendor: "Google",
    docsUrl: "https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md",
    kind: "json",
    userPath: path.join(home, ".gemini", "settings.json"),
    container: ["mcpServers"],
    detectionPaths: [path.join(home, ".gemini")]
  },
  {
    id: "cline",
    label: "Cline",
    vendor: "Cline",
    docsUrl: "https://docs.cline.bot/mcp/configuring-mcp-servers",
    kind: "json",
    userPath: clineConfigPath(),
    container: ["mcpServers"],
    detectionPaths: [path.dirname(clineConfigPath() ?? "")]
  },
  {
    id: "zed",
    label: "Zed",
    vendor: "Zed Industries",
    docsUrl: "https://zed.dev/docs/ai/mcp",
    kind: "zed",
    userPath: zedConfigPath(),
    container: ["context_servers"],
    detectionPaths: [path.dirname(zedConfigPath() ?? "")]
  }
];

export function findClient(id: string): ClientDefinition | undefined {
  return CLIENTS.find((client) => client.id === id || client.label.toLowerCase() === id.toLowerCase());
}

export function isDetected(client: ClientDefinition): boolean {
  return client.detectionPaths.some((candidate) => candidate && exists(candidate));
}

export function resolveConfigPath(
  client: ClientDefinition,
  scope: "user" | "project",
  _cwd = process.cwd()
): string | undefined {
  return scope === "project" ? client.projectPath : client.userPath;
}

function serializeEntry(client: ClientDefinition, entry: McpEntry): unknown {
  switch (client.kind) {
    case "vscode":
      return { type: "stdio", command: entry.command, args: entry.args, env: entry.env ?? {} };
    case "opencode":
      return { type: "local", command: [entry.command, ...entry.args], enabled: true, environment: entry.env ?? {} };
    case "zed":
      return { source: "custom", command: { path: entry.command, args: entry.args, env: entry.env ?? {} } };
    default:
      return { command: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) };
  }
}

/** OpenCode moved servers under `mcp.servers`; follow whichever shape is on disk. */
function resolveContainer(client: ClientDefinition, text: string): string[] {
  if (client.kind !== "opencode") return client.container;
  try {
    const document = parseJsonc<Record<string, unknown>>(text);
    const mcp = document.mcp;
    if (mcp && typeof mcp === "object" && "servers" in (mcp as Record<string, unknown>)) {
      return ["mcp", "servers"];
    }
    if (mcp && typeof mcp === "object") return ["mcp"];
  } catch {
    /* fall through to the modern default */
  }
  return ["mcp", "servers"];
}

function tomlBlock(entry: McpEntry): string {
  const lines = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${JSON.stringify(entry.command)}`,
    `args = [${entry.args.map((arg) => JSON.stringify(arg)).join(", ")}]`
  ];
  if (entry.env && Object.keys(entry.env).length > 0) {
    lines.push("", `[mcp_servers.${SERVER_KEY}.env]`);
    for (const [key, value] of Object.entries(entry.env)) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n");
}

function upsertToml(text: string, entry: McpEntry): string {
  const header = `[mcp_servers.${SERVER_KEY}]`;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  const block = tomlBlock(entry).split("\n");

  if (start === -1) {
    const base = text.trimEnd();
    return `${base}${base.length > 0 ? "\n\n" : ""}${block.join("\n")}\n`;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const merged = [...lines.slice(0, start), ...block, "", ...lines.slice(end)];
  return merged.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
}

function removeToml(text: string): { text: string; removed: boolean } {
  const header = `[mcp_servers.${SERVER_KEY}]`;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return { text, removed: false };

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const merged = [...lines.slice(0, start), ...lines.slice(end)];
  return { text: merged.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, ""), removed: true };
}

export type ApplyStatus = "configured" | "unchanged" | "removed" | "not-configured" | "unsupported" | "failed";

export interface ApplyResult {
  client: ClientDefinition;
  status: ApplyStatus;
  configPath: string;
  backupPath?: string;
  message?: string;
}

export interface ApplyOptions {
  scope: "user" | "project";
  cwd?: string;
  dryRun?: boolean;
}

export function applyClient(client: ClientDefinition, entry: McpEntry, options: ApplyOptions): ApplyResult {
  const configPath = resolveConfigPath(client, options.scope, options.cwd);
  if (!configPath) {
    return {
      client,
      status: "unsupported",
      configPath: "",
      message: `${client.label} has no ${options.scope}-scope configuration file`
    };
  }

  const previous = readIfExists(configPath);

  try {
    let next: string;
    if (client.kind === "codex-toml") {
      next = upsertToml(previous ?? "", entry);
    } else {
      const document = previous ?? "{}\n";
      const container = resolveContainer(client, document);
      next = upsertJsonKey(document, container, SERVER_KEY, serializeEntry(client, entry));
    }

    if (previous !== undefined && next === previous) {
      return { client, status: "unchanged", configPath };
    }
    if (options.dryRun) return { client, status: "configured", configPath };

    const written = writeWithBackup(configPath, next);
    return { client, status: "configured", configPath, backupPath: written.backupPath };
  } catch (error) {
    return {
      client,
      status: "failed",
      configPath,
      message: (error as Error).message
    };
  }
}

export function removeClient(client: ClientDefinition, options: ApplyOptions): ApplyResult {
  const configPath = resolveConfigPath(client, options.scope, options.cwd);
  if (!configPath) {
    return { client, status: "unsupported", configPath: "", message: `${client.label} cannot be configured` };
  }
  const previous = readIfExists(configPath);
  if (previous === undefined) return { client, status: "not-configured", configPath };

  try {
    if (client.kind === "codex-toml") {
      const result = removeToml(previous);
      if (!result.removed) return { client, status: "not-configured", configPath };
      if (!options.dryRun) writeWithBackup(configPath, result.text);
      return { client, status: "removed", configPath };
    }

    const container = resolveContainer(client, previous);
    const result = removeJsonKey(previous, container, SERVER_KEY);
    if (!result.removed) return { client, status: "not-configured", configPath };
    if (!options.dryRun) writeWithBackup(configPath, result.text);
    return { client, status: "removed", configPath };
  } catch (error) {
    return { client, status: "failed", configPath, message: (error as Error).message };
  }
}

/** Confirms the server entry is present in the given scope and points at the expected command. */
export function verifyClient(client: ClientDefinition, entry: McpEntry, scope: "user" | "project"): boolean {
  const configPath = resolveConfigPath(client, scope);
  const text = configPath ? readIfExists(configPath) : undefined;
  if (!text) return false;
  try {
    if (client.kind === "codex-toml") return text.includes(`[mcp_servers.${SERVER_KEY}]`);
    const container = resolveContainer(client, text);
    const document = parseJsonc<Record<string, unknown>>(text);
    let cursor: unknown = document;
    for (const segment of container) {
      if (!cursor || typeof cursor !== "object") return false;
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    if (!cursor || typeof cursor !== "object") return false;
    return SERVER_KEY in (cursor as Record<string, unknown>);
  } catch {
    return false;
  }
}

/** True when either scope carries the entry, reporting which one. */
export function verifyAnyScope(client: ClientDefinition, entry: McpEntry): { configured: boolean; scope?: "user" | "project"; configPath?: string } {
  for (const scope of ["user", "project"] as const) {
    if (verifyClient(client, entry, scope)) {
      return { configured: true, scope, configPath: resolveConfigPath(client, scope) };
    }
  }
  return { configured: false };
}

export function configExists(client: ClientDefinition): boolean {
  const target = client.userPath ?? client.projectPath;
  return Boolean(target && fs.existsSync(expandHome(target)));
}
