/**
 * E2E: deep card-script analysis.
 *
 * Verifies the insight layer on real scripts and on deliberately broken ones,
 * then checks that corpus mode aggregates a folder without inventing data.
 */

import fs from "node:fs";
import path from "node:path";
import { analyzeScriptDeep, analyzeScriptCorpus } from "./core/card-scripts/script-insights.js";
import { resolveCardScript } from "./core/card-scripts/script-resolver.js";

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

const ASH = 14558127;

const BROKEN = `
local s,id=GetID()
function s.initial_effect(c)
  local e1=Effect.CreateEffect(c)
  e1:SetType(EFFECT_TYPE_ACTIVATE)
  e1:SetCode(EVENT_FREE_CHAIN)
  e1:SetRange(LOCATION_GY)
  e1:SetTarget(s.target)
  c:RegisterEffect(e1)
  Fusion.AddProcMix(c,true,true,123,456)
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return true end
end
-- TODO: finish this script
`;

const STATIC_SCRIPT = `
local s,id=GetID()
function s.initial_effect(c)
  local e1=Effect.CreateEffect(c)
  e1:SetType(EFFECT_TYPE_SINGLE)
  e1:SetCode(EFFECT_SPSUMMON_CONDITION)
  c:RegisterEffect(e1)
end
`;

async function run() {
  console.log("==================================================================");
  console.log("E2E: DEEP CARD-SCRIPT INSIGHTS");
  console.log("==================================================================");

  console.log("\n[1] Real script: Ash Blossom");
  const ash = await resolveCardScript(ASH, { allowGenerate: false });
  check("Official script found", ash.provenance === "official", ash.reason);
  const insight = analyzeScriptDeep(ash.text!, ASH);
  check("Parsed", insight.parsed === true, insight.parseError);
  check("Exactly one effect", insight.effects.length === 1, String(insight.effects.length));
  const e = insight.effects[0];
  check("Classified as quick effect", e.kind === "quick", e.kind);
  check("Trigger event is EVENT_CHAINING", (e.triggerEvent || "").includes("EVENT_CHAINING"), e.triggerEvent);
  check("Cost is a discard", e.costKinds.includes("discard"), JSON.stringify(e.costKinds));
  check("Hard once per turn", e.countLimit === "hard", e.countLimit);
  check("Spell Speed 2", e.spellSpeed === 2, String(e.spellSpeed));
  check("Category CATEGORY_DISABLE", e.categories.includes("CATEGORY_DISABLE"), JSON.stringify(e.categories));
  check("Has cost, target and operation", e.quartet.cost && e.quartet.target && e.quartet.operation, JSON.stringify(e.quartet));
  check("Does not target", e.targets === false);
  check("No structural risks", insight.risks.length === 0, JSON.stringify(insight.risks));
  check("Complexity measured", insight.complexity.lines > 10 && insight.complexity.branches > 0, JSON.stringify(insight.complexity));
  check("Summary mentions the effect kind", /quick/.test(insight.summary), insight.summary);

  console.log("\n[2] Deliberately broken script");
  const broken = analyzeScriptDeep(BROKEN, 1);
  const codes = broken.risks.map((r) => r.code);
  check("Detects invalid LOCATION_GY", codes.includes("invalid-location-gy"), JSON.stringify(codes));
  check("Detects target without operation", codes.includes("target-without-operation"), JSON.stringify(codes));
  check("Detects missing LoadScript", codes.includes("missing-load-script"), JSON.stringify(codes));
  check("Detects skeleton/TODO", codes.includes("skeleton"), JSON.stringify(codes));
  check("Severity is assigned", broken.risks.every((r) => ["error", "warning", "info"].includes(r.severity)));
  check("Errors are marked as errors", broken.risks.find((r) => r.code === "invalid-location-gy")?.severity === "error");

  console.log("\n[3] Static ability classification");
  const staticInsight = analyzeScriptDeep(STATIC_SCRIPT, 2);
  check("Static effect recognised", staticInsight.effects[0]?.kind === "static", staticInsight.effects[0]?.kind);

  console.log("\n[4] Corpus mode over the cached official scripts");
  const dir = path.join(process.cwd(), "data", "ocgcore-scripts", "official");
  // Seed a deterministic minimum so the corpus assertions do not depend on
  // which suites ran earlier in the process.
  const seeds = [14558127, 24224830, 44362883, 97268402, 68468459, 87746184];
  for (const id of seeds) {
    try {
      await resolveCardScript(id);
    } catch {
      // A missing script must not fail the corpus test on its own.
    }
  }
  check("Script folder exists", fs.existsSync(dir), dir);
  const files = fs.readdirSync(dir).filter((f) => /^c\d+\.lua$/.test(f));
  check("At least 6 scripts cached", files.length >= 6, String(files.length));

  const corpus = analyzeScriptCorpus(
    files.map((file) => ({
      passcode: Number(file.match(/^c(\d+)\.lua$/)![1]),
      lua: fs.readFileSync(path.join(dir, file), "utf-8")
    }))
  );

  check("Corpus counted", corpus.scripts === files.length, `${corpus.scripts}/${files.length}`);
  check("All scripts parsed", corpus.failed === 0, String(corpus.failed));
  check("Effect-kind distribution present", corpus.effectKinds.length >= 3, JSON.stringify(corpus.effectKinds.map((k) => k.kind)));
  check("Average effects is plausible", corpus.averageEffects > 0 && corpus.averageEffects < 20, String(corpus.averageEffects));
  check("Trigger events aggregated", corpus.triggers.length > 0, JSON.stringify(corpus.triggers.slice(0, 3)));
  check("Count-limit mix recorded", corpus.countLimits.hard + corpus.countLimits.soft + corpus.countLimits.none > 0, JSON.stringify(corpus.countLimits));
  check("Risk list is an array", Array.isArray(corpus.risks));
  check("Top APIs aggregated", corpus.topApis.length > 0, JSON.stringify(corpus.topApis.slice(0, 3)));
  check("No invented scripts", corpus.scripts <= corpus.parsed + corpus.failed);

  console.log("\n[5] Honest behaviour on unparseable input");
  const bad = analyzeScriptDeep("this is not lua {{{", 3);
  check("Parse failure reported", bad.parsed === false && typeof bad.parseError === "string");
  check("No fake effects", bad.effects.length === 0);

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} SCRIPT INSIGHT TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
