import fs from "node:fs";
import path from "node:path";
import { getPackageRoot } from "../../utils/paths.js";
import { heading, log, printTable, style } from "../ui.js";

export interface CleanOptions {
  days: number;
  dryRun: boolean;
  json: boolean;
}

interface CleanTarget {
  label: string;
  dir: string;
  /** Only files matching this pattern are considered (optional). */
  pattern?: RegExp;
}

const TARGETS: CleanTarget[] = [
  { label: "Deck exports (PDF/PNG)", dir: "data/deck_exports" },
  { label: "Rendered cards", dir: "data/rendered_cards" },
  { label: "Studio test output", dir: "data/test_studio_output" },
  { label: "Sliced art", dir: "data/sliced_artworks" }
];

interface CleanResult {
  label: string;
  files: number;
  bytes: number;
  removed: number;
}

function prune(target: CleanTarget, cutoff: number, dryRun: boolean): CleanResult {
  const root = getPackageRoot();
  const dir = path.join(root, target.dir);
  const result: CleanResult = { label: target.label, files: 0, bytes: 0, removed: 0 };

  if (!fs.existsSync(dir)) return result;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (target.pattern && !target.pattern.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(file);
      result.files += 1;
      if (stat.mtimeMs >= cutoff) continue;
      result.bytes += stat.size;
      if (!dryRun) {
        fs.rmSync(file, { force: true });
        result.removed += 1;
      }
    } catch {
      // Ignore files that disappear mid-scan.
    }
  }
  return result;
}

export function runClean(options: CleanOptions): number {
  const cutoff = Date.now() - Math.max(1, options.days) * 86_400_000;
  const results = TARGETS.map((target) => prune(target, cutoff, options.dryRun));
  const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
  const totalFiles = results.reduce((sum, r) => sum + (options.dryRun ? results.find((x) => x === r)!.files : r.removed), 0);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ days: options.days, dryRun: options.dryRun, results, totalBytes }, null, 2)}\n`);
    return 0;
  }

  heading(options.dryRun ? "Clean (dry run)" : "Clean");
  printTable(
    ["Area", "Files", "Removed", "Size"],
    results.map((r) => [
      r.label,
      String(r.files),
      options.dryRun ? "would remove" : String(r.removed),
      `${(r.bytes / 1_048_576).toFixed(1)} MB`
    ])
  );
  log.info(
    `${options.dryRun ? "Would free" : "Freed"} ${(totalBytes / 1_048_576).toFixed(1)} MB from files older than ${options.days} days.`
  );
  if (options.dryRun) log.muted("Re-run without --dry-run to delete them.");
  return 0;
}
