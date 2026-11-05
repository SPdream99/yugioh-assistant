import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPackageRoot } from "../../utils/paths.js";
import { ensureDir, readIfExists, writeWithBackup } from "../files.js";

export const SKILL_NAME = "yugioh-assistant-mcp";

function candidates(): string[] {
  const root = getPackageRoot();
  return [
    path.join(root, "skills", SKILL_NAME, "SKILL.md"),
    path.join(root, "src", "skills", SKILL_NAME, "SKILL.md")
  ];
}

export function skillSourcePath(): string | undefined {
  return candidates().find((candidate) => fs.existsSync(candidate));
}

export function skillTargetPath(home = os.homedir()): string {
  return path.join(home, ".claude", "skills", SKILL_NAME, "SKILL.md");
}

export interface SkillInstallResult {
  status: "installed" | "unchanged" | "missing-source" | "failed";
  path: string;
  message?: string;
}

/**
 * Copies the bundled SKILL.md into Claude's skills directory. The file is the
 * only artefact the agent needs; the MCP tools are reached over stdio.
 */
export function installSkill(options: { dryRun?: boolean; target?: string } = {}): SkillInstallResult {
  const source = skillSourcePath();
  const target = options.target ?? skillTargetPath();
  if (!source) {
    return { status: "missing-source", path: target, message: "SKILL.md not found in this build" };
  }

  try {
    const content = fs.readFileSync(source, "utf-8");
    const previous = readIfExists(target);
    if (previous === content) return { status: "unchanged", path: target };
    if (!options.dryRun) {
      ensureDir(path.dirname(target));
      writeWithBackup(target, content);
    }
    return { status: "installed", path: target };
  } catch (error) {
    return { status: "failed", path: target, message: (error as Error).message };
  }
}
