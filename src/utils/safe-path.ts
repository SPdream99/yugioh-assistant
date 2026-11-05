/**
 * Output-path guard for tools that write files.
 *
 * Writing is allowed inside the project directory and inside a recognised
 * simulator installation (YGO Omega, EDOPro). Anything else is refused with an
 * explanation, so a model cannot be talked into writing to C:\Windows or a
 * user's documents by a crafted request.
 */

import fs from "node:fs";
import path from "node:path";

const GAME_ROOTS = /[\\/](YGO Omega(_Data)?|ProjectIgnis|EDOPro|ygopro|Master Duel)([\\/]|$)/i;

export interface PathGuardResult {
  ok: boolean;
  resolved: string;
  reason?: string;
}

export function guardOutputPath(target: string, options: { allowGameRoots?: boolean } = {}): PathGuardResult {
  if (!target || typeof target !== "string") {
    return { ok: false, resolved: "", reason: "No path supplied." };
  }

  const resolved = path.resolve(target);
  const cwd = path.resolve(process.cwd());

  const insideCwd = resolved === cwd || resolved.startsWith(cwd + path.sep);
  if (insideCwd) return { ok: true, resolved };

  if (options.allowGameRoots !== false) {
    const insideKnownRoot = GAME_ROOTS.test(resolved);
    if (insideKnownRoot) return { ok: true, resolved };
  }

  return {
    ok: false,
    resolved,
    reason: `Refusing to write outside the project directory or a recognised simulator install: ${resolved}. Pass a path inside ${cwd} or a game root.`
  };
}

/** Creates the directory when allowed, otherwise returns the refusal. */
export function ensureOutputDir(target: string, options: { allowGameRoots?: boolean } = {}): PathGuardResult {
  const guard = guardOutputPath(target, options);
  if (!guard.ok) return guard;
  try {
    fs.mkdirSync(guard.resolved, { recursive: true });
    return guard;
  } catch (error) {
    return { ok: false, resolved: guard.resolved, reason: (error as Error).message };
  }
}

export interface SafeReadResult {
  ok: boolean;
  resolved: string;
  text?: string;
  reason?: string;
}

/**
 * Reads a small text file (deck list, JSON spec) with an explicit size cap and a
 * binary guard. A tool must not become a way to read a private key or a disk
 * image just because the caller supplied a path.
 */
export function readTextFileSafe(target: string, maxBytes = 2_000_000): SafeReadResult {
  if (!target || typeof target !== "string") {
    return { ok: false, resolved: "", reason: "No path supplied." };
  }
  const resolved = path.resolve(target);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { ok: false, resolved, reason: `Not a regular file: ${resolved}` };
    if (stat.size > maxBytes) {
      return { ok: false, resolved, reason: `File is larger than ${Math.round(maxBytes / 1_048_576)} MB; refusing to read it.` };
    }
    const buffer = fs.readFileSync(resolved);
    if (buffer.includes(0)) {
      return { ok: false, resolved, reason: "File looks binary; only text deck lists are accepted." };
    }
    return { ok: true, resolved, text: buffer.toString("utf-8") };
  } catch (error) {
    return { ok: false, resolved, reason: (error as Error).message };
  }
}
