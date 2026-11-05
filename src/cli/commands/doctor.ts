import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getPackageRoot, detectPythonCommand } from "../../utils/paths.js";
import { getVersion } from "../../utils/version.js";
import { TOOLS } from "../../tools/index.js";
import { CLIENTS, isDetected, resolveConfigPath, verifyAnyScope } from "../clients.js";
import { buildEntry, distEntryPath, resolveMode } from "../entry.js";
import { skillSourcePath, skillTargetPath } from "./skill.js";
import { heading, log, printTable, style } from "../ui.js";
import { uncategorizedTools } from "../tooling.js";
import { countLocalCards } from "../../core/card-scripts/card-data.js";
import { httpFetch } from "../../core/http/fetch-client.js";
import { runFetchData } from "./fetch-data.js";

type Verdict = "pass" | "warn" | "fail" | "skip";

interface Check {
  name: string;
  verdict: Verdict;
  detail: string;
}

function badge(verdict: Verdict): string {
  switch (verdict) {
    case "pass":
      return style.ok("pass");
    case "warn":
      return style.warn("warn");
    case "fail":
      return style.err("fail");
    default:
      return style.muted("skip");
  }
}

function pythonVersion(): { ok: boolean; version: string } {
  const command = detectPythonCommand();
  try {
    const output = execFileSync(command, ["--version"], { encoding: "utf-8" }).trim();
    return { ok: true, version: output || command };
  } catch {
    return { ok: false, version: command };
  }
}

