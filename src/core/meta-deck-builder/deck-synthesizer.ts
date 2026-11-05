import type { DeckData } from "../../types/deck.js";
import { parseYdk, formatYdk, validateDeck } from "../deck-parser/ydk.js";
import { parseYdke, formatYdke } from "../deck-parser/ydke.js";
import {
  getStaplesForFormat,
  analyzeDeckStaples,
  STAPLES_DATABASE,
  type Format,
  type StapleCard,
  type DeckStapleAnalysis
} from "./staple-recommender.js";
import { getArchetypeTemplate, META_TEMPLATES } from "./meta-templates.js";
import { DynamicMetaManager } from "./dynamic-meta-sync.js";
import { BanlistManager } from "../banlist/banlist-manager.js";
import { readCardData } from "../card-scripts/card-data.js";
import { resolveCardType } from "../deck-parser/legality.js";

export interface BuildDeckOptions {
  archetype: string;
  format?: Format;
  goSecond?: boolean;
  targetCount?: number;
}

export interface BuildDeckResult {
  available?: boolean;
  reason?: string;
  availableArchetypes?: string[];
  validation?: { valid: boolean; errors: string[]; warnings: string[] };
  deck: DeckData;
  ydk: string;
  ydke: string;
  strategy: string;
  stapleBreakdown: DeckStapleAnalysis;
}

export interface OptimizeDeckResult {
  optimizedDeck: DeckData;
  changesSummary: string[];
  ydk: string;
  ydke: string;
  analysis?: DeckStapleAnalysis;
}

