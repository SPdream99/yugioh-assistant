import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

let cachedPackageRoot: string | null = null;

/**
 * Returns the absolute path to the root of this package (containing package.json).
 * Works reliably in both source (src/) and built (dist/) environments.
 */
export function getPackageRoot(): string {
  if (cachedPackageRoot) return cachedPackageRoot;

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    let dir = currentDir;
    while (dir && dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "package.json"))) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
          if (pkg.name === "yugioh-assistant-mcp") {
            cachedPackageRoot = dir;
            return dir;
          }
        } catch {
          // ignore parsing error and continue upwards
        }
      }
      dir = path.dirname(dir);
    }
  } catch {
    // fallback to process.cwd()
  }

  cachedPackageRoot = process.cwd();
  return cachedPackageRoot;
}

/**
 * Resolves a file path inside the package, checking root, src/, and dist/.
 */
export function resolvePackageFile(...segments: string[]): string {
  const root = getPackageRoot();
  const direct = path.resolve(root, ...segments);
  if (fs.existsSync(direct)) return direct;

  const inSrc = path.resolve(root, "src", ...segments);
  if (fs.existsSync(inSrc)) return inSrc;

  const inDist = path.resolve(root, "dist", ...segments);
  if (fs.existsSync(inDist)) return inDist;

  return direct;
}

/**
 * Resolves a Python script located within the package.
 */
export function resolvePythonScript(scriptRelPath: string): string {
  // Try clean relative path or src-prefixed
  const normalized = scriptRelPath.replace(/^[/\\]+/, "");
  return resolvePackageFile(normalized);
}

/**
 * Resolves a data or template file.
 */
export function resolveDataPath(...segments: string[]): string {
  return path.resolve(getDataRoot(), "data", ...segments);
}

/**
 * Root directory for all runtime data (cache, custom cards, rendered art).
 *
 * Defaults to the package root so a source checkout keeps everything inside its
 * own `data/` folder. Published installs set `YGO_DATA_ROOT` to a stable user
 * directory instead, because npm caches can be pruned without warning.
 */
export function getDataRoot(): string {
  const override = process.env.YGO_DATA_ROOT;
  return override ? path.resolve(override) : getPackageRoot();
}

/**
 * Switches the process working directory to the data root. Most core modules
 * resolve `data/…` paths against `process.cwd()`, so this is the single hook
 * that makes a server spawned by an MCP client land in a predictable place.
 */
export function applyDataRoot(): string {
  const root = getDataRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
    process.chdir(root);
  } catch {
    // A read-only root is not fatal: the process simply keeps its current cwd.
  }
  return root;
}

/**
 * Detects an available Python binary on the system (python3, python, py).
 */
export function detectPythonCommand(): string {
  const candidates = process.platform === "win32"
    ? ["python", "py", "python3"]
    : ["python3", "python"];

  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      return cmd;
    } catch {
      continue;
    }
  }
  return "python";
}
