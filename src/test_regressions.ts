/**
 * Regression suite for the deck-intelligence P0/P1 fixes.
 *
 * Each check pins a defect that used to fail silently:
 *   1. builder: every template must produce a legal deck, with no Extra Deck
 *      monster in the Main Deck and no forbidden cards;
 *   2. builder: an unknown archetype must say so, never substitute Tenpai;
 *   3. legality: forbidden / limited cards and misplaced Extra monsters are errors;
 *   4. runtime: two seeds must deal different opening hands, one seed must replay;
 *   5. lock detector: real scripts (anonymous functions, Is*Monster, lizard check);
 *   6. board DSL: synchro/xyz/link/fusion/ritual + accept/decline/attack;
 *   7. consistency lab: refuses >200 trials and separates the two rates;
 *   8. loader: a .ydk path resolves to 40 cards (not 0).
 *   9. policy: the MCP server advertises tool-first instructions and the
 *      fact-bearing tools forbid answering from memory;
 *  10. media: a rendered artifact travels as a real MCP image block, with the
 *      path kept in the text and missing/oversized files degrading loudly.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCompetitiveDeck } from "./core/meta-deck-builder/deck-synthesizer.js";
import { META_TEMPLATES } from "./core/meta-deck-builder/meta-templates.js";
import { checkDeckLegality, isExtraDeckType, resolveCardType } from "./core/deck-parser/legality.js";
import { loadDeckUniversal } from "./core/deck-parser/universal-deck-loader.js";
import { runOcgCoreDuel } from "./core/card-scripts/ocgcore-runtime.js";
import { detectLocks } from "./core/card-scripts/lock-detector.js";
import { parseBoard } from "./core/card-scripts/board-dsl.js";
import { measureConsistency } from "./core/deck-consistency/lab.js";
import { TOOLS } from "./tools/index.js";
import { TOOL_FIRST_INSTRUCTIONS, TOOL_FIRST_MARK } from "./server-instructions.js";
import { attachMedia, stripMedia, toMcpContent, MCP_MEDIA_KEY } from "./mcp-media.js";

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

const DROLL = 94145021; // Limited to 1 in TCG
const ELFNOTE_TINIA = 59581480; // Forbidden in TCG
const JUNE_PRIDE = 5559570; // Synchro monster

async function run() {
  console.log("==================================================================");
  console.log("REGRESSION: DECK INTELLIGENCE P0/P1");
  console.log("==================================================================");

  console.log("\n[1] Every template builds a legal deck");
  for (const archetype of Object.keys(META_TEMPLATES)) {
    const built = await buildCompetitiveDeck({ archetype, format: "TCG" });
    check(`${archetype}: built`, built.available !== false, built.reason);
    if (built.available === false) continue;

    const legality = await checkDeckLegality(built.deck, "TCG");
    check(`${archetype}: legal`, legality.valid, legality.errors.join("; "));

    let extraInMain = false;
    let forbidden = false;
    for (const entry of built.deck.main) {
      const id = typeof entry === "number" ? entry : Number((entry as any).id);
      const data = await resolveCardType(id);
      if (data.known && isExtraDeckType(data.type)) extraInMain = true;
      if (legality.banlist[id] === 0) forbidden = true;
    }
    check(`${archetype}: no Extra monster in Main`, !extraInMain);
    check(`${archetype}: no forbidden card`, !forbidden);
  }

  console.log("\n[2] Unknown archetypes are refused, not substituted");
  const unknown = await buildCompetitiveDeck({ archetype: "Artmage", format: "TCG" });
  check("Artmage: available=false", unknown.available === false);
  check("Artmage: reason names the archetype", /Artmage/.test(unknown.reason || ""), unknown.reason);
  check("Artmage: lists alternatives", (unknown.availableArchetypes || []).length >= 10);
  check("Artmage: does not return Tenpai", !/Tenpai/i.test(unknown.deck.name || ""), unknown.deck.name);
  check("Artmage: returns an empty deck", unknown.deck.main.length === 0);

  console.log("\n[3] Legality catches banlist and zone errors");
  const badDeck = {
    name: "bad",
    main: [JUNE_PRIDE, DROLL, DROLL, DROLL],
    extra: [] as number[],
    side: [] as number[]
  };
  const bad = await checkDeckLegality(badDeck as any, "TCG");
  check("legality: invalid", bad.valid === false);
  check("legality: limited card caught", bad.errors.some((e) => /banlist limit/.test(e)), bad.errors.join("; "));
  check("legality: Extra monster in Main caught", bad.errors.some((e) => /Extra Deck monster in Main/.test(e)), bad.errors.join("; "));
  check("legality: forbidden card caught", (await checkDeckLegality({ name: "x", main: [ELFNOTE_TINIA], extra: [], side: [] } as any, "TCG")).errors.some((e) => /banlist limit of 0/.test(e)));

  console.log("\n[4] Seeded shuffle changes opening hands");
  const pool = [69247929, 91152256, 14898066, 13039848, 69247929, 91152256, 14898066, 13039848, 69247929, 91152256, 14898066, 13039848, 69247929, 91152256, 14898066, 13039848, 69247929, 91152256, 14898066, 13039848];
  const openingHand = (result: any): string =>
    result.timeline.find((line: string) => /DRAW: player 0/.test(line)) ?? "";

  const duelSeedA = await runOcgCoreDuel({ deckA: pool, deckB: pool, maxSteps: 20, startingDrawCount: 5, drawCountPerTurn: 0, seed: [1n, 2n, 3n, 4n] });
  const duelSeedB = await runOcgCoreDuel({ deckA: pool, deckB: pool, maxSteps: 20, startingDrawCount: 5, drawCountPerTurn: 0, seed: [99n, 98n, 97n, 96n] });
  const duelSeedAReplay = await runOcgCoreDuel({ deckA: pool, deckB: pool, maxSteps: 20, startingDrawCount: 5, drawCountPerTurn: 0, seed: [1n, 2n, 3n, 4n] });

  check("shuffle: seed 1 dealt a hand", openingHand(duelSeedA).length > 0, openingHand(duelSeedA));
  check("shuffle: two seeds deal different hands", openingHand(duelSeedA) !== openingHand(duelSeedB), `${openingHand(duelSeedA)} vs ${openingHand(duelSeedB)}`);
  check("shuffle: same seed replays exactly", openingHand(duelSeedA) === openingHand(duelSeedAReplay));

  console.log("\n[5] Lock detector reads real scripts");
  const powerPatron = path.join("data", "ocgcore-scripts", "official", "c12375297.lua");
  if (fs.existsSync(powerPatron)) {
    const locks = detectLocks(fs.readFileSync(powerPatron, "utf-8"));
    check("lock: Elfnote Power Patron detected", locks.length > 0, JSON.stringify(locks));
    check("lock: says Synchro Monsters only", locks.some((l) => /Synchro Monsters only/.test(l.detail)), JSON.stringify(locks));
    check("lock: no useless 'restricts actions'", !locks.some((l) => l.detail === "restricts actions"), JSON.stringify(locks));
  } else {
    console.log("  · skipped (official script cache not present)");
  }

  console.log("\n[6] Board DSL understands modern verbs");
  const board = [
    "A hand: Medius the Pure",
    "A extra: Accel Synchro Stardust Dragon",
    'A: normal summon "Medius the Pure"',
    "A: accept",
    'A: synchro summon "Accel Synchro Stardust Dragon"',
    "B: decline",
    'A: attack with "Accel Synchro Stardust Dragon"'
  ].join("\n");
  const parsed = parseBoard(board);
  check("dsl: parses without errors", parsed.available === true, parsed.errors.join("; "));
  const decisions = parsed.spec?.decisions || [];
  check("dsl: normal summon mapped", decisions.some((d) => d.action === "summon"));
  check("dsl: synchro mapped to special summon", decisions.some((d) => d.action === "spsummon" && /Accel Synchro/.test(String((d as any).card))));
  check("dsl: accept mapped to yes", decisions.some((d) => d.on === "yes" && d.yes === true));
  check("dsl: decline mapped to no", decisions.some((d) => d.on === "yes" && d.yes === false));
  const attack = decisions.find((d) => d.on === "battle") as any;
  check("dsl: attack keeps only the card", attack?.card === "Accel Synchro Stardust Dragon", JSON.stringify(attack));

  console.log("\n[7] Consistency lab is honest");
  const tooMany = await measureConsistency({ main: Array(40).fill(69247929), trials: 300 });
  check("lab: refuses >200 trials", tooMany.available === false && /cap is 200/.test(tooMany.reason || ""), tooMany.reason);
  const lab = await measureConsistency({ main: Array(40).fill(69247929), trials: 1, maxSteps: 20 });
  check("lab: reports anyActionRate", typeof lab.anyActionRate === "number");
  check("lab: reports engineBoardRate separately", typeof lab.engineBoardRate === "number" && "extraDeckRate" in lab);
  check("lab: requestedTrials recorded", lab.requestedTrials === 1);

  console.log("\n[8] Universal loader reads a .ydk path");
  const ydkPath = path.join("data", "decks", "elfnote-2026-tcg.ydk");
  if (fs.existsSync(ydkPath)) {
    const loaded = await loadDeckUniversal({ input: ydkPath });
    check("loader: reads the path", loaded.deck.main.length >= 40, String(loaded.deck.main.length));
    const legality = await checkDeckLegality(loaded.deck, "TCG");
    check("loader: deck is legal", legality.valid, legality.errors.join("; "));
  } else {
    console.log("  · skipped (data/decks/elfnote-2026-tcg.ydk not present)");
  }

  console.log("\n[9] Tool-first policy is advertised to clients");
  check("instructions: present", TOOL_FIRST_INSTRUCTIONS.length > 500, String(TOOL_FIRST_INSTRUCTIONS.length));
  check("instructions: bans memory", /from memory/i.test(TOOL_FIRST_INSTRUCTIONS));
  check(
    "instructions: covers thinking",
    /reasoning\/thinking/i.test(TOOL_FIRST_INSTRUCTIONS),
    TOOL_FIRST_INSTRUCTIONS.slice(0, 120)
  );
  check("instructions: names the deck builder", /ygo_build_meta_deck/.test(TOOL_FIRST_INSTRUCTIONS));
  check("instructions: names the legality gate", /ygo_check_legality/.test(TOOL_FIRST_INSTRUCTIONS));

  const MUST_SAY_TOOL_FIRST = [
    "ygo_parse_deck",
    "ygo_check_legality",
    "ygo_get_card",
    "ygo_search_cards",
    "ygo_find_synergy_and_combos",
    "ygo_optimize_deck",
    "ygo_judge_card",
    "ygo_verify_ruling",
    "ygo_get_monthly_meta",
    "ygo_card_dossier"
  ];
  for (const name of MUST_SAY_TOOL_FIRST) {
    const tool = TOOLS.find((t) => t.name === name);
    check(`${name}: registered`, Boolean(tool));
    check(`${name}: forbids memory`, Boolean(tool && tool.description.includes(TOOL_FIRST_MARK)), tool?.description);
  }

  const builder = TOOLS.find((t) => t.name === "ygo_build_meta_deck");
  check("ygo_build_meta_deck: trigger documented", /whenever the user asks you to build/i.test(builder?.description || ""));
  check("ygo_build_meta_deck: bans memory lists", /Never output a decklist from memory/i.test(builder?.description || ""));

  console.log("\n[10] Rendered artifacts reach the client as image content");
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "ygo-media-"));
  const pngPath = path.join(mediaDir, "deck.png");
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
  fs.writeFileSync(pngPath, pngBytes);

  const payload = attachMedia({ success: true, outputPath: pngPath }, [
    { type: "image", path: pngPath, mimeType: "image/png" }
  ]);
  check("media: descriptor rides on the result", Array.isArray((payload as any)[MCP_MEDIA_KEY]));

  const content = toMcpContent(payload);
  check("media: one image block", content.blocks.length === 1, String(content.blocks.length));
  check("media: block type is image", content.blocks[0]?.type === "image");
  check("media: mime type preserved", content.blocks[0]?.mimeType === "image/png");
  check("media: bytes round-trip", Buffer.from(content.blocks[0]?.data || "", "base64").equals(pngBytes));
  check("media: text keeps the absolute path", content.text.includes(JSON.stringify(pngPath).slice(1, -1)), content.text.slice(0, 200));
  check("media: text hides the descriptor", !content.text.includes(MCP_MEDIA_KEY));
  check("media: stripMedia removes the key", !(MCP_MEDIA_KEY in (stripMedia(payload) as object)));

  const missing = toMcpContent(
    attachMedia({ success: true }, [{ type: "image", path: path.join(mediaDir, "nope.png"), mimeType: "image/png" }])
  );
  check("media: missing file yields no block", missing.blocks.length === 0);
  check("media: missing file is reported", /artifact missing/i.test(missing.text), missing.text);

  const oversizedPath = path.join(mediaDir, "huge.png");
  fs.writeFileSync(oversizedPath, Buffer.alloc(9 * 1024 * 1024));
  const oversized = toMcpContent(
    attachMedia({ success: true }, [{ type: "image", path: oversizedPath, mimeType: "image/png" }])
  );
  check("media: oversized file is not inlined", oversized.blocks.length === 0);
  check("media: oversized file keeps the path", oversized.text.includes(oversizedPath) && /too large/i.test(oversized.text));

  fs.rmSync(mediaDir, { recursive: true, force: true });
  const renderTool = TOOLS.find((t) => t.name === "ygo_render_deck_image");
  check("ygo_render_deck_image: promises the image block", /attached to this tool's result/i.test(renderTool?.description || ""));

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} REGRESSION TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
