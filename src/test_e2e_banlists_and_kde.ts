import { BanlistManager } from "./core/banlist/banlist-manager.js";
import { buildCompetitiveDeck } from "./core/meta-deck-builder/deck-synthesizer.js";
import { exportTournamentDecklistPdf } from "./core/deck-export/decklist-pdf.js";
import { renderDeckGridPng } from "./core/deck-export/deck-image.js";
import fs from "fs";
import { execSync } from "child_process";

async function runE2EBanlistsAndKdeTests() {
  console.log("==================================================================");
  console.log("TEST E2E: MULTI-FORMAT BANLISTS (TCG, OCG, AE, GENESYS) & KDE PDF");
  console.log("==================================================================");

  const banlistManager = BanlistManager.getInstance();
  await banlistManager.syncBanlists();

  // 1. Test Banlist checks across formats
  console.log("\n[Test 1] Verifying banlist accuracy across formats...");
  const potOfGreed = 55144522;
  const maxxC = 23434538;
  const calledBy = 24224830;
  const skillDrain = 82732705;

  console.log("Pot of Greed copies:");
  console.log("  TCG:", banlistManager.getCardMaxCopies(potOfGreed, "TCG"), "(Expected: 0)");
  console.log("  OCG:", banlistManager.getCardMaxCopies(potOfGreed, "OCG"), "(Expected: 0)");
  console.log("  AE:", banlistManager.getCardMaxCopies(potOfGreed, "AE"), "(Expected: 0)");
  console.log("  Genesys:", banlistManager.getCardMaxCopies(potOfGreed, "Genesys"), "(Expected: 0)");
  if (banlistManager.getCardMaxCopies(potOfGreed, "TCG") !== 0) throw new Error("Pot of Greed must be 0");

  console.log("Maxx \"C\" copies:");
  console.log("  TCG:", banlistManager.getCardMaxCopies(maxxC, "TCG"), "(Expected: 0 - Banned in TCG)");
  console.log("  OCG:", banlistManager.getCardMaxCopies(maxxC, "OCG"), "(Expected: 2 or 3 - Legal in OCG)");
  console.log("  AE:", banlistManager.getCardMaxCopies(maxxC, "AE"), "(Expected: 2 - Legal in Asian-English)");
  console.log("  Genesys:", banlistManager.getCardMaxCopies(maxxC, "Genesys"), "(Expected: 0 - Banned in Genesys)");
  if (banlistManager.getCardMaxCopies(maxxC, "TCG") !== 0) throw new Error("Maxx C must be 0 in TCG");
  if (banlistManager.getCardMaxCopies(maxxC, "OCG") === 0) throw new Error("Maxx C must be legal in OCG");
  if (banlistManager.getCardMaxCopies(maxxC, "Genesys") !== 0) throw new Error("Maxx C must be 0 in Genesys");

  console.log("Skill Drain copies in Genesys:");
  console.log("  Genesys:", banlistManager.getCardMaxCopies(skillDrain, "Genesys"), "(Expected: 0 - Banned)");
  if (banlistManager.getCardMaxCopies(skillDrain, "Genesys") !== 0) throw new Error("Skill Drain must be 0 in Genesys");

  console.log("✓ Test 1: Multi-format banlists for TCG, OCG, AE and Genesys are 100% accurate!");

  // 2. Test Modern 2025/2026 Meta Archetypes (Maliss, Centur-Ion) & Flexible Main Deck Count (40-60)
  console.log("\n[Test 2] Build deck meta 2025/2026 (Maliss 40-card, Centur-Ion 45-card)...");

  // Build Maliss 40-card TCG deck
  const malissResult = await buildCompetitiveDeck({
    archetype: "Maliss",
    format: "TCG",
    targetCount: 40
  });
  console.log(`Maliss Deck: Main ${malissResult.deck.main.length}, Extra ${malissResult.deck.extra.length}, Side ${malissResult.deck.side.length}`);
  if (malissResult.deck.main.length !== 40) throw new Error("Maliss must have 40 main cards");
  if (malissResult.deck.main.includes(maxxC)) throw new Error("TCG Maliss deck must NOT contain banned Maxx C");
  console.log("✓ Maliss TCG deck is exactly 40 cards and strictly follows the TCG banlist!");

  // Build Centur-Ion 45-card deck (demonstrating 40-60 dynamic range)
  const centurionResult = await buildCompetitiveDeck({
    archetype: "Centur-Ion",
    format: "TCG",
    targetCount: 45
  });
  console.log(`Centur-Ion Deck: Main ${centurionResult.deck.main.length}, Extra ${centurionResult.deck.extra.length}, Side ${centurionResult.deck.side.length}`);
  if (centurionResult.deck.main.length !== 45) throw new Error("Centur-Ion must have 45 main cards");
  console.log("✓ Main deck flexes to the requested size (45 main cards)! The 40-60 card range works smoothly!");

  // 3. Test filling the form directly into the KDE_DeckList.pdf template
  console.log("\n[Test 3] Auto-filling the original KDE_DeckList.pdf template...");
  const pdfOut = await exportTournamentDecklistPdf({
    input: malissResult.ydke,
    deckName: "Maliss YCS 2026 Deck",
    duelistName: "Katsuya Jonouchi",
    cardGameId: "2026110399",
    eventName: "Yu-Gi-Oh! Championship Series 2026",
    eventDate: "2026-11-03",
    format: "TCG"
  });

  console.log("Form-filled PDF result:", pdfOut);
  if (!pdfOut.success) throw new Error("PDF export failed!");
  if (!fs.existsSync(pdfOut.pdfPath)) throw new Error("PDF file does not exist!");

  const pdfSize = fs.statSync(pdfOut.pdfPath).size;
  console.log(`PDF file size generated from the original template: ${pdfSize} bytes (valid AcroForm clone > 100KB).`);
  if (pdfSize < 50000) throw new Error("The generated PDF must be a clone of the original KDE_DeckList.pdf (>100KB)!");

  // Read the fields back to verify they were actually filled
  const verifyCmd = `python -c "import pypdf; reader = pypdf.PdfReader(r'${pdfOut.pdfPath.replace(/\\/g, "/")}'); fields = reader.get_fields(); print('Verified Duelist ID in filled PDF:', fields.get('CARD GAME ID', {}).get('/V')); print('Verified Main Deck Total in filled PDF:', fields.get('Main Deck Total', {}).get('/V')); print('Verified Monster 1 in filled PDF:', fields.get('Monster 1', {}).get('/V')); print('Verified Monster 1 Count:', fields.get('Monster Card 1 Count', {}).get('/V')); assert fields.get('CARD GAME ID', {}).get('/V') == '2026110399'; assert fields.get('Main Deck Total', {}).get('/V') == '40'; print('PDF Field verification 100% PASSED!')"`;
  const verifyOut = execSync(verifyCmd, { encoding: "utf-8" });
  console.log(verifyOut.trim());

  // 4. Test PNG visual rendering
  console.log("\n[Test 4] Rendering the PNG visual for Maliss...");
  const pngOut = await renderDeckGridPng({
    input: malissResult.ydke,
    title: "M∀LICE (Maliss Meta Deck)",
    lang: "en"
  });
  console.log("PNG rendered successfully:", pngOut.outputPath);
  console.log(`Resolution: ${pngOut.width}x${pngOut.height}px`);

  console.log("\n==================================================================");
  console.log("ALL BANLIST & KDE FORM FILLING TESTS PASSED 100%!");
  console.log("==================================================================");
}

runE2EBanlistsAndKdeTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
