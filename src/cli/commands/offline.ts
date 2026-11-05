import fs from "node:fs";
import path from "node:path";
import { getPackageRoot } from "../../utils/paths.js";
import { heading, log, printTable, style } from "../ui.js";

interface OfflineCheck {
  subsystem: string;
  ready: boolean;
  detail: string;
}

function exists(...parts: string[]): boolean {
  return fs.existsSync(path.join(getPackageRoot(), ...parts));
}

function ageDays(file: string): number | null {
  try {
    const stat = fs.statSync(path.join(getPackageRoot(), file));
    return Math.round((Date.now() - stat.mtimeMs) / 86_400_000 * 10) / 10;
  } catch {
    return null;
  }
}

/**
 * Reports what still works without a network connection.
 * This is deliberately diagnostic: it never claims a subsystem is offline-ready
 * when its cache is missing or stale.
 */
export function runOffline(options: { json: boolean; maxAgeDays?: number }): number {
  const maxAge = options.maxAgeDays ?? 14;

  const checks: OfflineCheck[] = [];

  const cardCache = exists("data", "cache", "card_cache.json") || exists("data", "cache", "cards_cache.json");
  checks.push({
    subsystem: "Card database",
    ready: cardCache,
    detail: cardCache ? `cache ${ageDays("data/cache/card_cache.json") ?? ageDays("data/cache/cards_cache.json")} days old` : "no card cache — live lookup required"
  });

  const cdb = exists("data", "ocgcore", "cards.cdb");
  checks.push({
    subsystem: "Duel engine",
    ready: cdb,
    detail: cdb ? "cards.cdb present" : "cards.cdb missing — simulator unavailable"
  });

  const rulebook = exists("data", "rulebook", "index.json");
  checks.push({
    subsystem: "Rulebook",
    ready: rulebook,
    detail: rulebook ? `index ${ageDays("data/rulebook/index.json")} days old` : "not synced"
  });

  let judgeDocs = 0;
  try {
    judgeDocs = fs.readdirSync(path.join(getPackageRoot(), "data", "judge")).filter((f) => f.endsWith(".json") && f !== "manifest.json").length;
  } catch {
    judgeDocs = 0;
  }
  checks.push({ subsystem: "Judge corpus", ready: judgeDocs > 0, detail: `${judgeDocs} documents cached` });

  let wikiPages = 0;
  try {
    wikiPages = fs.readdirSync(path.join(getPackageRoot(), "data", "wiki", "pages")).filter((f) => f.endsWith(".json")).length;
  } catch {
    wikiPages = 0;
  }
  checks.push({ subsystem: "Wiki", ready: wikiPages > 0, detail: `${wikiPages} pages cached (7-day TTL)` });

  const scripts = exists("data", "ocgcore-scripts", "official");
  checks.push({ subsystem: "Card scripts", ready: scripts, detail: scripts ? "official scripts cached" : "download required" });

  const prices = exists("data", "cache", "card_cache.json");
  checks.push({ subsystem: "Prices", ready: prices, detail: prices ? "cached card data (prices may be stale)" : "live lookup required" });

  const ready = checks.filter((c) => c.ready).length;

  if (options.json) {
    process.stdout.write(JSON.stringify({ maxAgeDays: maxAge, ready, total: checks.length, checks }, null, 2) + "\n");
    return 0;
  }

  heading(`Offline readiness · ${ready}/${checks.length} subsystems`);
  printTable(
    ["Subsystem", "Offline", "Detail"],
    checks.map((c) => [c.subsystem, c.ready ? style.ok("yes") : style.warn("no"), c.detail])
  );
  log.info(
    ready === checks.length
      ? "Everything needed for offline rulings, deck work and simulation is cached."
      : "Some features need a connection on first use; the rest keep working from cache."
  );
  if (ready < checks.length) log.muted(`Caches older than ${maxAge} days are refreshed when online.`);
  return 0;
}
