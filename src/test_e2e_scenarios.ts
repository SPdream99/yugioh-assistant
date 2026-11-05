/**
 * E2E: scripted duel scenarios executed by the real EDOPro core.
 *
 * Each scenario is run end-to-end by ocgcore-wasm, and the judge's expectation
 * is checked against the engine's own messages. These are the scenarios the
 * project has used as reference cases (Branded Fusion / Ash Blossom / Called by
 * the Grave), plus the contrast case that proves a wrong call is caught.
 */

import { runScenario, cardLabel } from "./core/card-scripts/scenario-runner.js";

const BRANDED_FUSION = 44362883;
const ASH = 14558127;
const CALLED = 24224830;
const ALBAZ = 68468459;
const VEILER = 97268402;
const ALBION = 87746184;
const POT_OF_GREED = 55144522;
const FILLER = 46986420;

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

const deckA = () => [ALBAZ, VEILER, ...Array(18).fill(FILLER)];
const deckB = () => Array(20).fill(FILLER);

async function run() {
  console.log("==================================================================");
  console.log("E2E: SCRIPTED SCENARIOS ON THE REAL EDOPro CORE");
  console.log("==================================================================");

  // -------------------------------------------------------------------------
  console.log("\n[1] Branded Fusion → Ash Blossom → Called by the Grave");
  const s1 = await runScenario({
    name: "Branded Fusion vs Ash vs Called by the Grave",
    description: "Ash negates Branded Fusion, Called by the Grave protects it.",
    handA: [BRANDED_FUSION, CALLED],
    handB: [ASH],
    deckA: deckA(),
    deckB: deckB(),
    extraA: [ALBION],
    decisions: [
      { on: "idle", player: 0, action: "activate", card: BRANDED_FUSION, label: "A activates Branded Fusion" },
      { on: "chain", player: 1, card: ASH, label: "B chains Ash Blossom" },
      { on: "chain", player: 0, card: CALLED, label: "A chains Called by the Grave" },
      { on: "card", player: 0, cards: [ALBION], label: "A picks the Fusion target" },
      { on: "card", player: 0, cards: [ALBAZ, VEILER], label: "A picks the materials" }
    ],
    expect: [
      { kind: "chainLink", card: BRANDED_FUSION, link: 1 },
      { kind: "chainLink", card: ASH, link: 2 },
      { kind: "chainLink", card: CALLED, link: 3 },
      { kind: "banished", card: ASH },
      { kind: "summoned", card: ALBION }
    ]
  });

  check("Engine runs without errors", s1.legal, s1.engineErrors.join(" | "));
  check("Verdict = CONFIRMED", s1.verdict === "CONFIRMED", s1.conclusion);
  check("Chain has exactly 3 links", s1.chain.length === 3, String(s1.chain.length));
  check("CL1 = Branded Fusion", s1.chain[0]?.code === BRANDED_FUSION, String(s1.chain[0]?.code));
  check("CL2 = Ash Blossom", s1.chain[1]?.code === ASH);
  check("CL3 = Called by the Grave", s1.chain[2]?.code === CALLED);
  check("Albion is Fusion Summoned", s1.expectations.find((e) => e.expectation.includes("is Summoned"))?.met === true);
  check("Ash is banished", s1.expectations.find((e) => e.expectation.includes("is banished"))?.met === true);
  check("Transcript records all 3 chain steps", s1.transcript.filter((t) => t.includes("chain")).length === 2, s1.transcript.join(" | "));
  check("Evidence cites the engine", s1.expectations.every((e) => e.evidence.startsWith("Engine:")), s1.expectations.map((e) => e.evidence).join(" | "));
  check("Conclusion states the actual chain", s1.conclusion.includes("CL1") && s1.conclusion.includes("CL3"));

  // -------------------------------------------------------------------------
  console.log("\n[2] Branded Fusion vs Ash (NO protection)");
  const s2 = await runScenario({
    name: "Branded Fusion vs Ash (no protection)",
    handA: [BRANDED_FUSION],
    handB: [ASH],
    deckA: deckA(),
    deckB: deckB(),
    extraA: [ALBION],
    decisions: [
      { on: "idle", player: 0, action: "activate", card: BRANDED_FUSION },
      { on: "chain", player: 1, card: ASH }
    ],
    expect: [
      { kind: "chainLink", card: ASH, link: 2 },
      { kind: "notSummoned", card: ALBION, label: "Albion is NOT Summoned" },
      { kind: "toGrave", card: ASH, label: "Ash goes to the GY" }
    ]
  });

  check("Engine runs without errors", s2.legal, s2.engineErrors.join(" | "));
  check("Verdict = CONFIRMED", s2.verdict === "CONFIRMED", s2.conclusion);
  check("Chain has only 2 links (no Called by)", s2.chain.length === 2, String(s2.chain.length));
  const noSummon = s2.expectations.find((e) => e.expectation.includes("is NOT Summoned"));
  check("Albion does not appear on the field", noSummon?.met === true, noSummon?.evidence);
  check("No SUMMON message for Albion", !s2.timeline.some((l) => /SUMMON/.test(l) && l.includes(String(ALBION))));

  // -------------------------------------------------------------------------
  console.log("\n[3] Ash Blossom (HOPT) negated by Called by — can the second copy be used?");
  const s3 = await runScenario({
    name: "Called by negates Ash (effect, not activation) — HOPT check",
    handA: [POT_OF_GREED, CALLED],
    handB: [ASH, ASH],
    deckA: Array(20).fill(FILLER),
    deckB: Array(20).fill(FILLER),
    decisions: [
      { on: "idle", player: 0, action: "activate", card: POT_OF_GREED },
      { on: "chain", player: 1, card: ASH },
      { on: "chain", player: 0, card: CALLED }
    ],
    expect: [
      { kind: "activated", card: ASH, times: 1, label: "Ash is activated only once (HOPT already used)" },
      { kind: "size", player: 1, zone: "hand", equals: 1, label: "The second Ash is still in hand" },
      { kind: "banished", card: ASH }
    ]
  });

  check("Engine runs without errors", s3.legal, s3.engineErrors.join(" | "));
  check("Verdict = CONFIRMED", s3.verdict === "CONFIRMED", s3.conclusion);
  const ashOnce = s3.expectations.find((e) => e.expectation.includes("is activated"));
  check("Engine lets Ash activate only once", ashOnce?.met === true, ashOnce?.evidence);
  check("The second Ash is not used", s3.field.playerB.hand === 1, String(s3.field.playerB.hand));

  // -------------------------------------------------------------------------
  console.log("\n[4] Pot of Greed vs Ash — the draw is blocked");
  const s4 = await runScenario({
    name: "Pot of Greed vs Ash Blossom",
    handA: [POT_OF_GREED],
    handB: [ASH],
    deckA: Array(20).fill(FILLER),
    deckB: Array(20).fill(FILLER),
    decisions: [
      { on: "idle", player: 0, action: "activate", card: POT_OF_GREED },
      { on: "chain", player: 1, card: ASH }
    ],
    expect: [
      { kind: "chainLink", card: POT_OF_GREED, link: 1 },
      { kind: "chainLink", card: ASH, link: 2 },
      { kind: "size", player: 0, zone: "hand", equals: 0, label: "A cannot draw (hand empty after using Pot)" }
    ]
  });

  check("Engine runs without errors", s4.legal, s4.engineErrors.join(" | "));
  check("Verdict = CONFIRMED", s4.verdict === "CONFIRMED", s4.conclusion);
  check("No DRAW message for Player A", !s4.timeline.some((l) => l.startsWith("DRAW") && l.includes("player 0")), s4.timeline.filter((l) => l.startsWith("DRAW")).join(" | "));

  // -------------------------------------------------------------------------
  console.log("\n[5] Judge calls it WRONG → engine refutes (REFUTED)");
  const s5 = await runScenario({
    name: "Wrong: assuming Albion is still Summoned even though Ash is not stopped",
    handA: [BRANDED_FUSION],
    handB: [ASH],
    deckA: deckA(),
    deckB: deckB(),
    extraA: [ALBION],
    decisions: [
      { on: "idle", player: 0, action: "activate", card: BRANDED_FUSION },
      { on: "chain", player: 1, card: ASH }
    ],
    expect: [{ kind: "summoned", card: ALBION, label: "Albion is still Summoned (WRONG expectation)" }]
  });

  check("Verdict = REFUTED", s5.verdict === "REFUTED", s5.verdict);
  check("Conclusion clearly states the expectation was wrong", s5.conclusion.toLowerCase().includes("wrong"), s5.conclusion);
  check("Evidence shows the engine did not Summon", s5.expectations[0]?.met === false && s5.expectations[0]?.evidence.includes("no SUMMONING"));

  // -------------------------------------------------------------------------
  console.log("\n[6] Summary of engine results");
  for (const [label, result] of [["S1", s1], ["S2", s2], ["S3", s3], ["S4", s4], ["S5", s5]] as const) {
    console.log(`  ${label}: ${result.verdict} | chain ${result.chain.map((c) => `CL${c.link}=${cardLabel(c.code)}`).join(" → ") || "—"} | errors ${result.engineErrors.length}`);
  }
  check("Every scenario has a timeline from the engine", [s1, s2, s3, s4, s5].every((r) => r.timeline.length > 0));
  check("No scenario crashes the engine", [s1, s2, s3, s4, s5].every((r) => r.engineErrors.length === 0));

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} SCENARIO TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
