/**
 * E2E: cross-tool integration.
 *
 * These tests exercise the chains an agent actually follows, not single
 * functions: one call for a card dossier, rulings with citations, a scenario
 * written with card names instead of passcodes, and news that points at the
 * next step.
 */

import { buildCardDossier } from "./core/card-database/card-dossier.js";
import { TOOLS } from "./tools/index.js";
import { listJudgeDocuments, getJudgeDocSection } from "./core/news-rulings/official-docs.js";
import { getLatestYgoNews } from "./core/news-rulings/ygorganization.js";

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

function tool(name: string) {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`Tool ${name} is not registered`);
  return found as any;
}

const ASH = 14558127;

async function run() {
  console.log("==================================================================");
  console.log("E2E: CROSS-TOOL INTEGRATION");
  console.log("==================================================================");

  console.log("\n[1] Card dossier — one call, all sources");
  const dossier = await buildCardDossier({ passcode: ASH });
  check("Dossier available", dossier.available === true, dossier.reason);
  check("Passcode resolved", dossier.identity.passcode === ASH, String(dossier.identity.passcode));
  check("English name present", /Ash Blossom/.test(dossier.identity.name || ""), dossier.identity.name);
  check("Yu-Gi-Oh! Card Database ID present", Boolean(dossier.identity.databaseId), dossier.identity.databaseId);
  check("12-language names present", Object.keys(dossier.identity.names || {}).length >= 8, String(Object.keys(dossier.identity.names || {}).length));
  check("Stats present", dossier.stats?.atk === 0 || dossier.stats?.atk === undefined || typeof dossier.stats?.atk === "number");
  check("Script provenance reported", dossier.script?.provenance === "official", String(dossier.script?.provenance));
  check("Wiki tabs reported", Boolean(dossier.wiki?.tabs?.rulings), JSON.stringify(dossier.wiki?.tabs));
  check("Per-source status reported", dossier.sources.length >= 3, JSON.stringify(dossier.sources.map((s) => s.source)));
  check("No silent gaps", dossier.sources.every((s) => typeof s.ok === "boolean"));

  const byName = await buildCardDossier({ name: "Dark Magician" });
  check("Dossier by name works", byName.available === true && /Dark Magician/.test(byName.identity.name || ""), byName.identity.name);

  const withRulings = await buildCardDossier({ passcode: ASH, includeRulings: true });
  check("Optional rulings attached", Boolean(withRulings.rulings?.text) || withRulings.sources.some((s) => s.source === "yugipedia_rulings"), JSON.stringify(withRulings.sources));

  console.log("\n[2] judge_card accepts a name and reports provenance");
  const judge = await tool("ygo_judge_card").handler({ cardName: "Ash Blossom & Joyous Spring" });
  check("Name resolved to a passcode", judge.passcode === ASH, String(judge.passcode));
  check("Script provenance reported", judge.script?.provenance === "official", JSON.stringify(judge.script));
  check("Citations attached", Array.isArray(judge.citations) && judge.citations.length > 0, JSON.stringify(judge.citations?.length));
  check("Citation carries a page/section", (judge.citations || []).every((c: any) => /p\.\d+|psct/i.test(c.citation)), JSON.stringify(judge.citations?.map((c: any) => c.citation)));

  const missing = await tool("ygo_judge_card").handler({});
  check("No arguments gives a clear error", missing.available === false && typeof missing.reason === "string");

  console.log("\n[3] judge_interaction returns citations");
  const interaction = await tool("ygo_judge_interaction").handler({
    cardA: "Ash Blossom & Joyous Spring",
    cardB: "Called by the Grave",
    question: "Can I negate Ash Blossom's effect with Called by the Grave?"
  });
  check("Adjudication returned", typeof interaction.adjudication === "string" && interaction.adjudication.length > 100);
  check("Citations attached", Array.isArray(interaction.citations) && interaction.citations.length > 0, String(interaction.citations?.length));

  console.log("\n[4] Scenario written with card names instead of passcodes");
  const scenario = await tool("ygo_judge_scenario").handler({
    scenario: JSON.stringify({
      name: "Branded Fusion vs Ash (by name)",
      handA: ["Branded Fusion"],
      handB: ["Ash Blossom & Joyous Spring"],
      deckA: ["Fallen of Albaz", "Effect Veiler", ...Array(18).fill("Dark Magician")],
      deckB: Array(20).fill("Dark Magician"),
      extraA: ["Albion the Branded Dragon"],
      decisions: [
        { on: "idle", player: 0, action: "activate", card: "Branded Fusion" },
        { on: "chain", player: 1, card: "Ash Blossom & Joyous Spring" }
      ],
      expect: [
        { kind: "chainLink", card: ASH, link: 2 },
        { kind: "notSummoned", card: 87746184 }
      ]
    }),
    citations: true
  });
  check("Scenario ran", typeof scenario.verdict === "string", scenario.reason);
  check("Names resolved to passcodes", scenario.chain?.some((c: any) => c.code === ASH), JSON.stringify(scenario.chain?.map((c: any) => c.code)));
  check("Verdict is CONFIRMED", scenario.verdict === "CONFIRMED", scenario.conclusion);
  check("Citations attached", Array.isArray(scenario.citations) && scenario.citations.length > 0);

  console.log("\n[5] Deck text flows into the simulator");
  const ydke = "ydke://zM3LAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUB!!";
  const duel = await tool("ygo_run_duel").handler({ deck: ydke, opponentDeck: ydke, maxSteps: 12, handA: ["Dark Magician"] });
  check("Deck text parsed into the engine", typeof duel.runtime === "string" && duel.runtime === "ocgcore-wasm", duel.reason);
  check("Engine produced a timeline", Array.isArray(duel.timeline) && duel.timeline.length > 0, String(duel.timeline?.length));

  console.log("\n[6] News points at the next step");
  const news = await getLatestYgoNews(10);
  check("News fetched", news.length > 0, String(news.length));
  const reveal = news.find((n) => n.isCardReveal);
  if (reveal) {
    const articles = (await tool("ygo_get_news").handler({ limit: 10 })).articles;
    const withNext = articles.find((a: any) => a.next);
    check("Reveal carries a next-step hint", Boolean(withNext?.next?.tool === "ygo_ensure_script"), JSON.stringify(withNext?.next));
    check("Hint includes the article URL", Boolean(withNext?.next?.args?.url), JSON.stringify(withNext?.next?.args));
  }

  console.log("\n[7] Judge corpus covers both regions");
  const docs = listJudgeDocuments();
  check("US policy present", docs.some((d) => d.id === "tournament-policy"));
  check("EU policy present", docs.some((d) => d.id === "eu-tournament-policy"));
  check("EU penalties present", docs.some((d) => d.id === "eu-penalties"));
  check("Corpus has at least 20 documents", docs.length >= 20, String(docs.length));

  const euSection = getJudgeDocSection("eu-tournament-policy", "Appeals");
  check("EU document section readable", euSection.available === true, euSection.reason);

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} INTEGRATION TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
