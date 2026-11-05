/**
 * E2E: Official Konami Rulebook ingestion.
 *
 * Proves that the MCP answers rule questions from the real PDF published at
 * https://www.yugioh-card.com/en/rulebook/ — verbatim text, real page numbers,
 * real section names — and reports honestly when it cannot.
 */

import fs from "node:fs";
import path from "node:path";
import {
  RULEBOOK_LANDING_PAGE,
  syncOfficialRulebook,
  ensureRulebook,
  getRulebookStatus,
  getRulebookSections,
  getRulebookText,
  getRulebookSectionPage,
  searchRulebook,
  getOfficialRulebookExcerpt,
  loadRulebookIndex
} from "./core/news-rulings/official-rulebook.js";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function run() {
  console.log("==================================================================");
  console.log("E2E: OFFICIAL KONAMI RULEBOOK (live PDF → verbatim citations)");
  console.log("==================================================================");

  console.log("\n[1] Sync the official PDF from Konami");
  const sync = await syncOfficialRulebook({ force: false });
  check("Sync returns available", sync.available, sync.reason);
  check("Has a manifest", Boolean(sync.manifest));
  if (!sync.manifest) throw new Error("No manifest, stopping the test.");

  const manifest = sync.manifest;
  check("Source is the official rulebook page", manifest.sourcePage === RULEBOOK_LANDING_PAGE);
  check("PDF is hosted on yugioh-card.com", /^https:\/\/www\.yugioh-card\.com\//.test(manifest.sourceUrl), manifest.sourceUrl);
  check("Is the rulebook file (not Speed Duel/Beginner)", /rulebook/i.test(manifest.sourceUrl));
  check("Has a version number", /^\d+/.test(manifest.version), manifest.version);
  check("Extracted >= 50 printed pages", manifest.pageCount >= 50, String(manifest.pageCount));
  check("Has >= 19 official table-of-contents entries", manifest.sections.length >= 19, String(manifest.sections.length));
  check("Has a SHA-256 hash", /^[a-f0-9]{64}$/.test(manifest.sha256));
  const localPdf = path.join(process.cwd(), "data", "rulebook", path.basename(new URL(manifest.sourceUrl).pathname));
  check("PDF stored locally", fs.existsSync(localPdf));
  check("Local PDF has real data (>1MB)", fs.existsSync(localPdf) && fs.statSync(localPdf).size > 1_000_000, fs.existsSync(localPdf) ? `${fs.statSync(localPdf).size} bytes` : "missing");
  check("pdfBytes matches the file on disk", fs.existsSync(localPdf) && fs.statSync(localPdf).size === manifest.pdfBytes, `${manifest.pdfBytes}`);
  check("Local index exists", fs.existsSync(path.join(process.cwd(), "data", "rulebook", "index.json")));

  console.log("\n[2] Status & freshness");
  const status = getRulebookStatus();
  check("loaded = true", status.loaded === true);
  check("available = true", status.available === true);
  check("No stale", status.stale === false, `ageDays=${status.ageDays}`);
  // The rulebook is cached for 7 days, so a reused local copy can legitimately
  // be several days old. Assert the reported age is real and inside the TTL
  // instead of assuming the cache was downloaded moments ago.
  check(
    "ageDays is a valid number inside the cache TTL",
    typeof status.ageDays === "number" && status.ageDays >= 0 && status.ageDays < 7,
    String(status.ageDays)
  );
  check(
    "ageDays agrees with the stale flag",
    status.stale === !(typeof status.ageDays === "number" && status.ageDays < 7),
    `ageDays=${status.ageDays} stale=${status.stale}`
  );
  check("Status matches manifest", status.sha256 === manifest.sha256);

  console.log("\n[3] Section list matches the PDF Table of Contents");
  const sections = getRulebookSections().sections;
  const byTitle = new Map(sections.map((s) => [s.title, s]));
  check("Has 'Xyz Monsters' at page 18", byTitle.get("Xyz Monsters")?.startPage === 18, JSON.stringify(byTitle.get("Xyz Monsters")));
  check("Has 'Pendulum Monsters' at page 16", byTitle.get("Pendulum Monsters")?.startPage === 16, JSON.stringify(byTitle.get("Pendulum Monsters")));
  check("Has 'Chains and Spell Speed' at page 44", byTitle.get("Chains and Spell Speed")?.startPage === 44, JSON.stringify(byTitle.get("Chains and Spell Speed")));
  check("Has 'Monster Battle Rules' at page 41", byTitle.get("Monster Battle Rules")?.startPage === 41);
  check("Has 'Glossary' at page 52", byTitle.get("Glossary")?.startPage === 52);
  check("Has 'Turn Structure' at page 34", byTitle.get("Turn Structure")?.startPage === 34);

  console.log("\n[4] Verbatim citations + real page numbers");
  const excerpt = getOfficialRulebookExcerpt("During the Damage Step, you can only activate Counter Trap Cards", 3);
  check("Finds the verbatim passage", excerpt.available && excerpt.citations.length > 0);
  const top = excerpt.citations[0];
  check("Citation points to page 41 (DAMAGE STEP RULES)", top?.page === 41, JSON.stringify(top?.page));
  check("Correct section 'Monster Battle Rules'", top?.section === "Monster Battle Rules", top?.section);
  check(
    "Snippet contains the verbatim rule sentence",
    (top?.snippet || "").includes("During the Damage Step, you can only activate Counter Trap Cards"),
    top?.snippet?.slice(0, 120)
  );

  const page41 = getRulebookText(41);
  check("Reads the full text of page 41", page41.available === true);
  check(
    "Page 41 contains the verbatim Damage Step rule",
    (page41.page?.text || "").includes("you can only activate Counter Trap Cards")
  );

  console.log("\n[5] Lookup by section and by page");
  const chains = getRulebookSectionPage("Chains and Spell Speed");
  check("Retrieves the full 'Chains and Spell Speed' section", chains.available === true, chains.reason);
  check("This section starts at page 44", chains.section?.startPage === 44);
  check("Full section contains the official Chain definition", (chains.text || "").includes("Chains are a way to order the resolution"));
  check("Full section contains 'Spell Speed'", (chains.text || "").toLowerCase().includes("spell speed"));

  const glossary = getRulebookSectionPage("Glossary");
  check("Glossary retrieved", glossary.available === true);
  check("Glossary contains the term 'Xyz'", (glossary.text || "").includes("Xyz"));

  const missing = getRulebookText(9999);
  check("Missing page returns available=false (no fabrication)", missing.available === false);

  console.log("\n[6] Search & anti-fabrication");
  const xyz = searchRulebook("how many monsters do you need for an Xyz Summon", 3);
  check("Xyz search has results", xyz.available && xyz.totalMatches > 0);
  check("Top hit is in the Xyz/Pendulum range (p12-19)", (xyz.hits[0]?.page ?? 0) >= 12 && (xyz.hits[0]?.page ?? 0) <= 19, String(xyz.hits[0]?.page));
  check("Snippet has content", (xyz.hits[0]?.snippet || "").length > 40);

  const nonsense = getOfficialRulebookExcerpt("zzzqqq flurblewump noneuclidean", 3);
  check("Garbage query returns available=true but 0 citations", nonsense.available === true && nonsense.citations.length === 0);
  check("Has a clear reason instead of fabricating", typeof nonsense.reason === "string" && nonsense.reason!.length > 10);

  console.log("\n[7] Data integrity");
  const index = loadRulebookIndex();
  check("Index has pages", Boolean(index && index.pages.length >= 50));
  const pagesSorted = (index?.pages || []).every((p, i, arr) => i === 0 || arr[i - 1].page <= p.page);
  check("Pages are sorted in ascending order", pagesSorted);
  const duplicatePages = (index?.pages || []).filter((p, i, arr) => arr.findIndex((x) => x.page === p.page) !== i);
  check("No duplicate page numbers", duplicatePages.length === 0, duplicatePages.map((p) => p.page).join(","));
  check("No empty pages", (index?.pages || []).every((p) => p.text.trim().length > 50));

  const spellSpeed = searchRulebook("Spell Speed 3 Counter Trap", 2);
  check("Search 'Spell Speed 3 Counter Trap' returns pages 44-48", spellSpeed.hits.some((h) => h.page >= 44 && h.page <= 48), spellSpeed.hits.map((h) => h.page).join(","));

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} RULEBOOK TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