function getCardId(item: any): number {
  if (typeof item === 'number') return item;
  if (typeof item === 'object' && item !== null && 'id' in item) {
    const num = Number(item.id);
    return isNaN(num) ? 0 : num;
  }
  if (typeof item === 'string') {
    const parsed = parseInt(item, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Builds a competitive tournament-ready deck (Main, Extra, Side) for the specified archetype and format.
 */
export async function buildCompetitiveDeck(options: BuildDeckOptions): Promise<BuildDeckResult> {
  const format: Format = options.format || 'TCG';
  const archetypeInput = options.archetype || 'Tenpai Dragon';
  const template = getArchetypeTemplate(archetypeInput);

  if (!template) {
    // Never substitute a different archetype: say what is available instead.
    const available = Object.keys(META_TEMPLATES).sort();
    return {
      available: false,
      reason: `No deck template for "${archetypeInput}". Nothing was generated.`,
      availableArchetypes: available,
      deck: { name: `${archetypeInput} (unavailable)`, main: [], extra: [], side: [] },
      ydk: '',
      ydke: '',
      strategy: '',
      stapleBreakdown: { totalStaples: 0, handTraps: 0, boardBreakers: 0, engineCards: 0, staples: [], suggestions: [] } as any
    };
  }

  const metaManager = DynamicMetaManager.getInstance();
  /** Single source of truth for copy limits: the live banlist. */
  const maxFor = (id: number) => metaManager.getCardBanStatus(id, format);

  const typeCache = new Map<number, number>();
  const typeOf = async (id: number): Promise<number> => {
    if (!typeCache.has(id)) typeCache.set(id, (await resolveCardType(id)).type);
    return typeCache.get(id) ?? 0;
  };
  const isExtraType = (type: number) => (type & 0x40) !== 0 || (type & 0x2000) !== 0 || (type & 0x800000) !== 0 || (type & 0x4000000) !== 0;

  const isTenpai = template.name.toLowerCase().includes('tenpai');
  const goSecond = options.goSecond !== undefined ? options.goSecond : isTenpai;
  const targetCount = Math.min(60, Math.max(40, options.targetCount || 40));

  const cardCounts = new Map<number, number>();
  const main: number[] = [];
  const extra: number[] = [];

  // 1. Add core engine cards from the template, routed to the correct zone.
  for (const card of template.coreMain) {
    const type = await typeOf(card.id);
    if (isExtraType(type)) {
      // Template authoring error: an Extra Deck monster listed in coreMain.
      const current = cardCounts.get(card.id) || 0;
      const toAdd = Math.min(card.copies, maxFor(card.id) - current, 15 - extra.length);
      for (let i = 0; i < toAdd; i++) extra.push(card.id);
      if (toAdd > 0) cardCounts.set(card.id, current + toAdd);
      continue;
    }
    const current = cardCounts.get(card.id) || 0;
    const copiesToAdd = Math.min(card.copies, maxFor(card.id) - current);
    for (let i = 0; i < copiesToAdd; i++) {
      main.push(card.id);
      cardCounts.set(card.id, (cardCounts.get(card.id) || 0) + 1);
    }
  }

  // 2. Fill Main deck up to targetCount with format-appropriate non-extra staples
  const mainStaples = getStaplesForFormat(format).filter(s => !s.isExtraDeck);
  mainStaples.sort((a, b) => {
    const scoreA = goSecond ? (a.goSecondScore ?? 0) : (a.goFirstScore ?? 0);
    const scoreB = goSecond ? (b.goSecondScore ?? 0) : (b.goFirstScore ?? 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.defaultCopies ?? 3) - (a.defaultCopies ?? 3);
  });

  for (const staple of mainStaples) {
    if (main.length >= targetCount) break;
    const current = cardCounts.get(staple.id) || 0;
    const limit = maxFor(staple.id);
    const maxAllowed = Math.min(limit, staple.defaultCopies ?? 3);
    const needed = Math.min(maxAllowed - current, targetCount - main.length);
    if (needed > 0) {
      for (let i = 0; i < needed; i++) {
        main.push(staple.id);
      }
      cardCounts.set(staple.id, current + needed);
    }
  }

  // If still below targetCount, fill remaining slots up to 3 copies of top legal staples
  if (main.length < targetCount) {
    for (const staple of mainStaples) {
      if (main.length >= targetCount) break;
      const current = cardCounts.get(staple.id) || 0;
      const limit = maxFor(staple.id);
      const maxAllowed = Math.min(3, limit);
      const needed = Math.min(maxAllowed - current, targetCount - main.length);
      if (needed > 0) {
        for (let i = 0; i < needed; i++) {
          main.push(staple.id);
        }
        cardCounts.set(staple.id, current + needed);
      }
    }
  }

  // 3. Assemble Extra Deck up to 15 cards
  for (const card of template.coreExtra) {
    if (extra.length >= 15) break;
    const resolved = await resolveCardType(card.id);
    if (resolved.known && !isExtraType(resolved.type)) continue;
    const current = cardCounts.get(card.id) || 0;
    const limit = maxFor(card.id);
    const maxAllowed = Math.min(3, limit);
    const toAdd = Math.min(card.copies, maxAllowed - current, 15 - extra.length);
    for (let i = 0; i < toAdd; i++) {
      extra.push(card.id);
    }
    if (toAdd > 0) {
      cardCounts.set(card.id, current + toAdd);
    }
  }

  if (extra.length < 15) {
    const extraStaples = getStaplesForFormat(format).filter(s => s.isExtraDeck);
    extraStaples.sort((a, b) => {
      const scoreA = goSecond ? (a.goSecondScore ?? 0) : (a.goFirstScore ?? 0);
      const scoreB = goSecond ? (b.goSecondScore ?? 0) : (b.goFirstScore ?? 0);
      return scoreB - scoreA;
    });

    for (const s of extraStaples) {
      if (extra.length >= 15) break;
      const resolved = await resolveCardType(s.id);
      if (resolved.known && !isExtraType(resolved.type)) continue;
      const current = cardCounts.get(s.id) || 0;
      const limit = maxFor(s.id);
      const maxAllowed = Math.min(3, limit);
      const toAdd = Math.min(maxAllowed - current, 15 - extra.length);
      for (let i = 0; i < toAdd; i++) {
        extra.push(s.id);
      }
      if (toAdd > 0) {
        cardCounts.set(s.id, current + toAdd);
      }
    }
  }

  // 4. Assemble Side Deck with exactly 15 cards
  const side: number[] = [];

  // 4a. Add template recommended side cards first (if legal in format)
  if (template.recommendedSide && template.recommendedSide.length > 0) {
    for (const card of template.recommendedSide) {
      if (side.length >= 15) break;
      const current = cardCounts.get(card.id) || 0;
      const maxAllowed = metaManager.getCardBanStatus(card.id, format);
      const remainingForCard = maxAllowed - current;
      if (remainingForCard > 0) {
        const toAdd = Math.min(remainingForCard, 15 - side.length, card.copies);
        for (let i = 0; i < toAdd; i++) {
          side.push(card.id);
        }
        cardCounts.set(card.id, current + toAdd);
      }
    }
  }

  // 4b. Fill remaining side slots from sideCandidates
  const sideCandidates = getStaplesForFormat(format).filter(s => !s.isExtraDeck);

  sideCandidates.sort((a, b) => {
    if (goSecond) {
      // Prioritize go-first options, floodgates and protection in side
      const scoreA = (a.goFirstScore ?? 0) - (a.goSecondScore ?? 0);
      const scoreB = (b.goFirstScore ?? 0) - (b.goSecondScore ?? 0);
      return scoreB - scoreA;
    } else {
      // Prioritize board breakers and go-second options in side
      const scoreA = (a.goSecondScore ?? 0) - (a.goFirstScore ?? 0);
      const scoreB = (b.goSecondScore ?? 0) - (b.goFirstScore ?? 0);
      return scoreB - scoreA;
    }
  });

  for (const staple of sideCandidates) {
    if (side.length >= 15) break;
    const current = cardCounts.get(staple.id) || 0;
    const formatLimit = maxFor(staple.id);
    const maxAllowed = Math.min(3, formatLimit);
    const remainingForCard = maxAllowed - current;
    if (remainingForCard > 0) {
      const toAdd = Math.min(remainingForCard, 15 - side.length, staple.defaultCopies ?? 3);
      for (let i = 0; i < toAdd; i++) {
        side.push(staple.id);
      }
      cardCounts.set(staple.id, current + toAdd);
    }
  }

  if (side.length < 15) {
    for (const staple of sideCandidates) {
      if (side.length >= 15) break;
      const current = cardCounts.get(staple.id) || 0;
      const formatLimit = maxFor(staple.id);
      const maxAllowed = Math.min(3, formatLimit);
      const remainingForCard = maxAllowed - current;
      if (remainingForCard > 0) {
        const toAdd = Math.min(remainingForCard, 15 - side.length);
        for (let i = 0; i < toAdd; i++) {
          side.push(staple.id);
        }
        cardCounts.set(staple.id, current + toAdd);
      }
    }
  }

  const deck: DeckData = {
    name: `${template.name} (${format} Meta)`,
    main,
    extra,
    side,
    metadata: {
      format,
      archetype: template.name,
      style: template.style,
      goSecond,
      generatedDate: new Date().toISOString()
    }
  };

  // 5. Final legality gate: no forbidden cards, correct zones, banlist copy limits.
  const sanitizedMain = main.filter((id) => maxFor(id) > 0);
  const sanitizedExtra = extra.filter((id) => maxFor(id) > 0);
  const sanitizedSide = side.filter((id) => maxFor(id) > 0);

  const zoneErrors: string[] = [];
  for (const id of sanitizedMain) {
    if (isExtraType(await typeOf(id))) zoneErrors.push(`Extra Deck monster in Main Deck: ${id}`);
  }
  for (const id of sanitizedExtra) {
    if (!isExtraType(await typeOf(id))) zoneErrors.push(`Main Deck card in Extra Deck: ${id}`);
  }

  const banlistMap: Record<number, number> = {};
  for (const id of new Set([...sanitizedMain, ...sanitizedExtra, ...sanitizedSide])) banlistMap[id] = maxFor(id);

  const validatedDeck: DeckData = { ...deck, main: sanitizedMain, extra: sanitizedExtra, side: sanitizedSide };
  const validation = validateDeck(validatedDeck, banlistMap);
  const allErrors = [...validation.errors, ...zoneErrors];

  if (allErrors.length > 0) {
    return {
      available: false,
      reason: `Generated deck failed legality checks: ${allErrors.join('; ')}`,
      validation: { valid: false, errors: allErrors, warnings: validation.warnings },
      deck: validatedDeck,
      ydk: formatYdk(validatedDeck),
      ydke: formatYdke(validatedDeck),
      strategy: '',
      stapleBreakdown: analyzeDeckStaples(validatedDeck, format)
    };
  }

  Object.assign(deck, { main: sanitizedMain, extra: sanitizedExtra, side: sanitizedSide });

  const ydk = formatYdk(deck);
  const ydke = formatYdke(deck);
  const stapleBreakdown = analyzeDeckStaples(deck, format);

  return {
    available: true,
    validation: { valid: true, errors: [], warnings: validation.warnings },
    deck,
    ydk,
    ydke,
    strategy: template.strategy,
    stapleBreakdown
  };
}

/**
 * Optimizes a user-provided deck according to competitive meta guidelines and format legality.
 */
export async function optimizeUserDeck(
  deck: DeckData,
  format: Format = 'TCG'
): Promise<OptimizeDeckResult> {
  const changesSummary: string[] = [];
  let mainCards = [...deck.main].map(getCardId);
  const extraCards = deck.extra ? [...deck.extra].map(getCardId) : [];
  const sideCards = deck.side ? [...deck.side].map(getCardId) : [];

  const banlist = BanlistManager.getInstance();

  // 0. Remove banned (Forbidden) cards and trim over-limit copies across all decks
  const removeBannedFrom = (cards: number[], label: string) => {
    for (let i = cards.length - 1; i >= 0; i--) {
      const id = cards[i];
      if (banlist.getBanStatus(id, format) === 'Forbidden') {
        cards.splice(i, 1);
        changesSummary.push(`Removed banned card (passcode ${id}) from ${label} in ${format}.`);
      }
    }
  };
  removeBannedFrom(mainCards, 'Main Deck');
  removeBannedFrom(extraCards, 'Extra Deck');
  removeBannedFrom(sideCards, 'Side Deck');

  // Trim over-limit copies (Limited/Semi-Limited) across main deck
  const mainCountMap = new Map<number, number>();
  for (let i = mainCards.length - 1; i >= 0; i--) {
    const id = mainCards[i];
    const max = banlist.getCardMaxCopies(id, format);
    if (max <= 0) continue;
    const current = (mainCountMap.get(id) || 0) + 1;
    if (current > max) {
      mainCards.splice(i, 1);
      changesSummary.push(`Trimmed passcode ${id} to legal limit of ${max} in Main Deck (${format}).`);
    } else {
      mainCountMap.set(id, current);
    }
  }

  const stapleMap = new Map<number, StapleCard>(STAPLES_DATABASE.map(s => [s.id, s]));

  // 1. Check illegal or over-limit cards in format and reduce/replace them
  // E.g., Maxx "C" (23434538) is limit 0 in TCG
  const replacementCandidates = [
    10045474, // Infinite Impermanence
    14558127, // Ash Blossom & Joyous Spring
    24299458, // Forbidden Droplet
    97268402  // Effect Veiler
  ];

  for (let i = 0; i < mainCards.length; i++) {
    const cardId = mainCards[i];
    const staple = stapleMap.get(cardId);
    if (!staple) continue;

    const isLegalInFormat = staple.formats.includes(format);
    const formatLimit = banlist.getCardMaxCopies(staple.id, format);

    if (!isLegalInFormat || formatLimit <= 0) {
      // Find a replacement card not already at 3 copies
      const replacementId = replacementCandidates.find(candId => {
        const candStaple = stapleMap.get(candId);
        if (!candStaple || !candStaple.formats.includes(format)) return false;
        const candLimit = banlist.getCardMaxCopies(candId, format);
        const currentCount = mainCards.filter(id => id === candId).length;
        return currentCount < Math.min(3, candLimit);
      });

      if (replacementId) {
        const repStaple = stapleMap.get(replacementId);
        mainCards[i] = replacementId;
        changesSummary.push(`Replaced illegal/banned '${staple.name}' with '${repStaple?.name || replacementId}' in ${format}.`);
      } else {
        mainCards.splice(i, 1);
        i--;
        changesSummary.push(`Removed illegal/banned '${staple.name}' in ${format}.`);
      }
    }
  }

  // Check card limits (max 3 or format limits across main deck)
  const mainCounts = new Map<number, number>();
  for (let i = 0; i < mainCards.length; i++) {
    const cardId = mainCards[i];
    const staple = stapleMap.get(cardId);
    const limit = banlist.getCardMaxCopies(cardId, format);
    const current = (mainCounts.get(cardId) || 0) + 1;
    if (current > limit) {
      mainCards.splice(i, 1);
      i--;
      changesSummary.push(`Reduced '${staple?.name || cardId}' to legal limit of ${limit} copy/copies.`);
    } else {
      mainCounts.set(cardId, current);
    }
  }

  // 2. If Main deck > 40, trim redundant duplicates towards 40
  if (mainCards.length > 40) {
    const originalCount = mainCards.length;
    // Count frequencies
    const freq = new Map<number, number>();
    for (const id of mainCards) {
      freq.set(id, (freq.get(id) || 0) + 1);
    }

    // Trim cards that have 3 copies down to 2 if needed
    for (const [id, count] of freq.entries()) {
      if (mainCards.length <= 40) break;
      if (count >= 3) {
        const lastIdx = mainCards.lastIndexOf(id);
        if (lastIdx !== -1) {
          mainCards.splice(lastIdx, 1);
          freq.set(id, count - 1);
        }
      }
    }

    // If still > 40, trim cards that have 2 copies down to 1
    if (mainCards.length > 40) {
      for (const [id, count] of freq.entries()) {
        if (mainCards.length <= 40) break;
        if (count >= 2) {
          const lastIdx = mainCards.lastIndexOf(id);
          if (lastIdx !== -1) {
            mainCards.splice(lastIdx, 1);
            freq.set(id, count - 1);
          }
        }
      }
    }

    // If still > 40, trim from the end down to 40
    if (mainCards.length > 40) {
      mainCards = mainCards.slice(0, 40);
    }

    changesSummary.push(`Trimmed main deck from ${originalCount} to ${mainCards.length} cards for optimal 40-card consistency.`);
  }

  // 3. If Extra deck < 15, suggest and fill with top extra staples
  if (extraCards.length < 15) {
    const extraStaples = getStaplesForFormat(format).filter(s => s.isExtraDeck);
    extraStaples.sort((a, b) => (b.goFirstScore ?? 0) - (a.goFirstScore ?? 0));

    const added: string[] = [];
    for (const s of extraStaples) {
      if (extraCards.length >= 15) break;
      const count = extraCards.filter(id => id === s.id).length;
      const limit = banlist.getCardMaxCopies(s.id, format);
      if (count < limit) {
        extraCards.push(s.id);
        added.push(s.name);
      }
    }
    if (added.length > 0) {
      changesSummary.push(`Filled Extra deck with ${added.length} top meta staple(s): ${added.join(', ')}.`);
    }
  }

  // 4. Check Hand Trap and Board Breaker ratio: if < 20%, suggest and add
  let htCount = 0;
  let bbCount = 0;
  for (const id of mainCards) {
    const staple = stapleMap.get(id);
    if (staple) {
      if (staple.category === 'Hand Trap') htCount++;
      else if (staple.category === 'Board Breaker') bbCount++;
    }
  }

  const stapleRatio = mainCards.length > 0 ? (htCount + bbCount) / mainCards.length : 0;
  if (stapleRatio < 0.20) {
    // Add staples if below 40
    const needed = Math.max(0, 40 - mainCards.length);
    if (needed > 0) {
      for (const stapleId of replacementCandidates) {
        if (mainCards.length >= 40) break;
        const currentCount = mainCards.filter(id => id === stapleId).length;
        if (currentCount < Math.min(3, banlist.getCardMaxCopies(stapleId, format))) {
          mainCards.push(stapleId);
          const stapleName = stapleMap.get(stapleId)?.name || String(stapleId);
          changesSummary.push(`Added '${stapleName}' to improve staple ratio.`);
        }
      }
    } else {
      changesSummary.push("Staple ratio is under 20%. Recommended adding Ash Blossom, Infinite Impermanence, or Forbidden Droplet.");
    }
  }

  const optimizedDeck: DeckData = {
    name: deck.name ? `${deck.name} (Optimized)` : 'Optimized Deck',
    main: mainCards,
    extra: extraCards,
    side: sideCards
  };

  const ydk = formatYdk(optimizedDeck);
  const ydke = formatYdke(optimizedDeck);
  const analysis = analyzeDeckStaples(optimizedDeck, format);

  return {
    optimizedDeck,
    changesSummary,
    ydk,
    ydke,
    analysis
  };
}

