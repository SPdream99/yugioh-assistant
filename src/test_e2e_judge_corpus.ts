/**
 * E2E: Official judge corpus.
 *
 * Proves that judge answers come from Konami's real documents — Tournament
 * Policy, Infractions & Penalties, Fast Effect Timing, Judge FAQ — with
 * document name, version and page citations, and that nothing is fabricated.
 */

import fs from "node:fs";
import path from "node:path";
import {
  JUDGE_DOCS,
  ORGANIZED_PLAY_PAGE,
  syncJudgeCorpus,
  ensureJudgeCorpus,
  getJudgeCorpusStatus,
  listJudgeDocuments,
  searchJudgeDocs,
  getJudgeDocPage,
  getJudgeDocSection,
  loadDoc,
  citationFor
} from "./core/news-rulings/official-docs.js";

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

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[“”‘’]/g, (c) => ({ "“": '"', "”": '"', "‘": "'", "’": "'" }[c] as string)).trim();

async function run() {
  console.log("==================================================================");
  console.log("E2E: OFFICIAL JUDGE CORPUS (policy, penalties, timing, FAQ)");
  console.log("==================================================================");

  console.log("\n[1] Sync 10 official judge documents");
  const sync = await syncJudgeCorpus({ force: false });
  check("Sync available", sync.available, sync.reason);
  const status = getJudgeCorpusStatus();
  check(`All ${JUDGE_DOCS.length} documents present`, status.totalDocs === JUDGE_DOCS.length, `${status.totalDocs}/${JUDGE_DOCS.length}`);
  check("Total content > 250k characters", status.totalChars > 250_000, String(status.totalChars));
  check("Has both PDFs and web pages", status.docs.some((d) => d.kind === "pdf") && status.docs.some((d) => d.kind === "html"));
  check(
    "Every document comes from yugioh-card.com",
    status.docs.filter((d) => d.available).every((d) => /^https:\/\/www\.yugioh-card\.com\//.test(d.url || "")),
    status.docs.filter((d) => d.available && !/^https:\/\/www\.yugioh-card\.com\//.test(d.url || "")).map((d) => d.url).join(",")
  );
  check("No stale documents", status.docs.filter((d) => d.available).every((d) => d.stale === false));
  check("SHA-256 present for every document", status.docs.filter((d) => d.available).every((d) => /^[a-f0-9]{64}$/.test(d.sha256 || "")));

  console.log("\n[2] Right documents, right versions");
  const byId = new Map(status.docs.map((d) => [d.id, d]));
  check("Tournament Policy v2.5", byId.get("tournament-policy")?.version === "2.5", byId.get("tournament-policy")?.version);
  check("Penalties v2.3", byId.get("penalties")?.version === "2.3", byId.get("penalties")?.version);
  check("Tournament Policy has 58 pages", byId.get("tournament-policy")?.pageCount === 58, String(byId.get("tournament-policy")?.pageCount));
  check("Penalties has 33 pages", byId.get("penalties")?.pageCount === 33, String(byId.get("penalties")?.pageCount));
  check("Organized Play page used to discover PDFs", ORGANIZED_PLAY_PAGE.includes("organizedplay"));
  check("Policy PDF stored locally", fs.existsSync(path.join(process.cwd(), "data", "judge", "files", "YGOTCG_Tournament_Policy_v_2_5.pdf")));
  check("Penalties PDF stored locally", fs.existsSync(path.join(process.cwd(), "data", "judge", "files", "Penalty_Guidelines_v_2_3.pdf")));

  console.log("\n[3] Verbatim content in the right place");
  const tp = loadDoc("tournament-policy")!;
  check("Has per-page chunks", tp.chunks.every((c) => typeof c.page === "number"));
  check("No repeated header/footer", !tp.chunks.some((c) => (c.text.match(/Official KDE-US Yu-Gi-Oh! TRADING CARD GAME Tournament Policy/g) || []).length > 2));
  check("Has 'P. Appeals' in headings", tp.headings.some((h) => h.title === "P. Appeals"));
  check("Has a 'C. Deck Errors' section", tp.headings.some((h) => h.title === "C. Deck Errors"));

  const appeals = getJudgeDocSection("tournament-policy", "Appeals");
  check("Appeals section retrieved", appeals.available === true, appeals.reason);
  check("Starts exactly with the section title", (appeals.text || "").split("\n")[1]?.trim() === "P. Appeals", (appeals.text || "").slice(0, 60));
  check("Contains verbatim 'right to appeal'", (appeals.text || "").includes("you have the right to appeal that ruling"));
  check("Contains 'The Head Judge’s ruling is final'", (appeals.text || "").replace(/[’']/g, "'").includes("The Head Judge's ruling is final"));
  check("Does not bleed into the next section (Conceding)", !(appeals.text || "").includes("You may concede a Game or Match at any time"));

  console.log("\n[4] Real judge questions → right document + right page");
  const draw = searchJudgeDocs("penalty for intentionally drawing an extra card", { limit: 4 });
  check("Finds the penalty for drawing an extra card", draw.totalMatches > 0);
  check("Top hit belongs to Penalties", draw.hits[0]?.docId === "penalties", draw.hits[0]?.docId);
  check(
    "Distinguishes intentional (UC-Cheating) from unintentional (DC)",
    draw.hits.some((h) => h.snippet.includes("Drawing Extra Cards (DC)")) &&
      draw.hits.some((h) => h.snippet.includes("UC-Cheating"))
  );

  const slow = searchJudgeDocs("slow play warning", { document: "penalties", limit: 3 });
  check("Slow Play returns hits from the penalties document", slow.hits.every((h) => h.docId === "penalties"));
  check("Slow Play states the Warning penalty", slow.hits[0]?.snippet.includes("Slow Play (SP)") && slow.hits[0]?.snippet.includes("Warning"), slow.hits[0]?.snippet.slice(0, 90));

  const fast = searchJudgeDocs("who activates the next fast effect", { document: "fast-effect-timing", limit: 5 });
  check("Fast Effect Timing has results", fast.totalMatches > 0);
  check("Top hit belongs to Fast Effect Timing", fast.hits[0]?.docId === "fast-effect-timing");
  check("Results include 'Turn Player Actions'", fast.hits.some((h) => (h.section || "").includes("Turn Player Actions")), fast.hits.map((h) => h.section).join(" | "));

  const level1 = searchJudgeDocs("how do I take the level 1 judge test", { document: "judge-faq", limit: 3 });
  check("Judge FAQ answers questions about the Level 1 test", level1.totalMatches > 0 && level1.hits.some((h) => /level 1/i.test(h.snippet)));

  const rivalry = searchJudgeDocs("can I summon a different type while Rivalry of Warlords is active", { document: "card-faq-rivalry-gozen", limit: 3 });
  check("Card FAQ Rivalry/Gozen has results", rivalry.totalMatches > 0);
  check(
    "States the rule that you cannot Summon a different Type",
    rivalry.hits.some((h) => /cannot.*Summon|can ?not.*Summon/i.test(h.snippet)),
    rivalry.hits[0]?.snippet.slice(0, 120)
  );

  const judgeProgram = searchJudgeDocs("how do I become a registered judge", { document: "judge-program", limit: 3 });
  check("Judge Program covers judge registration", judgeProgram.totalMatches > 0);

  console.log("\n[5] No fabrication: every snippet must be a substring of the source document");
  let fabricated = 0;
  for (const q of [
    "penalty for intentionally drawing an extra card",
    "slow play warning",
    "appeal a judge ruling",
    "unsporting conduct",
    "marked cards sleeves",
    "deck check"
  ]) {
    const res = searchJudgeDocs(q, { limit: 5 });
    for (const hit of res.hits) {
      const doc = loadDoc(hit.docId);
      const source = doc ? norm(doc.chunks.map((c) => c.text).join(" ")) : "";
      const snippet = norm(hit.snippet.replace(/^…/, "").replace(/…$/, ""));
      if (!source.includes(snippet)) {
        fabricated++;
        console.error(`    ! snippet does not match source: ${hit.docId} p.${hit.page} :: ${snippet.slice(0, 80)}`);
      }
    }
  }
  check("No fabricated snippets", fabricated === 0, `${fabricated} snippets mismatch source`);

  console.log("\n[6] Answers honestly when data is missing");
  const missingDoc = searchJudgeDocs("penalty", { document: "khong-ton-tai" });
  check("Document does not exist → available=false", missingDoc.available === false);
  check("Has a clear reason", (missingDoc.reason || "").length > 10);

  const badPage = getJudgeDocPage("penalties", 9999);
  check("Page out of range → available=false", badPage.available === false);
  check("Reports the correct maximum page number", (badPage.reason || "").includes("33"), badPage.reason);

  const badSection = getJudgeDocSection("tournament-policy", "zzz khong co muc nay");
  check("Section does not exist → available=false + suggestions", badSection.available === false && (badSection.suggestions || []).length > 0);

  const htmlPage = getJudgeDocPage("fast-effect-timing", 3);
  check("Web page has no page numbers → reported clearly", htmlPage.available === false && (htmlPage.reason || "").includes("section"));

  const nonsense = searchJudgeDocs("zzzqqq flurblewump", { limit: 3 });
  check("Garbage query → 0 hits, no fabrication", nonsense.available === true && nonsense.hits.length === 0);

  console.log("\n[7] Citation & catalog");
  const cite = citationFor("tournament-policy", 40);
  check("Citation has name + version + page", cite.includes("Tournament Policy") && cite.includes("v2.5") && cite.includes("p.40"), cite);
  const list = listJudgeDocuments();
  check("listJudgeDocuments returns the full set", list.length === JUDGE_DOCS.length, `${list.length}/${JUDGE_DOCS.length}`);
  check("Every entry is available", list.every((d) => d.available));

  console.log("\n[8] PSCT (7 official articles)");
  for (let i = 1; i <= 7; i++) {
    const doc = loadDoc(`psct-${i}`);
    check(`PSCT part ${i} loaded`, Boolean(doc && doc.charCount > 3000), String(doc?.charCount));
  }
  const psctCost = searchJudgeDocs("cost before the semicolon vs effect after", { limit: 4 });
  check("Finds the passage about the semicolon / cost", psctCost.hits.some((h) => h.docId.startsWith("psct")), psctCost.hits.map((h) => h.docId).join(","));
  const psctConj = searchJudgeDocs("\"and if you do\" versus \"then\"", { limit: 4 });
  check("Has the article about 'and if you do' / 'then'", psctConj.hits.some((h) => h.docId === "psct-7"), psctConj.hits.map((h) => h.docId).join(","));
  const psctTarget = searchJudgeDocs("targeting versus choosing at resolution", { limit: 4 });
  check("Has targeting content", psctTarget.hits.some((h) => h.docId.startsWith("psct")), psctTarget.hits.map((h) => h.docId).join(","));
  const psctChars = status.docs.filter((d) => d.id.startsWith("psct")).reduce((s, d) => s + (d.charCount || 0), 0);
  check("Total PSCT content > 45k characters", psctChars > 45_000, String(psctChars));

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} JUDGE CORPUS TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
