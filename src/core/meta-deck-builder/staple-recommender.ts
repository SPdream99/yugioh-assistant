import type { DeckData } from "../../types/deck.js";
import { DynamicMetaManager, dynamicMetaManager, type MetaStaple } from "./dynamic-meta-sync.js";

export type StapleCategory =
  | 'Hand Trap'
  | 'Hand Traps'
  | 'Board Breaker'
  | 'Board Breakers'
  | 'Consistency Spell'
  | 'Consistency'
  | 'Floodgate'
  | 'Extra Deck Boss/Utility'
  | 'Extra Deck'
  | 'Protection & Enablers';

export type Format = 'TCG' | 'OCG' | 'AE' | 'Genesys' | 'Master Duel';

export interface StapleCard {
  id: number;
  name: string;
  category: StapleCategory;
  formats: Format[];
  defaultCopies?: number;
  isExtraDeck?: boolean;
  tier?: 'S' | 'A' | 'B' | 'Tech';
  goSecondScore?: number; // 0 to 10 priority when goSecond=true
  goFirstScore?: number;  // 0 to 10 priority when goSecond=false
  description?: string;
}

export const STAPLES_DATABASE: StapleCard[] = [
  // --- Hand Traps ---
  {
    id: 14558127,
    name: "Ash Blossom & Joyous Spring",
    category: "Hand Trap",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 10,
    goSecondScore: 10,
    description: "Universal hand trap negating search, summon from deck, or send from deck."
  },
  {
    id: 6007213,
    name: "Mulcharmy Fuwalos",
    category: "Hand Trap",
    formats: ["TCG", "OCG"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 6,
    goSecondScore: 10,
    description: "Draw 1 card each time opponent special summons from deck or extra deck."
  },
  {
    id: 34124316,
    name: "Mulcharmy Purulia",
    category: "Hand Trap",
    formats: ["TCG", "OCG"],
    defaultCopies: 3,
    tier: 'A',
    goFirstScore: 5,
    goSecondScore: 9,
    description: "Draw 1 card each time opponent normal or special summons from hand."
  },
  {
    id: 10045474,
    name: "Infinite Impermanence",
    category: "Hand Trap",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 9,
    goSecondScore: 9,
    description: "Trap hand trap negating face-up monster effect and spell/trap column."
  },
  {
    id: 27204311,
    name: "Nibiru, the Primal Being",
    category: "Hand Trap",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 6,
    goSecondScore: 9,
    description: "Tributes all monsters on field if opponent summons 5+ monsters in a turn."
  },
  {
    id: 94145021,
    name: "Droll & Lock Bird",
    category: "Hand Trap",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 7,
    goSecondScore: 8,
    description: "Locks out further searching or drawing for the turn after first search."
  },
  {
    id: 97268402,
    name: "Effect Veiler",
    category: "Hand Trap",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 8,
    goSecondScore: 7,
    description: "Targeted monster effect negation during opponent's main phase."
  },
  {
    id: 52038441,
    name: "Ghost Mourner & Moonlit Chill",
    category: "Hand Trap",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'B',
    goFirstScore: 7,
    goSecondScore: 7,
    description: "Negates special summoned monster until end of turn and burns if it leaves field."
  },
  {
    id: 73642296,
    name: "Ghost Belle & Haunted Mansion",
    category: "Hand Trap",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'A',
    goFirstScore: 8,
    goSecondScore: 7,
    description: "Negates effects that move cards from GY or banish from GY."
  },
  {
    id: 59438930,
    name: "Ghost Ogre & Snow Rabbit",
    category: "Hand Trap",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'A',
    goFirstScore: 7,
    goSecondScore: 8,
    description: "Destroys face-up card when it activates effect on field."
  },
  {
    id: 91800273,
    name: "Dimension Shifter",
    category: "Hand Trap",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 2,
    tier: 'A',
    goFirstScore: 8,
    goSecondScore: 8,
    description: "Banish any card sent to graveyard until end of next turn."
  },
  {
    id: 23434538,
    name: 'Maxx "C"',
    category: "Hand Trap",
    formats: ["OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 10,
    goSecondScore: 10,
    description: "Draw 1 card every time opponent special summons this turn."
  },

  // --- Board Breakers ---
  {
    id: 88453933,
    name: "Triple Tactics Thrust",
    category: "Board Breaker",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 6,
    goSecondScore: 9,
    description: "Searches or sets any Normal Spell/Trap if opponent activated a monster effect."
  },
  {
    id: 44095762,
    name: "Triple Tactics Talent",
    category: "Board Breaker",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 7,
    goSecondScore: 9,
    description: "Draw 2, take control of monster, or look at opponent's hand to rip 1 card."
  },
  {
    id: 48130397,
    name: "Super Polymerization",
    category: "Board Breaker",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'A',
    goFirstScore: 6,
    goSecondScore: 9,
    description: "Unreactable Fusion summon using opponent's monsters."
  },
  {
    id: 24299458,
    name: "Forbidden Droplet",
    category: "Board Breaker",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 7,
    goSecondScore: 10,
    description: "Send cards from hand/field to negate monster effects and halve ATK unreactably."
  },
  {
    id: 86327225,
    name: "Dark Ruler No More",
    category: "Board Breaker",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'A',
    goFirstScore: 3,
    goSecondScore: 9,
    description: "Negate effects of all face-up monsters opponent currently controls."
  },
  {
    id: 15693423,
    name: "Evenly Matched",
    category: "Board Breaker",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'S',
    goFirstScore: 2,
    goSecondScore: 10,
    description: "Banish opponent's field face-down until they control same number of cards."
  },
  {
    id: 18144506,
    name: "Harpie's Feather Duster",
    category: "Board Breaker",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'A',
    goFirstScore: 3,
    goSecondScore: 8,
    description: "Destroy all Spells and Traps your opponent controls."
  },
  {
    id: 14532163,
    name: "Lightning Storm",
    category: "Board Breaker",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'A',
    goFirstScore: 2,
    goSecondScore: 9,
    description: "Destroy all attack position monsters or all Spells/Traps opponent controls."
  },

  // --- Protection & Enablers ---
  {
    id: 24224830,
    name: "Called by the Grave",
    category: "Protection & Enablers",
    formats: ["AE", "Genesys"],
    defaultCopies: 1,
    tier: 'S',
    goFirstScore: 10,
    goSecondScore: 6,
    description: "Banish monster from opponent's GY and negate its effects until end of next turn. (Forbidden in TCG/OCG/MD)"
  },
  {
    id: 65681983,
    name: "Crossout Designator",
    category: "Protection & Enablers",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'S',
    goFirstScore: 9,
    goSecondScore: 5,
    description: "Declare 1 card name; banish it from Main Deck to negate that card's activated effects."
  },

  // --- Extra Deck Staples ---
  {
    id: 29301450,
    name: "S:P Little Knight",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'S',
    goFirstScore: 10,
    goSecondScore: 10,
    description: "Link-2 staple banishing on summon and temporary tag-out quick effect."
  },
  {
    id: 90448279,
    name: "Divine Arsenal AA-ZEUS - Sky Thunder",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'A',
    goFirstScore: 7,
    goSecondScore: 10,
    description: "Rank 12 Xyz that sends all other cards on the field to GY as a Quick Effect."
  },
  {
    id: 83965310,
    name: "Super Starslayer TY-PHON - Sky Crisis",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'S',
    goFirstScore: 7,
    goSecondScore: 10,
    description: "Rank 12 Xyz overlayable onto any monster; floodgates 3000+ ATK monsters and bounces."
  },
  {
    id: 65741786,
    name: "I:P Masquerena",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'S',
    goFirstScore: 9,
    goSecondScore: 6,
    description: "Quick Effect Link Summon during opponent's main phase granting destruction immunity."
  },
  {
    id: 86066372,
    name: "Accesscode Talker",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'A',
    goFirstScore: 7,
    goSecondScore: 9,
    description: "Link-4 game-ender with 5300 ATK and unreactable multiple pops."
  },
  {
    id: 73580471,
    name: "Promethean Princess, Bestower of Flames",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'A',
    goFirstScore: 8,
    goSecondScore: 7,
    description: "Link-3 FIRE boss providing GY revival and disruptive pop from GY."
  },
  {
    id: 21044178,
    name: "Abyss Dweller",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'B',
    goFirstScore: 9,
    goSecondScore: 5,
    description: "Rank 4 Xyz preventing opponent from activating cards or effects in their GY."
  },
  {
    id: 2857636,
    name: "Knightmare Phoenix",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'A',
    goFirstScore: 6,
    goSecondScore: 7,
    description: "Link-2 generic spell/trap removal on summon."
  },
  {
    id: 42110604,
    name: "Mudragon of the Swamp",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'B',
    goFirstScore: 6,
    goSecondScore: 8,
    description: "Generic 2 monster Super Poly fusion target granting targeting protection."
  },
  {
    id: 3030384,
    name: "Garura, Wings of Resonant Life",
    category: "Extra Deck Boss/Utility",
    isExtraDeck: true,
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'B',
    goFirstScore: 6,
    goSecondScore: 8,
    description: "Generic Super Poly target (same Type/Attribute, different names); draws 1 when sent to GY."
  },

  // --- Consistency Spells & Floodgates ---
  {
    id: 84211599,
    name: "Pot of Prosperity",
    category: "Consistency Spell",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'A',
    goFirstScore: 9,
    goSecondScore: 8,
    description: "Banish 3 or 6 from Extra Deck to excavate 3 or 6 cards and add 1."
  },
  {
    id: 83326048,
    name: "Dimensional Barrier",
    category: "Floodgate",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 3,
    tier: 'B',
    goFirstScore: 9,
    goSecondScore: 2,
    description: "Declare 1 monster card type (Fusion/Synchro/Xyz/Pendulum/Ritual); lock summons/effects for turn."
  },
  {
    id: 82732705,
    name: "Skill Drain",
    category: "Floodgate",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'B',
    goFirstScore: 8,
    goSecondScore: 2,
    description: "Continuous Trap negating effects of all face-up monsters on field."
  },
  {
    id: 58921041,
    name: "Anti-Spell Fragrance",
    category: "Floodgate",
    formats: ["TCG", "OCG", "Master Duel"],
    defaultCopies: 1,
    tier: 'B',
    goFirstScore: 8,
    goSecondScore: 2,
    description: "Both players must set Spell Cards before activating them, cannot activate until next turn."
  }
];

/**
 * Filters staples that are legal in the specified format using live banlist data if available.
 */
export function getStaplesForFormat(format: Format = 'TCG'): StapleCard[] {
  const metaManager = DynamicMetaManager.getInstance();

  // Build a combined candidate set: static staples + live staples from web (auto-updated).
  const liveStaples = metaManager.getLiveStaples(format);
  const combined = new Map<number, StapleCard>();

  // Static baseline
  for (const card of STAPLES_DATABASE) {
    combined.set(card.id, card);
  }

  // Merge live staples (new cards not in static list get added)
  for (const ls of liveStaples) {
    if (combined.has(ls.id)) continue;
    const isExtra = ls.category === 'Extra Deck';
    const category = ls.category || 'Consistency';
    combined.set(ls.id, {
      id: ls.id,
      name: ls.name,
      category,
      formats: [format],
      defaultCopies: isExtra ? 1 : 1,
      tier: (ls.tier as any) || 'Tech',
      goFirstScore: 5,
      goSecondScore: 5,
      description: `Live staple from YGOPRODeck (${ls.type})`,
      isExtraDeck: isExtra
    } as StapleCard);
  }

  return Array.from(combined.values()).filter(card => {
    // 1. Cross-check against dynamic live banlist (authoritative)
    const liveLimit = metaManager.getCardBanStatus(card.id, format);
    if (liveLimit <= 0) {
      return false;
    }

    // 2. Check static format applicability (only for static cards).
    // Copy limits come from the live banlist above, never from this catalogue.
    if (STAPLES_DATABASE.some(s => s.id === card.id)) {
      if (!card.formats.includes(format)) return false;
    }
    return true;
  });
}

export interface DeckStapleAnalysis {
  stapleRatio: number;
  handTraps: number;
  boardBreakers: number;
  consistency: number;
  suggestions: string[];
  banViolations: string[];
  // Backwards compatibility fields
  handTrapsCount: number;
  boardBreakersCount: number;
  consistencyCount: number;
  totalStaplesCount: number;
  recommendations: string[];
}

/**
 * Analyzes main deck composition against live meta staples and banlist.
 */
export function analyzeDeckStaples(deck: DeckData, format: Format = 'TCG'): DeckStapleAnalysis {
  const metaManager = DynamicMetaManager.getInstance();
  const liveStaples = metaManager.getLiveStaples(format);
  const liveStapleMap = new Map<number, MetaStaple>(liveStaples.map(s => [s.id, s]));
  const staticStapleMap = new Map<number, StapleCard>(STAPLES_DATABASE.map(c => [c.id, c]));

  const getCardId = (item: any): number | undefined => {
    if (typeof item === 'number') return item;
    if (typeof item === 'object' && item !== null && 'id' in item) {
      const num = Number(item.id);
      return isNaN(num) ? undefined : num;
    }
    if (typeof item === 'string') {
      const parsed = parseInt(item, 10);
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  };

  let totalStaples = 0;
  let handTraps = 0;
  let boardBreakers = 0;
  let consistency = 0;

  const cardCounts = new Map<number, number>();

  for (const item of deck.main) {
    const id = getCardId(item);
    if (id !== undefined) {
      cardCounts.set(id, (cardCounts.get(id) || 0) + 1);

      // Check live staple map first, then static
      const live = liveStapleMap.get(id);
      const stat = staticStapleMap.get(id);

      const category = live?.category || stat?.category;
      const isExtra = stat?.isExtraDeck || live?.category === 'Extra Deck';

      if (!isExtra && (live || stat)) {
        totalStaples++;
        const catLower = (category || '').toLowerCase();
        if (catLower.includes('hand trap')) {
          handTraps++;
        } else if (catLower.includes('board breaker')) {
          boardBreakers++;
        } else if (catLower.includes('consistency') || catLower.includes('protection')) {
          consistency++;
        }
      }
    }
  }

  // Cross check banlist violations
  const banViolations: string[] = [];
  for (const [id, count] of cardCounts.entries()) {
    const maxAllowed = metaManager.getCardBanStatus(id, format);
    if (count > maxAllowed) {
      if (maxAllowed === 0) {
        banViolations.push(`Card passcode ${id} is BANNED in ${format} (0 copies allowed, currently running ${count}).`);
      } else {
        banViolations.push(`Card passcode ${id} is limited to ${maxAllowed} in ${format} (currently running ${count}).`);
      }
    }
  }

  const mainLength = deck.main.length;
  const stapleRatio = mainLength > 0 ? totalStaples / mainLength : 0;
  const percentage = Math.round(stapleRatio * 100);

  const suggestions: string[] = [];
  if (handTraps < 9 && format === 'TCG') {
    suggestions.push(`Low Hand Trap count (${handTraps} < 9). Modern meta requires at least 9-12 hand traps (Ash Blossom, Infinite Impermanence, Mulcharmy Fuwalos, Nibiru).`);
  }
  if (boardBreakers === 0) {
    if (format === 'TCG') {
      suggestions.push("No Board Breakers found. Consider adding Forbidden Droplet or Evenly Matched for going second. (Triple Tactics Talent is Forbidden in TCG)");
    } else {
      suggestions.push("No Board Breakers found. Consider adding Forbidden Droplet, Triple Tactics Talent, or Evenly Matched for going second.");
    }
  }
  if (stapleRatio < 0.25) {
    suggestions.push(`Low overall staple ratio (${percentage}% < 25%). Meta decks typically run 30-40% non-engine staples (${totalStaples}/${mainLength} cards).`);
  }
  if (mainLength > 40) {
    suggestions.push(`Main deck has ${mainLength} cards (> 40). Trimming to 40 maximizes consistency to draw starters.`);
  }

  // Format-specific suggestions (ban-aware)
  if (format === 'OCG' || format === 'Master Duel') {
    const hasMaxxC = deck.main.some(x => {
      const id = getCardId(x);
      return id === 23434538;
    });
    const maxcLimit = metaManager.getCardBanStatus(23434538, format);
    if (!hasMaxxC && maxcLimit > 0) {
      suggestions.push(`Format ${format} recommendation: Run up to ${maxcLimit} Maxx "C" (23434538) for maximum meta advantage. (Called by the Grave is Forbidden in ${format})`);
    }
  }

  // Extra deck suggestions
  const extraList = deck.extra || [];
  const extraHasSP = extraList.some(x => getCardId(x) === 29301450);
  if (!extraHasSP && extraList.length > 0) {
    suggestions.push("Extra Deck recommendation: Consider adding 'S:P Little Knight' (29301450) - top versatile Link-2 removal staple.");
  }

  return {
    stapleRatio,
    handTraps,
    boardBreakers,
    consistency,
    suggestions,
    banViolations,
    handTrapsCount: handTraps,
    boardBreakersCount: boardBreakers,
    consistencyCount: consistency,
    totalStaplesCount: totalStaples,
    recommendations: suggestions
  };
}

/**
 * Returns recommended staples for a format, merging dynamic live staples with static references.
 */
export function getRecommendedStaples(format: Format = "TCG"): MetaStaple[] {
  return DynamicMetaManager.getInstance().getLiveStaples(format);
}