function isWritable(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function reachable(url: string, timeoutMs = 6000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    // An unconsumed body keeps the undici connection alive and can stop the CLI
    // process from exiting.
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const CDB_URL = "https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/master/cards.cdb";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "unknown size";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** HEAD the upstream cdb; content-length is the cheapest version fingerprint. */
async function remoteCdbInfo(): Promise<{ reachable: boolean; size: number }> {
  try {
    const response = await fetch(CDB_URL, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { reachable: false, size: 0 };
    return { reachable: true, size: Number(response.headers.get("content-length")) || 0 };
  } catch {
    return { reachable: false, size: 0 };
  }
}

/** Total cards in the live card API, used as the coverage denominator. */
async function liveCardCount(): Promise<number | null> {
  try {
    const response = await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php?num=1&offset=0", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return null;
    const payload: any = await response.json();
    const total = Number(payload?.meta?.total_rows);
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

export async function runDoctor(options: {
  json: boolean;
  offline: boolean;
  sources?: boolean;
  fix?: boolean;
}): Promise<number> {
  if (options.fix) {
    await runFetchData({ json: false, force: false });
  }
  const root = getPackageRoot();
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js runtime",
    verdict: major >= 20 ? "pass" : "fail",
    detail: `v${process.versions.node}${major >= 20 ? "" : " — 20 or newer is required"}`
  });

  const built = fs.existsSync(distEntryPath());
  checks.push({
    name: "Compiled server",
    verdict: built ? "pass" : "fail",
    detail: built ? distEntryPath() : "missing dist/index.js — run npm run build"
  });

  if (built) {
    const srcCore = path.join(root, "src", "core");
    if (!fs.existsSync(srcCore)) {
      checks.push({
        name: "Build freshness",
        verdict: "pass",
        detail: "published package (no src/ checkout)"
      });
    } else {
      const distStat = fs.statSync(distEntryPath()).mtimeMs;
      const sources = fs
        .readdirSync(srcCore, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
        .map((entry) => {
          const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
            (entry as unknown as { path?: string }).path ??
            srcCore;
          return fs.statSync(path.join(parent, entry.name)).mtimeMs;
        });
      const newest = Math.max(0, ...sources);
      checks.push({
        name: "Build freshness",
        verdict: newest > distStat ? "warn" : "pass",
        detail: newest > distStat ? "source files changed after the last build" : "dist matches src"
      });
    }
  }

  const python = pythonVersion();
  checks.push({
    name: "Python (PDF, slicing, studio)",
    verdict: python.ok ? "pass" : "warn",
    detail: python.ok ? python.version : "not found — PDF/image/studio tools will fail"
  });

  const dataDir = path.join(root, "data");
  const dataExists = fs.existsSync(dataDir);
  checks.push({
    name: "Data directory",
    verdict: dataExists && isWritable(dataDir) ? "pass" : dataExists ? "fail" : "warn",
    detail: dataExists ? dataDir : `${dataDir} will be created on first write`
  });

  const orphaned = uncategorizedTools();
  checks.push({
    name: "Tool catalog",
    verdict: TOOLS.length > 0 && orphaned.length === 0 ? "pass" : "warn",
    detail:
      orphaned.length === 0
        ? `${TOOLS.length} tools registered`
        : `${TOOLS.length} tools, undocumented: ${orphaned.join(", ")}`
  });

  const skill = skillSourcePath();
  checks.push({
    name: "Claude skill",
    verdict: skill ? "pass" : "warn",
    detail: skill ? `source: ${skill} → ${skillTargetPath()}` : "skills/yugioh-assistant-mcp/SKILL.md missing"
  });

  // Subsystem data checks: each knowledge base should be present and usable.
  const rulebookIndex = path.join(dataDir, "rulebook", "index.json");
  checks.push({
    name: "Rulebook corpus",
    verdict: fs.existsSync(rulebookIndex) ? "pass" : "warn",
    detail: fs.existsSync(rulebookIndex)
      ? `${(fs.statSync(rulebookIndex).size / 1024).toFixed(0)} KB index at data/rulebook`
      : "not synced — run ygo_get_rulebook with topic=status"
  });

  const judgeDocs = fs.existsSync(path.join(dataDir, "judge"))
    ? fs.readdirSync(path.join(dataDir, "judge")).filter((f) => f.endsWith(".json") && f !== "manifest.json").length
    : 0;
  checks.push({
    name: "Judge corpus",
    verdict: judgeDocs >= 10 ? "pass" : judgeDocs > 0 ? "warn" : "warn",
    detail: judgeDocs > 0 ? `${judgeDocs} documents cached` : "not synced — run ygo_get_policy with topic=status"
  });

  const wikiPages = fs.existsSync(path.join(dataDir, "wiki", "pages"))
    ? fs.readdirSync(path.join(dataDir, "wiki", "pages")).filter((f) => f.endsWith(".json")).length
    : 0;
  checks.push({
    name: "Wiki cache",
    verdict: wikiPages > 0 ? "pass" : "warn",
    detail: wikiPages > 0 ? `${wikiPages} pages cached (7-day TTL)` : "empty — first ygo_wiki call will populate it"
  });

  const ocgCdb = path.join(dataDir, "ocgcore", "cards.cdb");
  const officialScripts = fs.existsSync(path.join(dataDir, "ocgcore-scripts", "official"))
    ? fs.readdirSync(path.join(dataDir, "ocgcore-scripts", "official")).filter((f) => f.endsWith(".lua")).length
    : 0;
  checks.push({
    name: "Duel engine assets",
    verdict: fs.existsSync(ocgCdb) ? "pass" : "fail",
    detail: fs.existsSync(ocgCdb)
      ? `cards.cdb present, ${officialScripts} scripts cached`
      : "cards.cdb missing — download BabelCDB to data/ocgcore/cards.cdb"
  });

  const generatedScripts = fs.existsSync(path.join(dataDir, "card-scripts", "generated"))
    ? fs.readdirSync(path.join(dataDir, "card-scripts", "generated")).filter((f) => /^c\d+\.lua$/.test(f)).length
    : 0;
  checks.push({
    name: "Generated scripts",
    verdict: "pass",
    detail:
      generatedScripts === 0
        ? "none (no card is waiting for an official script)"
        : `${generatedScripts} temporary — run ygo_ensure_script with topic=upgrade to replace any that are now official`
  });

  // Card database freshness and coverage. A stale cdb silently makes new cards
  // "unknown", which is exactly how an archetype ends up built from old cards.
  if (fs.existsSync(ocgCdb)) {
    const ageDays = (Date.now() - fs.statSync(ocgCdb).mtimeMs) / 86_400_000;
    checks.push({
      name: "Card database age",
      verdict: ageDays <= 30 ? "pass" : "warn",
      detail:
        ageDays <= 30
          ? `${ageDays.toFixed(0)} days old`
          : `${ageDays.toFixed(0)} days old — run \`ygo fetch-data --force\` to pick up new releases`
    });

    if (!options.offline) {
      const remote = await remoteCdbInfo();
      if (!remote.reachable) {
        checks.push({ name: "Card database version", verdict: "warn", detail: "upstream not reachable — cannot compare versions" });
      } else {
        const localSize = fs.statSync(ocgCdb).size;
        const sameSize = remote.size === 0 || Math.abs(remote.size - localSize) === 0;
        checks.push({
          name: "Card database version",
          verdict: sameSize ? "pass" : "warn",
          detail: sameSize
            ? "matches the upstream BabelCDB build"
            : `local ${formatBytes(localSize)} vs upstream ${formatBytes(remote.size)} — run \`ygo fetch-data --force\``
        });
      }

      const totalRows = await liveCardCount();
      const localCount = await countLocalCards();
      if (totalRows && localCount !== null) {
        const coverage = Math.min(100, (localCount / totalRows) * 100);
        checks.push({
          name: "Card database coverage",
          verdict: coverage >= 98 ? "pass" : "warn",
          detail:
            coverage >= 98
              ? `${localCount} local cards vs ${totalRows} in the live API (${coverage.toFixed(1)}%; the local cdb also ships OCG-only rows)`
              : `${localCount} of ${totalRows} live cards (${coverage.toFixed(1)}%) — newer cards are missing; run \`ygo fetch-data --force\``
        });
      }
    } else {
      checks.push({ name: "Card database version", verdict: "skip", detail: "--offline" });
    }
  }

  const mode = resolveMode("auto");
  const entry = buildEntry(mode.mode);
  const clientChecks: Check[] = CLIENTS.filter(isDetected).map((client) => {
    const verification = verifyAnyScope(client, entry);
    if (verification.configured) {
      return {
        name: client.label,
        verdict: "pass",
        detail: `${verification.configPath} (${verification.scope})`
      };
    }
    const configPath = resolveConfigPath(client, "user") ?? resolveConfigPath(client, "project");
    if (!configPath) return { name: client.label, verdict: "skip", detail: "no config path on this platform" };
    return {
      name: client.label,
      verdict: "warn",
      detail: `detected but not configured — ygo install --client ${client.id}`
    };
  });

  if (!options.offline) {
    const online = await reachable("https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Dark%20Magician");
    checks.push({
      name: "Card API reachability",
      verdict: online ? "pass" : "warn",
      detail: online ? "db.ygoprodeck.com responded" : "unreachable — cached data only"
    });
  } else {
    checks.push({ name: "Card API reachability", verdict: "skip", detail: "--offline" });
  }

  if (options.sources && !options.offline) {
    const sources: Array<{ name: string; url: string }> = [
      { name: "YGOPRODeck", url: "https://db.ygoprodeck.com/api/v7/cardinfo.php?id=14558127" },
      { name: "Yugipedia", url: "https://yugipedia.com/api.php?action=query&meta=siteinfo&format=json" },
      { name: "Konami DB", url: "https://www.db.yugioh-card.com/yugiohdb/?request_locale=en" },
      { name: "Master Duel Meta", url: "https://www.masterduelmeta.com/api/v1/deck-types?limit=1" },
      { name: "TCGCSV", url: "https://tcgcsv.com/tcgplayer/categories" },
      { name: "Yuyu-tei", url: "https://yuyu-tei.jp/" },
      { name: "TCGCorner", url: "https://tcgcorner.com/" },
      { name: "Format Library", url: "https://www.formatlibrary.com/api/decks?limit=1" },
      { name: "YGOrganization", url: "https://ygorganization.com/feed/" }
    ];

    for (const source of sources) {
      const started = Date.now();
      try {
        const response = await httpFetch(source.url, { retries: 0, timeoutMs: 8000, minSpacingMs: 0 });
        const ms = Date.now() - started;
        await response.body?.cancel().catch(() => undefined);
        checks.push({
          name: `Source: ${source.name}`,
          verdict: response.ok ? "pass" : "warn",
          detail: response.ok ? `${response.status} in ${ms} ms` : `HTTP ${response.status} in ${ms} ms`
        });
      } catch (error) {
        checks.push({
          name: `Source: ${source.name}`,
          verdict: "warn",
          detail: `unreachable — ${(error as Error).message}`
        });
      }
    }
  } else if (options.sources && options.offline) {
    checks.push({ name: "Upstream sources", verdict: "skip", detail: "--offline" });
  }

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          version: getVersion(),
          root,
          mode: mode.mode,
          entry,
          checks: [...checks, ...clientChecks]
        },
        null,
        2
      ) + "\n"
    );
  } else {
    heading("Environment check", `${root} · v${getVersion()}`);
    printTable(
      ["Check", "Status", "Detail"],
      [...checks, ...clientChecks].map((check) => [check.name, badge(check.verdict), check.detail])
    );
    const failures = [...checks, ...clientChecks].filter((check) => check.verdict === "fail");
    log.blank();
    if (failures.length > 0) {
      log.fail(`${failures.length} blocking issue(s): ${failures.map((check) => check.name).join(", ")}`);
    } else {
      log.ok("No blocking issues found.");
    }
  }

  const failed = [...checks, ...clientChecks].some((check) => check.verdict === "fail");
  return failed ? 1 : 0;
}
