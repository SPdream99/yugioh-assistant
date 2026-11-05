import fs from "fs";
import path from "path";
import { DeckData, ResolvedDeck } from "../../types/deck.js";
import { Card } from "../../types/card.js";
import { parseYdk } from "./ydk.js";
import { parseYdke } from "./ydke.js";
import { CardDatabase } from "../card-database/ygoprodeck.js";
import { getCustomCard } from "../custom-cards/registry.js";
import { readTextFileSafe } from "../../utils/safe-path.js";

export interface DeckLoadOptions {
  input: string | DeckData;
  name?: string;
}

/**
 * Universal deck loader that accepts:
 * 1. YDKE URL (ydke://...)
 * 2. YDK string content (#main...)
 * 3. File path (.ydk)
 * 4. Human-readable text card list (e.g., "3 Ash Blossom\n1 Branded Fusion...")
 * 5. Structured DeckData object
 */
export async function loadDeckUniversal(options: DeckLoadOptions): Promise<{ deck: DeckData; resolved: ResolvedDeck }> {
  const { input, name } = options;
  let deck: DeckData;
  const db = CardDatabase.getInstance();

  if (typeof input === "object" && input !== null) {
    deck = {
      name: input.name || name || "Yu-Gi-Oh! Deck",
      main: input.main || [],
      extra: input.extra || [],
      side: input.side || [],
      metadata: input.metadata || {}
    };
  } else if (typeof input === "string") {
    const trimmed = input.trim();

    // Case 1: YDKE URL
    if (trimmed.startsWith("ydke://")) {
      deck = parseYdke(trimmed, name);
    }
    // Case 2: File path
    else if ((trimmed.endsWith(".ydk") || trimmed.includes("\\") || trimmed.includes("/")) && fs.existsSync(trimmed)) {
      const read = readTextFileSafe(trimmed);
      if (!read.ok) throw new Error(read.reason);
      deck = parseYdk(read.text!, name || path.basename(trimmed, ".ydk"));
    }
    // Case 3: YDK string content
    else if (trimmed.includes("#main") || trimmed.includes("#extra") || trimmed.includes("!side")) {
      deck = parseYdk(trimmed, name);
    }
    // Case 4: Text card list
    else {
      deck = parseTextCardList(trimmed, name, db);
    }
  } else {
    throw new Error("Invalid deck input. Provide a ydke:// link, .ydk content/file, or a text list.");
  }

  // Ensure card database is loaded
  await db.loadCache();

  // Sort and resolve deck
  const resolved = db.resolveDeck(deck);

  return { deck, resolved };
}

/**
 * Parses freeform text lists like:
 * "3 Ash Blossom & Joyous Spring"
 * "3x Fallen of Albaz"
 * "1 Branded Fusion"
 * with optional section headers [Main Deck], [Extra Deck], [Side Deck]
 */
export function parseTextCardList(text: string, name?: string, db?: CardDatabase): DeckData {
  const database = db || CardDatabase.getInstance();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  const main: number[] = [];
  const extra: number[] = [];
  const side: number[] = [];

  let currentSection: "main" | "extra" | "side" = "main";

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Section headers detection
    if (lower.includes("extra deck") || lower.includes("extra:") || lower === "#extra") {
      currentSection = "extra";
      continue;
    }
    if (lower.includes("side deck") || lower.includes("side:") || lower === "!side") {
      currentSection = "side";
      continue;
    }
    if (lower.includes("main deck") || lower.includes("main:") || lower === "#main" || lower.includes("monsters:") || lower.includes("spells:") || lower.includes("traps:")) {
      currentSection = "main";
      continue;
    }

    // Skip comment lines
    if (line.startsWith("#") || line.startsWith("//") || line.startsWith("---")) {
      continue;
    }

    // Match quantity and card name/id:
    // "3x Ash Blossom", "3 Ash Blossom", "Ash Blossom x3", "14558127"
    let count = 1;
    let cardIdentifier = line;

    // Pattern 1: "3x Card Name" or "3 Card Name" or "3* Card Name"
    const prefixMatch = line.match(/^(\d+)[\s*xX.:-]+(.+)$/);
    if (prefixMatch) {
      count = parseInt(prefixMatch[1], 10);
      cardIdentifier = prefixMatch[2].trim();
    } else {
      // Pattern 2: "Card Name x3" or "Card Name * 3"
      const suffixMatch = line.match(/^(.+?)[\s*xX]+(\d+)$/);
      if (suffixMatch) {
        cardIdentifier = suffixMatch[1].trim();
        count = parseInt(suffixMatch[2], 10);
      }
    }

    // Sanitize count
    count = Math.max(1, Math.min(3, count));

    // Try passcode first
    const numericId = parseInt(cardIdentifier, 10);
    let card: Card | undefined;
    if (!isNaN(numericId) && cardIdentifier.match(/^\d{6,9}$/)) {
      card = database.getCardById(numericId);
      if (!card) {
        const custom = getCustomCard(numericId);
        if (custom) card = custom.cardData;
      }
    }

    // Try name lookup
    if (!card) {
      card = database.getCardByName(cardIdentifier);
    }

    const cardId = card ? card.id : (!isNaN(numericId) ? numericId : 0);

    // Auto-detect extra deck if not explicitly specified
    let targetSection = currentSection;
    if (card && currentSection === "main") {
      const type = (card.type || "").toLowerCase();
      if (type.includes("fusion") || type.includes("synchro") || type.includes("xyz") || type.includes("link")) {
        targetSection = "extra";
      }
    }

    for (let i = 0; i < count; i++) {
      if (targetSection === "extra") {
        extra.push(cardId);
      } else if (targetSection === "side") {
        side.push(cardId);
      } else {
        main.push(cardId);
      }
    }
  }

  return {
    name: name || "Parsed Deck",
    main,
    extra,
    side,
    metadata: {
      parsedFromText: true,
      originalLineCount: lines.length
    }
  };
}

/**
 * Groups and sorts cards in standard Konami tournament order:
 * Main: Monsters (sorted by Level desc, ATK desc) -> Spells -> Traps
 * Extra: Fusion -> Synchro -> Xyz -> Link
 */
export function sortDeckCards(cards: Card[]): Card[] {
  const monsters: Card[] = [];
  const spells: Card[] = [];
  const traps: Card[] = [];
  const others: Card[] = [];

  for (const c of cards) {
    const type = (c.type || "").toLowerCase();
    if (type.includes("spell")) {
      spells.push(c);
    } else if (type.includes("trap")) {
      traps.push(c);
    } else if (type.includes("monster")) {
      monsters.push(c);
    } else {
      others.push(c);
    }
  }

  // Sort monsters: Level descending, then name
  monsters.sort((a, b) => {
    const lvlA = a.level || a.linkval || 0;
    const lvlB = b.level || b.linkval || 0;
    if (lvlB !== lvlA) return lvlB - lvlA;
    return (a.name || "").localeCompare(b.name || "");
  });

  // Sort spells & traps alphabetically
  spells.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  traps.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return [...monsters, ...spells, ...traps, ...others];
}
