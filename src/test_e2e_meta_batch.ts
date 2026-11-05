import { DynamicMetaManager } from "./core/meta-deck-builder/dynamic-meta-sync.js";
import { generateBatchGridPrompt, sliceAndAssignArtworks } from "./core/custom-cards/batch-art-slicer.js";
import { registerCustomCard } from "./core/custom-cards/registry.js";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { detectPythonCommand } from "./utils/paths.js";

async function runE2EMetaAndBatchTests() {
  console.log("=== STARTING DYNAMIC META AND BATCH ART SLICER TESTS ===");

  // 1. Verify DynamicMetaManager
  console.log("\n[Test 1] Dynamic Meta Manager & Banlist Sync...");
  const metaManager = DynamicMetaManager.getInstance();
  const syncRes = await metaManager.syncMeta();
  console.log("Sync result:", syncRes);
  if (!syncRes.success) throw new Error("Sync meta failed");

  const liveStaples = metaManager.getLiveStaples("TCG");
  console.log(`Live TCG staples tracked: ${liveStaples.length}`);
  if (liveStaples.length < 50) throw new Error("Expected at least 50 staples");

  const potBan = metaManager.getCardBanStatus(55144522, "TCG"); // Pot of Greed
  const ashBan = metaManager.getCardBanStatus(14558127, "TCG"); // Ash Blossom
  console.log(`Pot of Greed max copies: ${potBan} (Expected: 0)`);
  console.log(`Ash Blossom max copies: ${ashBan} (Expected: 3)`);
  if (potBan !== 0 || ashBan !== 3) throw new Error("Ban status check failed");

  // 2. Verify Batch Grid Art Prompt Generator
  console.log("\n[Test 2] Batch Grid Art Prompt Generator...");
  const customCards = [
    { name: "Starlight Witch", type: "Effect Monster", attribute: "LIGHT", artDescription: "A radiant witch casting stellar magic" },
    { name: "Abyss Dragon", type: "Effect Monster", attribute: "DARK", artDescription: "A roaring shadowy dragon emerging from deep space" },
    { name: "Chrono Guardian", type: "Xyz Monster", attribute: "LIGHT", artDescription: "A mechanical warrior holding a golden pocket watch shield" },
    { name: "Solar Phoenix", type: "Synchro Monster", attribute: "FIRE", artDescription: "A blazing phoenix rising from solar flares" }
  ];

  const batchPrompt = generateBatchGridPrompt({ cards: customCards });
  console.log(`Generated Grid: ${batchPrompt.rows}x${batchPrompt.cols}`);
  console.log("Batch Prompt:\n", batchPrompt.prompt);
  if (batchPrompt.rows !== 2 || batchPrompt.cols !== 2) throw new Error("Expected 2x2 grid for 4 cards");

  // 3. Create a sample grid image (1024x1024) and slice it automatically
  console.log("\n[Test 3] Generating a sample grid image and auto-slicing each square cell...");
  const dummyGridPath = path.resolve(process.cwd(), "data", "test_batch_grid.png");
  const pythonCmd = detectPythonCommand();
  const tmpPy = path.join(os.tmpdir(), `ygo-dummy-grid-${Date.now()}.py`);
  fs.writeFileSync(
    tmpPy,
    [
      "from PIL import Image, ImageDraw",
      "img = Image.new('RGB', (1024, 1024), color=(30, 30, 30))",
      "draw = ImageDraw.Draw(img)",
      "draw.rectangle([10, 10, 502, 502], fill=(200, 50, 50))",
      "draw.rectangle([522, 10, 1014, 502], fill=(50, 100, 200))",
      "draw.rectangle([10, 522, 502, 1014], fill=(50, 180, 50))",
      "draw.rectangle([522, 522, 1014, 1014], fill=(220, 180, 40))",
      `img.save(r'${dummyGridPath.replace(/\\/g, "/")}')`
    ].join("\n"),
    "utf-8"
  );
  try {
    execFileSync(pythonCmd, [tmpPy], { stdio: "ignore" });
  } finally {
    fs.rmSync(tmpPy, { force: true });
  }

  if (!fs.existsSync(dummyGridPath)) throw new Error("Failed to create dummy grid");
  console.log("Created dummy 2x2 grid image:", dummyGridPath);

  // Register the 4 cards in the registry to obtain their tempId
  const registeredCards = customCards.map(c => registerCustomCard({
    name: c.name,
    cardData: { name: c.name, type: c.type, attribute: c.attribute, atk: 2000, def: 1500, level: 4, desc: "Sample custom card effect" }
  }));

  const manifestForSlicing = {
    rows: 2,
    cols: 2,
    cells: registeredCards.map((rc, idx) => ({
      index: idx,
      cardId: rc.tempId,
      cardName: rc.name,
      row: Math.floor(idx / 2),
      col: idx % 2
    }))
  };

  const sliceResult = await sliceAndAssignArtworks(dummyGridPath, manifestForSlicing);
  console.log("Slice result:", sliceResult);
  if (!sliceResult.success) throw new Error("Slicing failed");
  if (sliceResult.slicedImages.length !== 4) throw new Error("Expected 4 sliced artworks");
  if (sliceResult.svgCards.length !== 4) throw new Error("Expected 4 generated SVG cards");

  // Verify the SVG content embeds the base64 artwork
  const firstSvg = fs.readFileSync(sliceResult.svgCards[0], "utf-8");
  if (!firstSvg.includes("data:image/png;base64,")) throw new Error("SVG does not contain embedded base64 artwork!");
  console.log("Confirmed the SVG successfully embeds the Base64 artwork!");

  console.log("\n=== ALL TESTS PASSED 100% ===");
}

runE2EMetaAndBatchTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
