import fs from "node:fs";
import path from "node:path";
import { getPackageRoot } from "./paths.js";

let cached: string | undefined;

/** Reads the package version once; falls back to 0.0.0 when the manifest is unavailable. */
export function getVersion(): string {
  if (cached !== undefined) return cached;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(getPackageRoot(), "package.json"), "utf-8"));
    cached = typeof (manifest as { version?: unknown }).version === "string"
      ? (manifest as { version: string }).version
      : "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
