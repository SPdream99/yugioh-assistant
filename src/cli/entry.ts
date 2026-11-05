import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPackageRoot } from "../utils/paths.js";

export type InstallMode = "auto" | "local" | "npm";

export interface McpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ResolvedMode {
  mode: "local" | "npm";
  reason: string;
}

/**
 * npm installs live in a cache directory that can be pruned at any moment, so a
 * source checkout and a registry install need different launch commands:
 *  - source checkout → node <pkg>/dist/index.js (stable, local, version-pinned)
 *  - published package → npx -y yugioh-assistant-mcp@latest serve (portable config)
 */
export function resolveMode(requested: InstallMode): ResolvedMode {
  if (requested !== "auto") return { mode: requested, reason: "requested with --mode" };
  const root = getPackageRoot();
  if (/[\\/]_npx[\\/]|[\\/]node_modules[\\/]/.test(root)) {
    return { mode: "npm", reason: "running from an installed package" };
  }
  return { mode: "local", reason: "running from a source checkout" };
}

export function distEntryPath(): string {
  return path.join(getPackageRoot(), "dist", "index.js");
}

export function hasBuild(): boolean {
  return fs.existsSync(distEntryPath());
}

export function buildEntry(mode: "local" | "npm"): McpEntry {
  if (mode === "npm") {
    return {
      command: "npx",
      args: ["-y", "yugioh-assistant-mcp@latest", "serve"],
      env: { YGO_DATA_ROOT: path.join(os.homedir(), ".yugioh-assistant-mcp") }
    };
  }
  return { command: process.execPath, args: [distEntryPath()] };
}

export function describeEntry(entry: McpEntry): string {
  const env = entry.env
    ? " " + Object.entries(entry.env)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")
    : "";
  return [entry.command, ...entry.args].join(" ") + env;
}
