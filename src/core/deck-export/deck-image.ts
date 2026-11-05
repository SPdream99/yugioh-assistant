import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { detectPythonCommand, resolvePythonScript } from "../../utils/paths.js";
import { guardOutputPath } from "../../utils/safe-path.js";
import { loadDeckUniversal, sortDeckCards, DeckLoadOptions } from "../deck-parser/universal-deck-loader.js";

export interface DeckImageOptions extends DeckLoadOptions {
  outputPath?: string;
  title?: string;
  lang?: "jp" | "en";
}

export interface DeckImageResult {
  success: boolean;
  outputPath: string;
  width: number;
  height: number;
  mainCount: number;
  extraCount: number;
  sideCount: number;
  title: string;
}

export async function renderDeckGridPng(options: DeckImageOptions): Promise<DeckImageResult> {
  const { deck, resolved } = await loadDeckUniversal({
    input: options.input,
    name: options.title || options.name
  });

  const title = options.title || deck.name || "Yu-Gi-Oh! Deck";

  // Sort main deck cards: Monsters -> Spells -> Traps
  const sortedMain = sortDeckCards(resolved.main);
  const sortedExtra = resolved.extra;
  const sortedSide = resolved.side;

  const exportPayload = {
    title,
    main: sortedMain.map(c => ({ id: c.id, name: c.name, type: c.type, frameType: c.frameType })),
    extra: sortedExtra.map(c => ({ id: c.id, name: c.name, type: c.type, frameType: c.frameType })),
    side: sortedSide.map(c => ({ id: c.id, name: c.name, type: c.type, frameType: c.frameType }))
  };

  const exportsDir = path.resolve(process.cwd(), "data", "deck_exports");
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const safeName = title.replace(/[^a-zA-Z0-9_\-À-ɏẠ-ỹ]/g, "_");
  const timestamp = Date.now();
  const outputPngPath = options.outputPath || path.join(exportsDir, `${safeName}_grid_${timestamp}.png`);
  const guard = guardOutputPath(outputPngPath);
  if (!guard.ok) throw new Error(guard.reason || "Refusing to write outside the project directory.");
  const tempJsonPath = path.join(exportsDir, `temp_grid_${timestamp}.json`);

  fs.writeFileSync(tempJsonPath, JSON.stringify(exportPayload, null, 2), "utf-8");

  const pythonScript = resolvePythonScript("core/deck-export/render_deck_grid.py");
  const pythonCmd = detectPythonCommand();

  // execFile, not a shell: the title comes from the caller and must never be
  // interpreted as part of a command line.
  const args = [
    pythonScript,
    "--deck-json", tempJsonPath,
    "--output", guard.resolved,
    "--title", title,
    "--lang", options.lang || "jp"
  ];

  try {
    const stdout = execFileSync(pythonCmd, args, { encoding: "utf-8" });
    const parsed = JSON.parse(stdout.trim());

    if (fs.existsSync(tempJsonPath)) {
      fs.unlinkSync(tempJsonPath);
    }

    return {
      success: true,
      outputPath: guard.resolved,
      width: parsed.width,
      height: parsed.height,
      mainCount: parsed.mainCount,
      extraCount: parsed.extraCount,
      sideCount: parsed.sideCount,
      title
    };
  } catch (err: any) {
    if (fs.existsSync(tempJsonPath)) {
      fs.unlinkSync(tempJsonPath);
    }
    throw new Error(`Failed to render the deck grid image: ${err.message || String(err)}`);
  }
}
