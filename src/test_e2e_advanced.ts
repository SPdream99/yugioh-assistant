/**
 * E2E: advanced capabilities added after the first audit.
 *
 * Covers citation precision, claim verification, lock detection, golden
 * regression, the consistency lab, matchup planning, deck cost and the removal
 * of the hardcoded card list.
 */

import { citationsForMechanics } from "./core/news-rulings/citations.js";
import { verifyRulingClaim } from "./core/card-scripts/ruling-verifier.js";
import { detectLocks, auditDeckLocks } from "./core/card-scripts/lock-detector.js";
import { runGoldenSuite } from "./core/card-scripts/golden-regression.js";
import { measureConsistency } from "./core/deck-consistency/lab.js";
import { buildMatchupPlan } from "./core/meta-deck-builder/matchup-planner.js";
import { computeDeckCost } from "./core/pricing/deck-cost.js";
import { resolveCardScript } from "./core/card-scripts/script-resolver.js";
import { CardDatabase } from "./core/card-database/ygoprodeck.js";
import { parseBoard } from "./core/card-scripts/board-dsl.js";
import { TOOLS } from "./tools/index.js";

let passed = 0;
let failed = 0;

async function toolCall(name: string, args: any): Promise<any> {
  const tool = (TOOLS as any[]).find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args);
}

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BRANDED_FUSION = 44362883;
const ASH = 14558127;

