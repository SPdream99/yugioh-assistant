import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { generateBatchGridPrompt, sliceAndAssignArtworks } from './batch-art-slicer.js';

async function runTest() {
  console.log("=== Testing Batch Card Art Grid Generator and Auto-Slicer ===");

  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 1. Create a dummy 2x2 grid image (1024x1024 with 4 colored quadrants)
  const dummyGridPath = path.resolve(dataDir, 'test_batch_grid.png').replace(/\\/g, '/');
  console.log(`Generating dummy 2x2 grid image at: ${dummyGridPath}`);

  const pythonScript = `from PIL import Image, ImageDraw; img = Image.new('RGB', (1024, 1024), (20, 20, 20)); draw = ImageDraw.Draw(img); draw.rectangle([10, 10, 502, 502], fill=(220, 40, 40)); draw.rectangle([522, 10, 1014, 502], fill=(40, 80, 220)); draw.rectangle([10, 522, 502, 1014], fill=(30, 180, 60)); draw.rectangle([522, 522, 1014, 1014], fill=(230, 170, 30)); img.save(r'${dummyGridPath}')`;

  execSync(`python -c "${pythonScript}"`);

  if (!fs.existsSync(dummyGridPath)) {
    throw new Error(`Failed to create dummy grid image at ${dummyGridPath}`);
  }
  console.log("Dummy grid image created successfully.");

  // 2. Define 4 test custom cards
  const customCards = [
    {
      id: 990001001,
      name: "Starlight Sorceress",
      type: "Effect Monster",
      attribute: "LIGHT",
      race: "Spellcaster",
      level: 7,
      atk: 2500,
      def: 2100,
      artDescription: "A radiant anime sorceress wielding a crystalline staff amid swirling galaxies"
    },
    {
      id: 990001002,
      name: "Void Abyssal Dragon",
      type: "Synchro Monster",
      attribute: "DARK",
      race: "Dragon",
      level: 8,
      atk: 3000,
      def: 2500,
      artDescription: "A colossal obsidian dragon with glowing violet rift wings roaring in deep space"
    },
    {
      id: 990001003,
      name: "Chrono Gear Golem",
      type: "Xyz Monster",
      attribute: "EARTH",
      race: "Machine",
      level: 4,
      atk: 2400,
      def: 1800,
      artDescription: "An ancient brass automaton warrior holding a massive sundial blade"
    },
    {
      id: 990001004,
      name: "Blazing Phoenix Knight",
      type: "Effect Monster",
      attribute: "FIRE",
      race: "Warrior",
      level: 5,
      atk: 2200,
      def: 1600,
      artDescription: "An armored knight with flaming wings wielding a broadsword of white-hot fire"
    }
  ];

  // 3. Test generateBatchGridPrompt
  console.log("\n[Test 1] Testing generateBatchGridPrompt...");
  const gridPromptResult = generateBatchGridPrompt({ cards: customCards });

  console.log(`Grid dimensions: ${gridPromptResult.rows}x${gridPromptResult.cols}`);
  if (gridPromptResult.rows !== 2 || gridPromptResult.cols !== 2) {
    throw new Error(`Expected 2x2 grid, got ${gridPromptResult.rows}x${gridPromptResult.cols}`);
  }

  if (!gridPromptResult.prompt.includes("Panel 1 (top-left) [Starlight Sorceress]")) {
    throw new Error("Prompt does not contain expected panel 1 description");
  }
  if (!gridPromptResult.prompt.includes("Panel 4 (bottom-right) [Blazing Phoenix Knight]")) {
    throw new Error("Prompt does not contain expected panel 4 description");
  }
  console.log("generateBatchGridPrompt passed assertions.");

  // 4. Test sliceAndAssignArtworks
  console.log("\n[Test 2] Testing sliceAndAssignArtworks...");
  const sliceResult = await sliceAndAssignArtworks(dummyGridPath, gridPromptResult.manifest);

  if (!sliceResult.success) {
    throw new Error("sliceAndAssignArtworks reported failure");
  }
  if (sliceResult.slicedImages.length !== 4) {
    throw new Error(`Expected 4 sliced artworks, got ${sliceResult.slicedImages.length}`);
  }
  if (sliceResult.svgCards.length !== 4) {
    throw new Error(`Expected 4 generated SVG cards, got ${sliceResult.svgCards.length}`);
  }

  // 5. Verify sliced image files
  for (const imgInfo of sliceResult.slicedImages) {
    if (!fs.existsSync(imgInfo.artPath)) {
      throw new Error(`Sliced artwork file not found: ${imgInfo.artPath}`);
    }
    const stats = fs.statSync(imgInfo.artPath);
    if (stats.size === 0) {
      throw new Error(`Sliced artwork file is empty: ${imgInfo.artPath}`);
    }
    console.log(`Verified sliced image for ${imgInfo.cardName} (ID: ${imgInfo.cardId}): ${imgInfo.artPath} (${stats.size} bytes)`);
  }

  // 6. Verify rendered SVG files and embedded Base64 data URLs
  for (let i = 0; i < sliceResult.svgCards.length; i++) {
    const svgPath = sliceResult.svgCards[i];
    if (!fs.existsSync(svgPath)) {
      throw new Error(`Rendered SVG file not found: ${svgPath}`);
    }
    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    if (!svgContent.includes('data:image/png;base64,')) {
      throw new Error(`SVG file at ${svgPath} does not contain embedded Base64 image data URL!`);
    }
    if (!svgContent.includes('<image href="data:image/png;base64,')) {
      throw new Error(`SVG file at ${svgPath} does not have <image href="data:image/png;base64,..." tag!`);
    }
    console.log(`Verified rendered SVG for ${customCards[i].name}: ${svgPath} (contains embedded Base64 artwork)`);
  }

  console.log("\n=== ALL BATCH ART SLICER TESTS PASSED SUCCESSFULLY ===");
}

runTest().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
