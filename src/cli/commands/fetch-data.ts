import fs from "node:fs";
import path from "node:path";
import { getPackageRoot } from "../../utils/paths.js";
import { heading, log, printTable } from "../ui.js";
import { syncOfficialRulebook } from "../../core/news-rulings/official-rulebook.js";
import { syncJudgeCorpus } from "../../core/news-rulings/official-docs.js";
import { ensureKdeTemplate } from "../../core/deck-export/kde-template.js";

const CDB_URL = "https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/master/cards.cdb";
const CORE_LUA_BASE = "https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master";
const CORE_LUA_FILES = [
  "constant.lua",
  "utility.lua",
  "chain.lua",
  "archetype_setcode_constants.lua",
  "card_counter_constants.lua",
  "cards_specific_functions.lua",
  "deprecated_functions.lua",
  "proc_equip.lua",
  "proc_fusion.lua",
  "proc_fusion_spell.lua",
  "proc_gemini.lua",
  "proc_link.lua",
  "proc_maximum.lua",
  "proc_normal.lua",
  "proc_pendulum.lua",
  "proc_persistent.lua",
  "proc_ritual.lua",
  "proc_rush.lua",
  "proc_skill.lua",
  "proc_spirit.lua",
  "proc_synchro.lua",
  "proc_union.lua",
  "proc_workaround.lua",
  "proc_xyz.lua"
];

interface FetchRow {
  asset: string;
  status: string;
  detail: string;
}

async function download(url: string, target: string): Promise<number> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(bytes));
  return bytes.byteLength;
}

/**
 * Downloads the data a published install needs on first run.
 *
 * The npm package ships code only: the card database, rulebook and policy
 * corpus are large third-party documents, so they are fetched here instead of
 * being redistributed inside the tarball.
 */
export async function runFetchData(options: { json: boolean; force: boolean }): Promise<number> {
  const root = getPackageRoot();
  const rows: FetchRow[] = [];

  const cdbPath = path.join(root, "data", "ocgcore", "cards.cdb");
  const cdbExists = fs.existsSync(cdbPath);
  if (cdbExists && !options.force) {
    rows.push({ asset: "Card database (cards.cdb)", status: "cached", detail: `${(fs.statSync(cdbPath).size / 1_048_576).toFixed(1)} MB` });
  } else {
    try {
      const size = await download(CDB_URL, cdbPath);
      rows.push({ asset: "Card database (cards.cdb)", status: "downloaded", detail: `${(size / 1_048_576).toFixed(1)} MB` });
    } catch (error) {
      rows.push({ asset: "Card database (cards.cdb)", status: "failed", detail: (error as Error).message });
    }
  }

  try {
    const rulebook = await syncOfficialRulebook({ force: options.force });
    rows.push({
      asset: "Official rulebook",
      status: rulebook.available ? (rulebook.changed ? "downloaded" : "cached") : "failed",
      detail: rulebook.manifest ? `v${rulebook.manifest.version}, ${rulebook.manifest.pageCount} pages` : rulebook.reason || ""
    });
  } catch (error) {
    rows.push({ asset: "Official rulebook", status: "failed", detail: (error as Error).message });
  }

  try {
    const corpus = await syncJudgeCorpus({ force: options.force });
    const available = corpus.docs.filter((d) => d.available).length;
    rows.push({
      asset: "Judge corpus",
      status: corpus.available ? (corpus.synced > 0 ? "downloaded" : "cached") : "failed",
      detail: `${available}/${corpus.docs.length} documents`
    });
  } catch (error) {
    rows.push({ asset: "Judge corpus", status: "failed", detail: (error as Error).message });
  }

  // Konami's deck-list form is not redistributed with the package. It is
  // downloaded here (or supplied via YGO_KDE_TEMPLATE) when the PDF tool needs it.
  try {
    const template = await ensureKdeTemplate(options.force);
    rows.push({
      asset: "Konami deck-list form",
      status: template.downloaded ? "downloaded" : "cached",
      detail: `${(template.bytes / 1024).toFixed(0)} KB`
    });
  } catch (error) {
    rows.push({ asset: "Konami deck-list form", status: "failed", detail: (error as Error).message });
  }

  // The duel engine needs the core Lua libraries (constant/utility/proc_*),
  // not just the per-card scripts. Without them scenarios fail with
  // "attempt to call a nil value (global 'GetID')".
  {
    const luaDir = path.join(root, "data", "ocgcore-scripts");
    let downloaded = 0;
    let cached = 0;
    const failures: string[] = [];
    for (const file of CORE_LUA_FILES) {
      const target = path.join(luaDir, file);
      if (fs.existsSync(target) && !options.force) {
        cached += 1;
        continue;
      }
      try {
        await download(`${CORE_LUA_BASE}/${file}`, target);
        downloaded += 1;
      } catch {
        failures.push(file);
      }
    }
    rows.push({
      asset: "Core Lua libraries",
      status: failures.length === 0 ? (downloaded > 0 ? "downloaded" : "cached") : "failed",
      detail:
        failures.length === 0
          ? `${downloaded} downloaded, ${cached} cached`
          : `${failures.length} missing (${failures.slice(0, 3).join(", ")}${failures.length > 3 ? "…" : ""})`
    });
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ rows }, null, 2) + "\n");
    return rows.some((r) => r.status === "failed") ? 1 : 0;
  }

  heading("Data bootstrap");
  printTable(["Asset", "Status", "Detail"], rows.map((r) => [r.asset, r.status, r.detail]));
  const failed = rows.filter((r) => r.status === "failed");
  if (failed.length === 0) {
    log.info("Everything needed for rulings, deck work and simulation is ready.");
  } else {
    log.warn(`${failed.length} asset(s) could not be fetched; retry when the network is available.`);
  }
  return failed.length === 0 ? 0 : 1;
}
