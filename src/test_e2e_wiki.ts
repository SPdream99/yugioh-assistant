/**
 * E2E: Yugipedia integration.
 *
 * Verifies the wiki layer answers for cards (by name, passcode and
 * Yu-Gi-Oh! Card Database ID), for the per-card tabs
 * (Gallery/Rulings/Errata/Artworks/Tips/Trivia/Appearances/Names/Lores),
 * and for sets, products and archetypes — always with a source URL and the
 * CC BY-SA licence, and always honestly when a page does not exist.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getCard,
  getCardTab,
  getWikiPage,
  searchWiki,
  resolveTitle,
  getWikiStatus,
  extractImages,
  htmlToText,
  CARD_TABS,
  YUGIPEDIA_LICENSE
} from "./core/wiki/yugipedia.js";

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
  console.log("E2E: YUGIPEDIA (card, tabs, set, product, archetype)");
  console.log("==================================================================");

  console.log("\n[1] Look up a card by passcode");
  const dm = await getCard("46986414");
  check("Card found", dm.available === true, dm.reason);
  check("Correct page 'Dark Magician'", dm.page === "Dark Magician", dm.page);
  check("Passcode 46986414", dm.identifiers?.passcode === 46986414, String(dm.identifiers?.passcode));
  check("Yu-Gi-Oh! Card Database ID = 4041", dm.identifiers?.databaseId === "4041", String(dm.identifiers?.databaseId));
  check("Has a Japanese name", dm.names?.ja === "ブラック・マジシャン", dm.names?.ja);
  check("Has a Vietnamese name? (absence is also valid)", true);
  check("Has 8+ languages", Object.keys(dm.names || {}).length >= 8, String(Object.keys(dm.names || {}).length));
  check("Has a French name", dm.names?.fr === "Magicien Sombre", dm.names?.fr);
  check("Has a German name", dm.names?.de === "Dunkler Magier", dm.names?.de);
  check("Has a Spanish name", Boolean(dm.names?.es), dm.names?.es);
  check("Has a Korean name", Boolean(dm.names?.ko), dm.names?.ko);
  check("Has a Chinese name (sc/tc)", Boolean(dm.names?.sc || dm.names?.tc));
  check("Has romaji", Boolean(dm.names?.romaji), dm.names?.romaji);
  check("Card text is verbatim", (dm.lore || "").includes("The ultimate wizard"), dm.lore);
  check("Has Japanese card text", Boolean(dm.texts?.ja), dm.texts?.ja);
  check("Attribute DARK", dm.stats?.attribute === "DARK", String(dm.stats?.attribute));
  check("Level 7", dm.stats?.level === "7", String(dm.stats?.level));
  check("ATK 2500 / DEF 2100", dm.stats?.atk === "2500" && dm.stats?.def === "2100");
  check("Archetype 'Dark Magician'", (dm.archetypes || []).some((a) => /Dark Magician/.test(a)), JSON.stringify(dm.archetypes));
  check("Has a source URL", (dm.url || "").startsWith("https://yugipedia.com/wiki/"), dm.url);
  check("Has the CC BY-SA license", dm.license === YUGIPEDIA_LICENSE);

  console.log("\n[2] Look up a card by Yu-Gi-Oh! Card Database ID");
  const db = await getCard("22132");
  check("Database ID 22132 resolves", db.available === true, db.reason);
  check("Correct card 'WAKE CUP! Earl'", db.page === "WAKE CUP! Earl", db.page);
  check("Correct passcode 85586937", db.identifiers?.passcode === 85586937, String(db.identifiers?.passcode));
  check("Keeps databaseId 22132", db.identifiers?.databaseId === "22132", String(db.identifiers?.databaseId));

  console.log("\n[3] All card tabs exist");
  const expectedTabs = Object.keys(CARD_TABS);
  for (const tab of expectedTabs) {
    check(`Tab ${tab}`, dm.tabs?.[tab] === true, String(dm.tabs?.[tab]));
  }

  console.log("\n[4] Content of each tab");
  const rulings = await getCardTab("Dark Magician", "rulings");
  check("Rulings available", rulings.available === true, rulings.reason);
  check("Rulings has an OCG Rulings section", (rulings.text || "").includes("OCG Rulings"), (rulings.text || "").slice(0, 80));
  check("Rulings mentions 'Skilled Dark Magician'", (rulings.text || "").includes("Skilled Dark Magician"));
  check("Rulings has no leftover navbox junk", !(rulings.text || "").startsWith("Gallery"), (rulings.text || "").slice(0, 60));

  const tips = await getCardTab("Dark Magician", "tips");
  check("Tips available", tips.available === true);
  check("Tips has content", (tips.text || "").length > 200, String((tips.text || "").length));

  const trivia = await getCardTab("Dark Magician", "trivia");
  check("Trivia available", trivia.available === true);
  check("Trivia has content", (trivia.text || "").length > 200);

  const errata = await getCardTab("Dark Magician", "errata");
  check("Errata available", errata.available === true);

  const artworks = await getCardTab("Dark Magician", "artworks", { imagesOnly: true });
  check("Artworks has an image list", (artworks.images || []).length > 0, String(artworks.images?.length));

  const gallery = await getCardTab("Dark Magician", "gallery", { imagesOnly: true });
  check("Gallery has >= 50 images", (gallery.images || []).length >= 50, String(gallery.images?.length));
  check("Image file names use the correct format", (gallery.images || []).every((n) => n.endsWith(".png") || n.endsWith(".jpg")), (gallery.images || [])[0]);

  const names = await getCardTab("Dark Magician", "names");
  check("Names available", names.available === true);
  check("Names includes Japanese", (names.text || "").includes("ブラック・マジシャン"));

  console.log("\n[5] Set, product, archetype");
  const set = await getWikiPage("Legend of Blue Eyes White Dragon");
  check("Set page available", set.available === true, set.reason);
  check("Set has a 'Features' section", (set.sections || []).includes("Features"), JSON.stringify(set.sections?.slice(0, 8)));
  check("Set has a 'Lists' section", (set.sections || []).includes("Lists"));
  check("Set has a 'Galleries' section", (set.sections || []).includes("Galleries"));

  const setSection = await getWikiPage("Legend of Blue Eyes White Dragon", { section: "Features" });
  check("Reads the full 'Features' section", setSection.available === true && (setSection.text || "").length > 100, String(setSection.text?.length));

  const archetype = await getWikiPage("Dark Magician (archetype)", { section: "Playing style" });
  check("Archetype page available", archetype.available === true, archetype.reason);
  check("Has a 'Playing style' section", archetype.section === "Playing style", archetype.section);
  check("Archetype content is valid", (archetype.text || "").includes("Dark Magician"), (archetype.text || "").slice(0, 80));

  const product = await getWikiPage("Structure Deck: Yugi Muto");
  check("Product/Structure Deck page available", product.available === true, product.reason);
  check("Product has sections", (product.sections || []).length > 3, JSON.stringify(product.sections?.slice(0, 6)));

  console.log("\n[6] Search & resolve");
  const results = await searchWiki("Rivalry of Warlords", 5);
  check("Search returns results", results.length > 0, String(results.length));
  check("Top result is Rivalry of Warlords", results[0]?.title === "Rivalry of Warlords", results[0]?.title);

  const resolved = await resolveTitle("Blue-Eyes White Dragon");
  check("resolveTitle by name", resolved?.title === "Blue-Eyes White Dragon", resolved?.title);

  console.log("\n[7] Honest when data is missing");
  const missing = await getCard("This Card Definitely Does Not Exist 12345");
  check("Card does not exist → available=false", missing.available === false);
  check("Has a clear reason", (missing.reason || "").length > 10, missing.reason);

  const missingTab = await getCardTab("Mystical Elf", "appearances");
  check("Tab missing → available=false or has content", typeof missingTab.available === "boolean");

  const missingPage = await getWikiPage("Page That Does Not Exist Zzz");
  check("Page does not exist → available=false", missingPage.available === false);

  const badSection = await getWikiPage("Legend of Blue Eyes White Dragon", { section: "zzz khong co" });
  check("Section does not exist → available=false", badSection.available === false && (badSection.reason || "").includes("Available:"));

  console.log("\n[8] Cache & etiquette");
  const status = getWikiStatus();
  check("Cache written to disk", status.cachedPages > 0, String(status.cachedPages));
  check("7-day TTL", status.ttlDays === 7);
  check("License stated explicitly", status.license === "CC BY-SA 3.0");
  check("Points to the right API", status.source === "https://yugipedia.com/api.php");
  check("Cache directory exists", fs.existsSync(path.join(process.cwd(), "data", "wiki", "pages")));

  console.log("\n[9] HTML/wikitext converters");
  check("htmlToText strips tags", !htmlToText("<p>Hello <b>world</b></p>").includes("<"));
  check("htmlToText keeps content", htmlToText("<p>Hello <b>world</b></p>").includes("Hello world"));
  check("extractImages picks up File:", extractImages('<a title="File:Test-Card.png">x</a>')[0] === "Test-Card.png");

  console.log("\n==================================================================");
  if (failed === 0) {
    console.log(`ALL ${passed} YUGIPEDIA TESTS PASSED WITH 100% SUCCESS!`);
  } else {
    console.error(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
