/**
 * E2E: tier-list sources (Master Duel / Genesys / AE) and the duel AI.
 */

import fs from "node:fs";
import path from "node:path";
import { fetchLiveTierList } from "./core/meta-deck-builder/live-tier-list.js";
import { fetchMasterDuelTierList, fetchGenesysTierList, aeTierListUnavailable } from "./core/meta-deck-builder/tier-sources.js";
import { runAiBenchmark, exportSelfPlay } from "./core/ai/agent.js";
import { createPolicy } from "./core/ai/policy.js";

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

const BEATER = 69247929; // Gene-Warped Warwolf (2000 ATK, level 4)
const WEAKER = 91152256; // Celtic Guardian (1400 ATK, level 4)

async function run() {
  console.log("==================================================================");
  console.log("E2E: TIER SOURCES (MASTER DUEL / GENESYS / AE) + DUEL AI");
  console.log("==================================================================");

  console.log("\n[1] Master Duel tier list");
  const md = await fetchMasterDuelTierList();
  check("MD available", md.available === true, md.reason);
  check("MD has decks", md.decks.length > 0, String(md.decks.length));
  check("MD source is masterduelmeta", md.sourceUrl.includes("masterduelmeta.com"), md.sourceUrl);
  check("MD decks carry a tier", md.decks.every((d) => /^Tier \d/.test(d.tier)), JSON.stringify(md.decks.slice(0, 3)));
  check("MD percentages stay within 100", md.decks.reduce((s, d) => s + d.percentage, 0) <= 100.5, String(md.decks.reduce((s, d) => s + d.percentage, 0)));
  check("MD total tops recorded", md.totalTops > 0, String(md.totalTops));

  console.log("\n[2] Genesys tier list");
  const gx = await fetchGenesysTierList();
  check("Genesys available", gx.available === true, gx.reason);
  check("Genesys has decks", gx.decks.length > 3, String(gx.decks.length));
  check("Genesys source is the omega wiki", gx.sourceUrl.includes("duelistsunite.org"), gx.sourceUrl);
  check(
    "Genesys contains no score-band junk",
    !gx.decks.some((d) => /^\d+\s*to\s*\d+$/i.test(d.name) || /^(deck|players)$/i.test(d.name)),
    JSON.stringify(gx.decks.map((d) => d.name))
  );
  check("Genesys tier 1 is populated", gx.decks.some((d) => d.tier === "Tier 1"), JSON.stringify(gx.decks.slice(0, 4)));

  console.log("\n[3] AE is honest about having no source");
  const ae = aeTierListUnavailable();
  check("AE unavailable", ae.available === false);
  check("AE explains the proxy", /proxy/i.test(ae.reason || ""), ae.reason);
  const aeViaApi = await fetchLiveTierList("AE", { forceRefresh: true });
  check("fetchLiveTierList(AE) routes to the honest response", aeViaApi.available === false && /proxy/i.test(aeViaApi.reason || ""));

  console.log("\n[4] Policy reacts to legal options");
  const policy = createPolicy({ seed: 1, exploration: 0 });
  const idle = policy.respond({
    type: 11, player: 0, to_bp: true, to_ep: true,
    summons: [{ code: BEATER, location: 2, sequence: 0 }],
    special_summons: [], pos_changes: [], monster_sets: [], spell_sets: [], activates: [], shuffle: false
  });
  check("Policy summons a monster", idle?.type === 1 && idle?.action === 0 && idle?.index === 0, JSON.stringify(idle));
  const place = policy.respond({ type: 18, player: 0, count: 1, field_mask: 0xff });
  check("Policy answers SELECT_PLACE immediately", place?.places?.[0]?.location === 4, JSON.stringify(place));
  const chain = policy.respond({ type: 16, player: 1, selects: [{ code: 14558127, location: 2 }] });
  check("Policy chains a hand trap", chain?.index === 0, JSON.stringify(chain));

  console.log("\n[5] AI benchmark on the real engine");
  const bench = await runAiBenchmark({
    deckA: Array(8).fill(BEATER),
    deckB: Array(8).fill(WEAKER),
    games: 1,
    maxSteps: 400,
    startingLP: 2000,
    seed: 5,
    policy: { exploration: 0 }
  });
  check("Benchmark available", bench.available === true, bench.reason);
  check("Benchmark played one game", bench.games === 1, String(bench.games));
  check("Benchmark decided the game", bench.aiWins + bench.baselineWins + bench.draws === 1, JSON.stringify(bench.sample));
  check("Benchmark reports steps", bench.avgSteps > 0, String(bench.avgSteps));

  console.log("\n[6] Self-play export");
  const outPath = path.join(process.cwd(), "data", "ai", "test_selfplay.jsonl");
  fs.rmSync(outPath, { force: true });
  const selfPlay = await exportSelfPlay({
    deckA: Array(6).fill(BEATER),
    deckB: Array(6).fill(WEAKER),
    games: 1,
    maxSteps: 200,
    startingLP: 2000,
    seed: 3,
    outPath
  });
  check("Self-play available", selfPlay.available === true, selfPlay.reason);
  check("Self-play recorded decisions", selfPlay.decisions > 0, String(selfPlay.decisions));
  check("Dataset file written", fs.existsSync(outPath));
  const lines = fs.readFileSync(outPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  check("Dataset lines parse", lines.length > 0 && lines.every((l) => typeof l === "object"));
  check("Dataset has a game result", lines.some((l) => l.result !== undefined));
  check("Dataset decisions carry a chosen action", lines.some((l) => l.chosen !== undefined && l.type !== undefined));
  fs.rmSync(outPath, { force: true });

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} TIER + AI TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
