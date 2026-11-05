/**
 * Deck legality: one function that answers the question players actually ask.
 *
 * It combines three checks that used to live in different places (and were
 * usually skipped):
 *   1. Structure  — Main 40-60, Extra <=15, Side <=15, max 3 copies of a name.
 *   2. Zone       — Fusion/Synchro/Xyz/Link monsters belong in the Extra Deck,
 *                   everything else belongs in the Main Deck.
 *   3. Banlist    — copy limits for the requested format, from BanlistManager
 *                   (the single source of truth; no hardcoded caps).
 *
 * Unknown cards are reported instead of silently ignored, because "not in the
 * database" is a real answer: the card may be newer than the local cdb.
 */

import type { DeckData } from "../../types/deck.js";
import type { SupportedFormat } from "../banlist/banlist-manager.js";
import { BanlistManager } from "../banlist/banlist-manager.js";
import {
  readCardData,
  TYPE_FUSION,
  TYPE_SYNCHRO,
  TYPE_XYZ,
  TYPE_LINK
} from "../card-scripts/card-data.js";
import { CardDatabase } from "../card-database/ygoprodeck.js";
import { validateDeck } from "./ydk.js";

/** Bitmask for the four Extra Deck monster types. Ritual is NOT included. */
export const EXTRA_DECK_TYPE_MASK = TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK;

export function isExtraDeckType(type: number): boolean {
  return (type & EXTRA_DECK_TYPE_MASK) !== 0;
}



export interface DeckLegalityResult {
  valid: boolean;
  format: SupportedFormat;
  errors: string[];
  warnings: string[];
  /** Copy limit used per passcode in this format. */
  banlist: Record<number, number>;
  /** Cards the local card database does not know (newer than the cdb?). */
  unresolved: Array<{ id: number; location: "main" | "extra" | "side" }>;
  counts: { main: number; extra: number; side: number };
}

type DeckItem = number | string | { id: number | string; name?: string };

function idOf(item: DeckItem): number {
  if (typeof item === "number") return item;
  if (typeof item === "string") {
    const parsed = Number.parseInt(item, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const value = Number(item?.id);
  return Number.isFinite(value) ? value : 0;
}

interface ResolvedType {
  known: boolean;
  type: number;
  name?: string;
}

/**
 * Resolve a card's type bitmask, preferring the engine database (cards.cdb)
 * and falling back to the online card database's frame type.
 */
export async function resolveCardType(id: number, nameHint?: string): Promise<ResolvedType> {
  const cd = await readCardData(id);
  if (cd) return { known: true, type: cd.type, name: cd.name };

  const db = CardDatabase.getInstance();
  const card = db.getCardById(id);
  if (card) {
    const frame = String(card.frameType || "").toLowerCase();
    let type = 0;
    if (frame === "fusion") type |= TYPE_FUSION;
    if (frame === "synchro") type |= TYPE_SYNCHRO;
    if (frame === "xyz") type |= TYPE_XYZ;
    if (frame === "link") type |= TYPE_LINK;
    return { known: true, type, name: card.name };
  }

  return { known: false, type: 0, name: nameHint };
}

export async function checkDeckLegality(
  deck: DeckData,
  format: SupportedFormat = "TCG"
): Promise<DeckLegalityResult> {
  const main = deck.main || [];
  const extra = deck.extra || [];
  const side = deck.side || [];

  // 1. Banlist map for every distinct passcode in the deck.
  const banlistManager = BanlistManager.getInstance();
  const banlist: Record<number, number> = {};
  const allIds = new Set<number>();
  for (const item of [...main, ...extra, ...side]) {
    const id = idOf(item as DeckItem);
    if (id > 0) allIds.add(id);
  }
  for (const id of allIds) banlist[id] = banlistManager.getCardMaxCopies(id, format);

  // 2. Structural + copy-limit validation (existing, now with the banlist).
  const structural = validateDeck(deck, banlist);
  const errors = [...structural.errors];
  const warnings = [...structural.warnings];

  // 3. Zone check + unknown-card report.
  const unresolved: DeckLegalityResult["unresolved"] = [];
  const zoneErrors: string[] = [];
  const reportedZones = new Set<string>();

  const checkZone = async (items: DeckItem[], location: "main" | "extra" | "side") => {
    for (const item of items) {
      const id = idOf(item);
      if (id <= 0) continue;
      const nameHint = typeof item === "object" && item !== null && "name" in item ? String((item as any).name) : undefined;
      const resolved = await resolveCardType(id, nameHint);

      if (!resolved.known) {
        unresolved.push({ id, location });
        continue;
      }

      const isExtra = isExtraDeckType(resolved.type);
      const label = `${resolved.name ?? `Card ${id}`} (${id})`;

      if (location === "main" && isExtra) {
        const key = `main:${id}`;
        if (!reportedZones.has(key)) {
          reportedZones.add(key);
          zoneErrors.push(`Extra Deck monster in Main Deck: ${label} — Fusion/Synchro/Xyz/Link cards must go in the Extra Deck.`);
        }
      }
      if (location === "extra" && !isExtra) {
        const key = `extra:${id}`;
        if (!reportedZones.has(key)) {
          reportedZones.add(key);
          zoneErrors.push(`Main Deck card in Extra Deck: ${label} — only Fusion/Synchro/Xyz/Link monsters may sit in the Extra Deck.`);
        }
      }
    }
  };

  await checkZone(main, "main");
  await checkZone(extra, "extra");
  await checkZone(side, "side");

  if (unresolved.length > 0) {
    warnings.push(
      `${unresolved.length} card(s) are not in the local card database, so their type and copy limit could not be verified: ${unresolved
        .map((u) => u.id)
        .join(", ")}. Run \`ygo fetch-data\` to update the card database.`
    );
  }

  errors.push(...zoneErrors);

  return {
    valid: errors.length === 0,
    format,
    errors,
    warnings,
    banlist,
    unresolved,
    counts: { main: main.length, extra: extra.length, side: side.length }
  };
}
