import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { resolvePythonScript, detectPythonCommand } from "../../utils/paths.js";
import { guardOutputPath } from "../../utils/safe-path.js";
import { ensureKdeTemplate } from "./kde-template.js";
import { loadDeckUniversal, DeckLoadOptions } from "../deck-parser/universal-deck-loader.js";
import { Card } from "../../types/card.js";

export interface DecklistPdfOptions extends DeckLoadOptions {
  outputPath?: string;
  duelistName?: string;
  /** First and middle name(s) as printed on the form. Overrides the auto-split of duelistName. */
  firstName?: string;
  /** Family name as printed on the form. Overrides the auto-split of duelistName. */
  lastName?: string;
  /** Country of residency (default: Vietnam). */
  country?: string;
  cardGameId?: string;
  eventName?: string;
  eventDate?: string;
  deckName?: string;
  format?: "TCG" | "OCG" | "AE" | "Genesys" | "Master Duel";
}

export interface DecklistPdfResult {
  success: boolean;
  pdfPath: string;
  totalMain: number;
  totalMonsters: number;
  totalSpells: number;
  totalTraps: number;
  totalExtra: number;
  totalSide: number;
  deckName: string;
}

interface GroupedCardEntry {
  count: number;
  name: string;
  passcode: number;
  type: string;
}

export async function exportTournamentDecklistPdf(options: DecklistPdfOptions): Promise<DecklistPdfResult> {
  const { deck, resolved } = await loadDeckUniversal({
    input: options.input,
    name: options.deckName || options.name
  });

  const deckName = options.deckName || deck.name || "Yu-Gi-Oh! Tournament Deck";

  // Group by card frequency
  const groupCards = (cards: Card[]): GroupedCardEntry[] => {
    const map = new Map<string, GroupedCardEntry>();
    for (const card of cards) {
      const key = card.name || String(card.id);
      if (map.has(key)) {
        map.get(key)!.count += 1;
      } else {
        map.set(key, {
          count: 1,
          name: card.name,
          passcode: card.id,
          type: card.type || "Monster"
        });
      }
    }
    return Array.from(map.values());
  };

  const mainGrouped = groupCards(resolved.main);
  const extraGrouped = groupCards(resolved.extra);
  const sideGrouped = groupCards(resolved.side);

  // Categorize Main Deck into Monsters, Spells, Traps
  const monsters: GroupedCardEntry[] = [];
  const spells: GroupedCardEntry[] = [];
  const traps: GroupedCardEntry[] = [];

  for (const entry of mainGrouped) {
    const typeLower = entry.type.toLowerCase();
    if (typeLower.includes("spell")) {
      spells.push(entry);
    } else if (typeLower.includes("trap")) {
      traps.push(entry);
    } else {
      monsters.push(entry);
    }
  }

  // Sort each section alphabetically for judge legibility
  monsters.sort((a, b) => a.name.localeCompare(b.name));
  spells.sort((a, b) => a.name.localeCompare(b.name));
  traps.sort((a, b) => a.name.localeCompare(b.name));
  extraGrouped.sort((a, b) => a.name.localeCompare(b.name));
  sideGrouped.sort((a, b) => a.name.localeCompare(b.name));

  const categorizedDeck = {
    deckName,
    monsters,
    spells,
    traps,
    extra: extraGrouped,
    side: sideGrouped
  };

  // Determine output directory
  const exportsDir = path.resolve(process.cwd(), "data", "deck_exports");
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const safeName = deckName.replace(/[^a-zA-Z0-9_\-À-ɏẠ-ỹ]/g, "_");
  const timestamp = Date.now();
  const outputPdfPath = options.outputPath || path.join(exportsDir, `${safeName}_decklist_${timestamp}.pdf`);
  const guard = guardOutputPath(outputPdfPath);
  if (!guard.ok) throw new Error(guard.reason || "Refusing to write outside the project directory.");
  const tempJsonPath = path.join(exportsDir, `temp_deck_${timestamp}.json`);

  fs.writeFileSync(tempJsonPath, JSON.stringify(categorizedDeck, null, 2), "utf-8");

  const pythonScript = resolvePythonScript("core/deck-export/fill_kde_decklist_pdf.py");
  const template = await ensureKdeTemplate();
  const pythonCmd = detectPythonCommand();

  // execFileSync (not execSync) so spaces, quotes and Vietnamese characters in
  // the duelist/event names reach Python as real arguments instead of being
  // parsed by the shell.
  const pythonArgs = [
    pythonScript,
    "--deck-json", tempJsonPath,
    "--output", guard.resolved,
    "--template", template.path,
    "--duelist-name", options.duelistName || "Duelist",
    "--first-name", options.firstName || "",
    "--last-name", options.lastName || "",
    "--card-game-id", options.cardGameId || "",
    "--event-name", options.eventName || "Regional Qualifier / YCS",
    "--deck-name", deckName,
    "--event-date", options.eventDate || new Date().toISOString().slice(0, 10),
    "--country", options.country || "Vietnam",
  ];

  try {
    const stdout = execFileSync(pythonCmd, pythonArgs, { encoding: "utf-8" });
    const parsed = JSON.parse(stdout.trim());

    // Cleanup temp JSON
    if (fs.existsSync(tempJsonPath)) {
      fs.unlinkSync(tempJsonPath);
    }

    return {
      success: true,
      pdfPath: guard.resolved,
      totalMain: parsed.totalMain,
      totalMonsters: parsed.totalMonsters,
      totalSpells: parsed.totalSpells,
      totalTraps: parsed.totalTraps,
      totalExtra: parsed.totalExtra,
      totalSide: parsed.totalSide,
      deckName
    };
  } catch (err: any) {
    if (fs.existsSync(tempJsonPath)) {
      fs.unlinkSync(tempJsonPath);
    }
    throw new Error(`Failed to create the decklist PDF: ${err.message || String(err)}`);
  }
}
