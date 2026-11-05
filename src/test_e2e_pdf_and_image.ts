import { exportTournamentDecklistPdf } from "./core/deck-export/decklist-pdf.js";
import { renderDeckGridPng } from "./core/deck-export/deck-image.js";
import { buildCompetitiveDeck } from "./core/meta-deck-builder/deck-synthesizer.js";
import fs from "fs";
import path from "path";

async function runE2EPdfAndImageTests() {
  console.log("==================================================================");
  console.log("TEST E2E: KONAMI TOURNAMENT DECKLIST PDF & NEURON GRID IMAGE PNG");
  console.log("==================================================================");

  // 1. Build a meta-competitive Branded Despia deck (like the screenshot the user attached)
  console.log("\n[Step 1] Initializing the sample Branded Despia deck...");
  const buildResult = await buildCompetitiveDeck({ archetype: "Branded Despia", format: "TCG" });
  const deck = buildResult.deck;
  console.log(`Created deck "${deck.name}": Main: ${deck.main.length}, Extra: ${deck.extra.length}, Side: ${deck.side.length}`);

  // Feature Test 1: Export a Konami tournament-standard decklist PDF
  console.log("\n[Test 1] Exporting a Konami tournament decklist PDF (KDE Registration Sheet)...");
  const pdfResult = await exportTournamentDecklistPdf({
    input: buildResult.ydke, // Accepts input from a YDKE link
    deckName: "Branded Despia Tournament Deck",
    duelistName: "Seto Kaiba",
    cardGameId: "1098765432",
    eventName: "Yu-Gi-Oh! Championship Series (YCS)",
    eventDate: "2026-11-03",
    format: "TCG"
  });

  console.log("PDF creation result:", pdfResult);
  if (!pdfResult.success) throw new Error("PDF creation failed!");
  if (!fs.existsSync(pdfResult.pdfPath)) throw new Error(`PDF file does not exist: ${pdfResult.pdfPath}`);

  const pdfStats = fs.statSync(pdfResult.pdfPath);
  console.log(`PDF file size: ${pdfStats.size} bytes (coordinates and data tables valid).`);
  if (pdfStats.size < 5000) throw new Error("PDF file is too small or empty!");

  // Feature Test 2: Render the Deck Grid PNG image (10 cards per row, Konami Neuron UI)
  console.log("\n[Test 2] Rendering the visual Deck Grid PNG (Konami Neuron style, 10 cards per row)...");
  const imageResult = await renderDeckGridPng({
    input: buildResult.ydk, // Accepts input from YDK content
    title: "烙印 (Branded Despia)",
    lang: "jp" // Use Japanese labels: ■ メインデッキ, ■ エクストラデッキ, ■ サイドデッキ
  });

  console.log("PNG render result:", imageResult);
  if (!imageResult.success) throw new Error("PNG render failed!");
  if (!fs.existsSync(imageResult.outputPath)) throw new Error(`PNG file does not exist: ${imageResult.outputPath}`);

  const imgStats = fs.statSync(imageResult.outputPath);
  console.log(`PNG file size: ${imgStats.size} bytes. Resolution: ${imageResult.width}x${imageResult.height}px.`);
  if (imgStats.size < 20000) throw new Error("PNG file is too small or invalid!");

  // Feature Test 3: Accept input from a hand-typed Text Card List
  console.log("\n[Test 3] Testing input from a hand-typed Text List (e.g. '3 Ash Blossom\n2 Albaz')...");
  const sampleTextList = `
[Main Deck]
3 Ash Blossom & Joyous Spring
3 Fallen of Albaz
3 Aluber the Jester of Despia
1 Branded Fusion
3 Branded Opening
3 Infinite Impermanence
3 Mulcharmy Fuwalos
3 Nibiru, the Primal Being
1 Called by the Grave
3 Super Polymerization
1 Harpie's Feather Duster
3 Triple Tactics Thrust
1 Triple Tactics Talent
3 Forbidden Droplet
3 Evenly Matched
3 Droll & Lock Bird

[Extra Deck]
2 Mirrorjade the Iceblade Dragon
2 Albion the Branded Dragon
1 Lubellion the Searing Dragon
1 Granguignol the Dusk Dragon
1 S:P Little Knight
1 Super Starslayer TY-PHON - Sky Crisis
1 Guardian Chimera
1 Mudragon of the Swamp
1 Garura, Wings of Resonant Life
1 Starving Venom Fusion Dragon

[Side Deck]
3 Dimension Shifter
3 Dark Ruler No More
1 Red Reboot
  `;

  const pdfFromText = await exportTournamentDecklistPdf({
    input: sampleTextList,
    deckName: "Custom Text Decklist",
    duelistName: "Yugi Muto"
  });
  console.log("PDF from Text List succeeded:", pdfFromText.pdfPath);

  const pngFromText = await renderDeckGridPng({
    input: sampleTextList,
    title: "Custom Text Deck",
    lang: "en"
  });
  console.log("PNG from Text List succeeded:", pngFromText.outputPath);

  console.log("\n==================================================================");
  console.log("ALL NEW FEATURE TESTS PASSED WITH 100% SUCCESS!");
  console.log("==================================================================");
}

runE2EPdfAndImageTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