async function run() {
  console.log("==================================================================");
  console.log("E2E: ADVANCED CAPABILITIES");
  console.log("==================================================================");

  console.log("\n[1] Citation precision");
  const neg = citationsForMechanics(["negation"], 4);
  check("Negation cites the Chains section", neg.some((c) => c.source === "official_rulebook" && /Chains and Spell Speed/.test(c.citation)), JSON.stringify(neg.map((c) => c.citation)));
  check("Negation cites PSCT Part 3", neg.some((c) => /PSCT Part 3/.test(c.citation)), JSON.stringify(neg.map((c) => c.citation)));
  check("Negation does not cite the Summoning page", !neg.some((c) => /Summoning Monster Cards/.test(c.citation)), JSON.stringify(neg.map((c) => c.citation)));
  const cost = citationsForMechanics(["cost"], 2);
  check("Cost cites PSCT Part 3", cost.some((c) => /PSCT Part 3/.test(c.citation)), JSON.stringify(cost.map((c) => c.citation)));

  console.log("\n[2] Claim verification");
  const positive = await verifyRulingClaim({ claim: "Called by the Grave negates Ash Blossom" });
  check("Affirmative claim is SUPPORTED", positive.outcome === "SUPPORTED", positive.reason);
  check("Verification reports a scenario", Boolean(positive.scenario), positive.scenario);
  check("Verification carries evidence", positive.evidence.length > 0);
  const negative = await verifyRulingClaim({ claim: "Called by the Grave cannot negate Ash Blossom" });
  check("Negative claim is CONTRADICTED", negative.outcome === "CONTRADICTED", negative.reason);
  const wrongCount = await verifyRulingClaim({ claim: "Pot of Greed draws three cards" });
  check("Wrong draw count is CONTRADICTED", wrongCount.outcome === "CONTRADICTED", wrongCount.reason);
  const unknown = await verifyRulingClaim({ claim: "Mystical Elf cannot be destroyed by battle" });
  check("Claim with no scenario is INCONCLUSIVE", unknown.outcome === "INCONCLUSIVE", unknown.outcome);

  console.log("\n[3] Lock detection");
  const script = await resolveCardScript(BRANDED_FUSION, { allowGenerate: false });
  check("Branded Fusion script available", script.available === true, script.reason);
  const locks = detectLocks(script.text!);
  check("A lock is detected", locks.length > 0, JSON.stringify(locks));
  check(
    "Branded Fusion locks the Extra Deck to Fusion Monsters",
    locks.some((l) => l.kind === "extra-deck-lock" && /Fusion/i.test(l.detail)),
    JSON.stringify(locks)
  );
  const audit = await auditDeckLocks([BRANDED_FUSION, ASH], async (passcode) => {
    const resolved = await resolveCardScript(passcode, { allowGenerate: false });
    return { available: resolved.available, text: resolved.text, cardName: resolved.cardName };
  });
  check("Deck lock audit runs", audit.available === true && audit.cardsChecked === 2, JSON.stringify({ available: audit.available, checked: audit.cardsChecked }));
  check("Deck lock audit reports the lock", audit.locksFound > 0, String(audit.locksFound));

  console.log("\n[4] Golden regression");
  const golden = await runGoldenSuite();
  check("Golden cases exist", golden.total >= 4, String(golden.total));
  check("Golden suite passes", golden.failed === 0 && golden.errored === 0, JSON.stringify(golden.results.filter((r) => r.verdict !== "pass")));

  console.log("\n[5] Consistency lab");
  const lab = await measureConsistency({
    main: [55144522, 55144522, 14558127, 14558127, 24224830, BRANDED_FUSION, 68468459, 97268402],
    trials: 2,
    seed: 7
  });
  check("Lab runs", lab.available === true, lab.reason);
  check("Lab reports trials", lab.trials === 2, String(lab.trials));
  check("Playable rate is a percentage", lab.playableRate >= 0 && lab.playableRate <= 100, String(lab.playableRate));
  check("Brick rate complements it", Math.abs(lab.playableRate + lab.brickRate - 100) < 0.2, `${lab.playableRate}+${lab.brickRate}`);
  check("Openers recorded", lab.openerFrequency.length > 0);

  console.log("\n[6] Matchup planner");
  const plan = await buildMatchupPlan({ format: "TCG", sideSize: 15 });
  check("Planner returns a field plan", plan.available === true, plan.reason);
  check("Field has entries", plan.field.length > 0, String(plan.field.length));
  check("Expected frequency sums near 100", Math.abs(plan.field.reduce((s, f) => s + f.expectedFrequency, 0) - 100) < 1, String(plan.field.reduce((s, f) => s + f.expectedFrequency, 0)));
  check("Side plan proposed", plan.sidePlan.length > 0, String(plan.sidePlan.length));

  console.log("\n[7] Deck cost");
  const costReport = await computeDeckCost({ cards: [{ name: "Ash Blossom & Joyous Spring", passcode: ASH, copies: 1 }], maxCards: 1 });
  check("Cost report available", costReport.available === true, costReport.reason);
  check("At least one market priced", Object.keys(costReport.totals).length > 0, JSON.stringify(costReport.totals));
  check("Cheapest market identified", Boolean(costReport.cheapestMarket), String(costReport.cheapestMarket));

  console.log("\n[8] Card data unification");
  const db = CardDatabase.getInstance();
  const search = db.searchCards({ name: "Maliss" });
  check("Search finds cards outside the old hardcoded list", search.length > 0, String(search.length));
  check("No builtin fallback is used", search.every((c) => typeof c.id === "number" && c.id > 0));

  console.log("\n[9] Board notation");
  const boardText = [
    "A hand: Branded Fusion",
    "B hand: Ash Blossom",
    "A deck: Fallen of Albaz, Effect Veiler",
    "A extra: Albion the Branded Dragon",
    'A: activate "Branded Fusion"',
    'B: chain "Ash Blossom"',
    'expect: chainLink "Ash Blossom" 2',
    'expect: notSummoned "Albion the Branded Dragon"'
  ].join("\n");
  const parsed = parseBoard(boardText);
  check("Board parsed", parsed.available === true, parsed.errors.join(" | "));
  check("Hands parsed", (parsed.spec?.handA?.length || 0) === 1 && (parsed.spec?.handB?.length || 0) === 1);
  check("Decisions parsed", (parsed.spec?.decisions.length || 0) === 2, String(parsed.spec?.decisions.length));
  check("Expectations parsed with link number", Boolean(parsed.spec?.expect.some((e: any) => e.kind === "chainLink" && e.link === 2)), JSON.stringify(parsed.spec?.expect));

  const boardRun = await toolCall("ygo_judge_scenario", { board: boardText });
  check("Board scenario runs", boardRun.verdict === "CONFIRMED", boardRun.reason || boardRun.conclusion);
  check("Board scenario built the chain", (boardRun.chain || []).length === 2, String((boardRun.chain || []).length));

  const badBoard = parseBoard('A: teleport "Branded Fusion"');
  check("Unknown action is reported", badBoard.available === false && badBoard.errors.length > 0, JSON.stringify(badBoard.errors));

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} ADVANCED TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
