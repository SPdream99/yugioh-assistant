import fs from "node:fs";
import path from "node:path";
import { getPackageRoot } from "../../utils/paths.js";
import { getVersion } from "../../utils/version.js";
import { heading, log, printTable } from "../ui.js";
import { TOOLS } from "../../tools/index.js";

interface StatRow {
  area: string;
  files: number;
  sizeMb: number;
  newest?: string;
  oldest?: string;
}

function scan(area: string, dir: string): StatRow {
  const files: Array<{ mtime: number; size: number }> = [];
  const walk = (current: string) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          const stat = fs.statSync(full);
          files.push({ mtime: stat.mtimeMs, size: stat.size });
        } catch {
          // ignore
        }
      }
    }
  };
  walk(dir);

  const size = files.reduce((sum, f) => sum + f.size, 0);
  const times = files.map((f) => f.mtime).sort((a, b) => a - b);
  return {
    area,
    files: files.length,
    sizeMb: Math.round((size / 1_048_576) * 10) / 10,
    newest: times.length ? new Date(times[times.length - 1]).toISOString().slice(0, 10) : undefined,
    oldest: times.length ? new Date(times[0]).toISOString().slice(0, 10) : undefined
  };
}

const AREA_DIRS: Record<string, string[]> = {
  cards: ["cache"],
  engine: ["ocgcore"],
  scripts: ["ocgcore-scripts"],
  rulebook: ["rulebook"],
  judge: ["judge"],
  wiki: ["wiki"],
  generated: ["card-scripts"],
  custom: ["custom_cards"],
  exports: ["deck_exports"],
  renders: ["rendered_cards"],
  market: ["market"]
};

function areaDirs(dataDir: string, area: string): string[] {
  if (area === "all") return Object.values(AREA_DIRS).flat().map(d => path.join(dataDir, d));
  if (area === "market") return [path.join(dataDir, "market")];
  return (AREA_DIRS[area] || []).map(d => path.join(dataDir, d));
}

function sizeOf(target: string): number {
  const stat = fs.existsSync(target) ? fs.statSync(target) : undefined;
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    total += sizeOf(path.join(target, entry.name));
  }
  return total;
}

function clearDirs(dataDir: string, area: string, dryRun: boolean): { removedMb: number; paths: string[] } {
  if (!AREA_DIRS[area] && area !== "all" && area !== "market") {
    throw new Error(`Unknown cache area "${area}". Use: ${[...Object.keys(AREA_DIRS), "all"].join(", ")}`);
  }
  const paths = areaDirs(dataDir, area);
  let bytes = 0;
  for (const target of paths) {
    if (!fs.existsSync(target)) continue;
    bytes += sizeOf(target);
    if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
  }
  return { removedMb: Math.round((bytes / 1_048_576) * 10) / 10, paths };
}

export function runStats(options: { json: boolean; clear?: string; yes?: boolean; dryRun?: boolean }): number {
  const root = getPackageRoot();
  const data = path.join(root, "data");

  if (options.clear) {
    const dryRun = options.dryRun || !options.yes;
    const area = options.clear.toLowerCase();
    let result: { removedMb: number; paths: string[] };
    try {
      result = clearDirs(data, area, dryRun);
    } catch (error) {
      log.fail((error as Error).message);
      return 2;
    }
    if (options.json) {
      process.stdout.write(JSON.stringify({ area, dryRun, ...result }, null, 2) + "\n");
      return 0;
    }
    heading(`${dryRun ? "Would clear" : "Cleared"} · ${area}`);
    log.info(`${result.removedMb} MB across ${result.paths.length} location(s)`);
    if (dryRun) log.muted("Nothing was deleted. Re-run with --yes to confirm.");
    return 0;
  }

  const rows: StatRow[] = [
    scan("Card cache", path.join(data, "cache")),
    scan("Game engine", path.join(data, "ocgcore")),
    scan("Card scripts", path.join(data, "ocgcore-scripts")),
    scan("Rulebook", path.join(data, "rulebook")),
    scan("Judge corpus", path.join(data, "judge")),
    scan("Wiki cache", path.join(data, "wiki")),
    scan("Market history", path.join(data, "market")),
    scan("Generated scripts", path.join(data, "card-scripts")),
    scan("Custom cards", path.join(data, "custom_cards")),
    scan("Deck exports", path.join(data, "deck_exports")),
    scan("Rendered cards", path.join(data, "rendered_cards"))
  ];

  const totalMb = Math.round(rows.reduce((sum, r) => sum + r.sizeMb, 0) * 10) / 10;
  const smokePath = path.join(data, "system_smoke_report.json");
  let smoke: any = null;
  try {
    if (fs.existsSync(smokePath)) smoke = JSON.parse(fs.readFileSync(smokePath, "utf-8"));
  } catch {
    smoke = null;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ version: getVersion(), tools: TOOLS.length, totalMb, rows, smoke }, null, 2) + "\n");
    return 0;
  }

  heading(`Local stats · v${getVersion()} · ${TOOLS.length} tools · ${totalMb} MB`);
  printTable(
    ["Area", "Files", "Size", "Oldest", "Newest"],
    rows.map((r) => [r.area, String(r.files), `${r.sizeMb} MB`, r.oldest || "-", r.newest || "-"])
  );
  if (smoke) {
    log.info(
      `Last smoke test: ${new Date(smoke.at).toISOString().slice(0, 16).replace("T", " ")} — ` +
        `${smoke.results.filter((r: any) => r.status === "pass").length} pass, ` +
        `${smoke.results.filter((r: any) => r.status === "fail").length} fail`
    );
  } else {
    log.muted("No smoke report yet — run npm run test:smoke.");
  }
  return 0;
}
