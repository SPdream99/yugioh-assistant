/**
 * E2E: script generation and automatic replacement.
 *
 * 1. A card that has no official script gets one generated from its card text.
 * 2. The generated script is verified by loading it in the real ocgcore.
 * 3. When an official script appears, the generated one is deleted and replaced.
 * 4. Cards that already have an official script are never generated.
 */

import fs from "node:fs";
import path from "node:path";
import {
  resolveCardScript,
  verifyScript,
  scriptInventory,
  listGeneratedScripts,
  upgradeGeneratedScripts,
  createScriptFromNews
} from "./core/card-scripts/script-resolver.js";
import { readCardData } from "./core/card-scripts/card-data.js";
import { generateLuaFromCardData, detectActions } from "./core/card-scripts/script-generator.js";
import { getLatestYgoNews } from "./core/news-rulings/ygorganization.js";
import { extractCardFromArticle } from "./core/news-rulings/news-card-extractor.js";
import { migrateTempId } from "./core/custom-cards/registry.js";

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

const ROOT = process.cwd();
const GENERATED = path.join(ROOT, "data", "card-scripts", "generated");

// Real cards in BabelCDB that have no upstream script.
const NO_SCRIPT_MONSTER = 97651499; // Fabled Lurrie
const NO_SCRIPT_FUSION = 99267151; // Five-Headed Dragon
const HAS_SCRIPT = 14558127; // Ash Blossom

function cleanup(passcode: number) {
  try {
    fs.rmSync(path.join(GENERATED, `c${passcode}.lua`), { force: true });
  } catch {}
  try {
    const metaPath = path.join(GENERATED, "meta.json");
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      delete meta[String(passcode)];
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    }
  } catch {}
  // Remove the temporary card from the custom registry as well.
  try {
    const registryPath = path.join(ROOT, "data", "custom_registry.json");
    if (fs.existsSync(registryPath)) {
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      const arr = Array.isArray(raw) ? raw : raw.cards || [];
      const kept = arr.filter((r: any) => Number(r.tempId) !== passcode && Number(r.officialId) !== passcode);
      fs.writeFileSync(registryPath, JSON.stringify(Array.isArray(raw) ? kept : { ...raw, cards: kept }, null, 2), "utf-8");
    }
  } catch {}
  try {
    fs.rmSync(path.join(ROOT, "data", "custom_cards", `c${passcode}.lua`), { force: true });
  } catch {}
}

