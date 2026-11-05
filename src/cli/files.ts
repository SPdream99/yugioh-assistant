import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(target: string): string {
  if (target.startsWith("~")) return path.join(os.homedir(), target.slice(1));
  return target;
}

export function readIfExists(filePath: string): string | undefined {
  try {
    return fs.readFileSync(expandHome(filePath), "utf-8");
  } catch {
    return undefined;
  }
}

export function exists(filePath: string): boolean {
  try {
    return fs.existsSync(expandHome(filePath));
  } catch {
    return false;
  }
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(expandHome(dirPath), { recursive: true });
}

export interface WriteResult {
  path: string;
  backupPath?: string;
}

/**
 * Writes a configuration file while keeping a timestamped backup of the previous
 * content next to it. Configuration edits must always be reversible by hand.
 */
export function writeWithBackup(filePath: string, content: string, timestamp = Date.now()): WriteResult {
  const resolved = expandHome(filePath);
  ensureDir(path.dirname(resolved));
  const previous = readIfExists(resolved);
  let backupPath: string | undefined;
  if (previous !== undefined && previous !== content) {
    backupPath = `${resolved}.ygo-${timestamp}.bak`;
    fs.writeFileSync(backupPath, previous, "utf-8");
  }
  fs.writeFileSync(resolved, content, "utf-8");
  return { path: resolved, backupPath };
}

export function readJsonFile<T = unknown>(filePath: string): T {
  const content = readIfExists(filePath) ?? "{}";
  return JSON.parse(content) as T;
}