async function run() {
  console.log("==================================================================");
  console.log("E2E: AUTO-GENERATED LUA + AUTO-REPLACEMENT BY OFFICIAL SCRIPT");
  console.log("==================================================================");

  console.log("\n[1] Card already has an official script → NOT generated");
  const official = await resolveCardScript(HAS_SCRIPT, { allowGenerate: true });
  check("Provenance = official", official.provenance === "official", String(official.provenance));
  check("Script has content", (official.text || "").length > 100);
  check("No generated file created", !fs.existsSync(path.join(GENERATED, `c${HAS_SCRIPT}.lua`)));
  check("Card name read from cdb", official.cardName === "Ash Blossom & Joyous Spring", official.cardName);

  console.log("\n[2] Card WITHOUT a script → auto-generated + verified");
  cleanup(NO_SCRIPT_MONSTER);
  const generated = await resolveCardScript(NO_SCRIPT_MONSTER, { allowGenerate: true });
  check("Provenance = generated", generated.provenance === "generated", String(generated.provenance));
  check("Has script", (generated.text || "").includes("AUTO-GENERATED"));
  check("Clearly states it is NOT an official script", (generated.text || "").includes("NOT AN OFFICIAL KONAMI SCRIPT"));
  check("Engine verification succeeds", generated.generated?.verified === true, JSON.stringify(generated.generated?.errors));
  check("No Lua errors", (generated.generated?.errors || []).length === 0);
  check("Actions detected", (generated.generated?.patterns || []).length > 0, JSON.stringify(generated.generated?.patterns));
  check("Has confidence", ["high", "medium", "low"].includes(generated.generated?.confidence || ""));
  check("File written to disk", fs.existsSync(path.join(GENERATED, `c${NO_SCRIPT_MONSTER}.lua`)));
  check("Has metadata", listGeneratedScripts().some((m) => m.passcode === NO_SCRIPT_MONSTER));

  console.log("\n[3] The generated script actually runs in the engine");
  const verify = await verifyScript(NO_SCRIPT_MONSTER, generated.text!);
  check("verifyScript ok", verify.ok === true, verify.errors.join(" | "));

  console.log("\n[4] A Fusion without a script can also be generated");
  cleanup(NO_SCRIPT_FUSION);
  const fusion = await resolveCardScript(NO_SCRIPT_FUSION, { allowGenerate: true });
  check("Provenance = generated", fusion.provenance === "generated", String(fusion.provenance));
  check("Engine verification succeeds", fusion.generated?.verified === true, JSON.stringify(fusion.generated?.errors));
  const fusionData = await readCardData(NO_SCRIPT_FUSION);
  check("Card data readable", Boolean(fusionData) && fusionData!.name === "Five-Headed Dragon");
  const fusionLua = generateLuaFromCardData(fusionData!);
  check("Has provenance header", fusionLua.lua.includes("AUTO-GENERATED"));
  check("At least one pattern or an explicit note", fusionLua.patterns.length > 0 || fusionLua.notes.length > 0);

  console.log("\n[5] AUTOMATICALLY replaced by the official version");
  // Simulate: a generated script exists for a card whose official script now exists.
  fs.mkdirSync(GENERATED, { recursive: true });
  const fakeGenerated = path.join(GENERATED, `c${HAS_SCRIPT}.lua`);
  fs.writeFileSync(fakeGenerated, "-- stale generated placeholder", "utf-8");
  const metaPath = path.join(GENERATED, "meta.json");
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf-8")) : {};
  meta[String(HAS_SCRIPT)] = {
    passcode: HAS_SCRIPT,
    createdAt: new Date().toISOString(),
    cardName: "Ash Blossom & Joyous Spring",
    cardTextHash: "stale",
    confidence: "low",
    patterns: [],
    notes: [],
    verified: false,
    errors: []
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  const replaced = await resolveCardScript(HAS_SCRIPT, { allowGenerate: false });
  check("Returns the official version", replaced.provenance === "official", String(replaced.provenance));
  check("Flag replacedGenerated = true", replaced.replacedGenerated === true);
  check("Generated file deleted", !fs.existsSync(fakeGenerated));
  check("Generated metadata deleted", !listGeneratedScripts().some((m) => m.passcode === HAS_SCRIPT));
  check("Returned script is the official one", (replaced.text || "").includes("Ash Blossom"));

  console.log("\n[6] upgradeGeneratedScripts scans everything");
  cleanup(NO_SCRIPT_MONSTER);
  await resolveCardScript(NO_SCRIPT_MONSTER, { allowGenerate: true, skipVerify: true });
  const upgrade = await upgradeGeneratedScripts();
  check("At least one script scanned", upgrade.checked >= 1, String(upgrade.checked));
  check("Scripts without an official version remain unchanged", upgrade.stillGenerated >= 1, String(upgrade.stillGenerated));

  console.log("\n[7] PSCT detector");
  check("draw 2 → draw:2", detectActions("Draw 2 cards.").some((a) => a.kind === "draw" && a.amount === 2));
  check("destroy → destroy", detectActions("Target 1 monster; destroy it.").some((a) => a.kind === "destroy"));
  check("banish → banish", detectActions("Banish 1 card from the GY.").some((a) => a.kind === "banish"));
  check("burn 800 → damage:800", detectActions("Inflict 800 damage to your opponent.").some((a) => a.kind === "damage" && a.amount === 800));
  check("gain 1000 → recover:1000", detectActions("Gain 1000 Life Points.").some((a) => a.kind === "recover" && a.amount === 1000));
  check("Nothing spurious detected", detectActions("This card is very cool.").length === 0);

  console.log("\n[8] Inventory");
  const inv = scriptInventory();
  check("Inventory has generated field", typeof inv.generated === "number");
  check("Inventory has officialCached", inv.officialCached > 0, String(inv.officialCached));
  check("Inventory lists entries", Array.isArray(inv.generatedEntries));

  // -------------------------------------------------------------------------
  console.log("\n[9] New card from the news → auto-generated script");
  const news = await getLatestYgoNews(12);
  check("YGOrganization RSS readable", news.length > 0, String(news.length));
  const reveal = news.find((n) => n.isCardReveal);
  check("At least one reveal article", Boolean(reveal), news.map((n) => n.title).slice(0, 3).join(" | "));

  let newsResult: any = null;
  if (reveal) {
    const extraction = await extractCardFromArticle(reveal.link);
    check("Card info extracted from the article", extraction.available === true, extraction.reason);
    check("Has card text (PSCT)", (extraction.text || "").length > 40, String(extraction.text?.length));
    check("Has image URL", extraction.images.length > 0, String(extraction.images.length));
    check("Has confidence", ["high", "medium", "low"].includes(extraction.confidence));

    newsResult = await createScriptFromNews(reveal.link, { tempId: 990000777 });
    check("Script generated from the news", newsResult.available === true, newsResult.reason);
    check("Assigns temp ID 990000777", newsResult.card?.tempId === 990000777, String(newsResult.card?.tempId));
    check("Engine verification succeeds (card not yet in cdb)", newsResult.verified === true, JSON.stringify(newsResult.errors));
    check("Script written to disk", fs.existsSync(path.join(GENERATED, "c990000777.lua")));
    const metaAfter = listGeneratedScripts().find((m) => m.passcode === 990000777);
    check("Metadata records the article source", Boolean(metaAfter?.notes.some((n) => n.includes(reveal.link))), JSON.stringify(metaAfter?.notes));
    check("Temporary card registered in the registry (can be migrated)", newsResult.registered === true, String(newsResult.registered));

    const migrated = migrateTempId(990000777, 990000778);
    check("Temp ID migration works for a card from the news", migrated.success === true, migrated.message);
  }

  // -------------------------------------------------------------------------
  console.log("\n[10] After migrating a temp ID → the generated script must not shadow the official one");
  // Simulate the post-migration state: the generated script was copied to custom_cards
  // under the real passcode (with the AUTO-GENERATED marker intact).
  const customFile = path.join(ROOT, "data", "custom_cards", `c${HAS_SCRIPT}.lua`);
  fs.writeFileSync(customFile, "-- AUTO-GENERATED SCRIPT — NOT AN OFFICIAL KONAMI SCRIPT\nlocal s,id=GetID()\n", "utf-8");
  const upgraded = await resolveCardScript(HAS_SCRIPT, { allowGenerate: false });
  check("The official version wins over the migrated auto-generated one", upgraded.provenance === "official", String(upgraded.provenance));
  check("replacedGenerated = true", upgraded.replacedGenerated === true);
  check("Auto-generated file in custom_cards deleted", !fs.existsSync(customFile));

  // A hand-written custom script (no marker) must still win.
  fs.writeFileSync(customFile, "-- Hand-written custom implementation\nlocal s,id=GetID()\nfunction s.initial_effect(c) end\n", "utf-8");
  const handWritten = await resolveCardScript(HAS_SCRIPT, { allowGenerate: false });
  check("A hand-written custom script is still preferred", handWritten.provenance === "custom", String(handWritten.provenance));
  fs.rmSync(customFile, { force: true });

  // cleanup test artefacts
  cleanup(NO_SCRIPT_MONSTER);
  cleanup(NO_SCRIPT_FUSION);
  cleanup(990000777);
  cleanup(990000778);

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} SCRIPT GENERATION TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
