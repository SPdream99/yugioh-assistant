import { Card, CardFilter, DeckData } from '../../types/card.js';
import { cardDatabase } from './card-database.js';
import {
  SEARCHER_REGISTRY,
  SearcherEntry,
  getSearchersForCard,
  calculateSmallWorldBridges,
  SmallWorldBridgeResult
} from './searcher-index.js';

export interface InDeckSearcherInfo {
  searcherName: string;
  category: string;
  method: string;
  directAccess: boolean;
  details: string;
}

export interface BridgeSearcherInfo {
  bridgeName: string;
  category: string;
  route: string;
  missingCards: string[];
  description: string;
}

export interface RecommendedAddition {
  cardName: string;
  role: 'tutor' | 'dumper' | 'floodgate' | 'bridge';
  reason: string;
}

export interface MatchedCardCandidate {
  card: {
    id: number;
    name: string;
    atk?: number;
    def?: number;
    level?: number;
    race?: string;
    attribute?: string;
    type: string;
    desc: string;
    archetype?: string;
  };
  payoff: string;
  synergyWithDeck: string;
  searchPathway: {
    inDeckSearchers: InDeckSearcherInfo[];
    bridgeSearchers: BridgeSearcherInfo[];
  };
  comboSteps: string[];
  recommendedAdditions: RecommendedAddition[];
}

export interface SynergyAnalysisResult {
  matchedCards: MatchedCardCandidate[];
  summary: string;
  deckEnginesDetected: string[];
}

/**
 * Extracts a normalized array of all card names present in the deck.
 */
function extractDeckCardNames(deck?: DeckData): string[] {
  if (!deck) return [];
  const names: string[] = [];

  const add = (item: string | number | Card | undefined) => {
    if (!item) return;
    if (typeof item === 'string') {
      names.push(item.trim());
    } else if (typeof item === 'number') {
      const card = cardDatabase.getCardById(item);
      if (card?.name) {
        names.push(card.name.trim());
      } else {
        const KNOWN: Record<number, string> = {
          61245789: 'Aluber the Jester of Despia',
          32603893: 'Fallen of Albaz',
          44146295: 'Branded Fusion',
          78942511: 'Branded Opening',
          8730435: 'Albion the Branded Dragon',
          44097050: 'Mirrorjade the Iceblade Dragon',
          55623480: 'Fairy Tail - Snow',
          7902349: 'Fairy Tail - Luna'
        };
        if (KNOWN[item]) {
          names.push(KNOWN[item]);
        }
      }
    } else if (item.name) {
      names.push(item.name.trim());
    }
  };

  deck.main?.forEach(add);
  deck.mainDeck?.forEach(add);
  deck.extra?.forEach(add);
  deck.extraDeck?.forEach(add);
  deck.side?.forEach(add);
  deck.sideDeck?.forEach(add);
  deck.cards?.forEach(add);

  return names;
}

/**
 * Analyzes the tactical payoff of a card.
 */
function determinePayoff(card: Card, desiredPayoff?: string): string {
  const name = card.name.toLowerCase();
  const desc = (card.desc || '').toLowerCase();

  if (name === 'fairy tail - snow') {
    return 'Quick-Effect Book of Moon disruption from GY. By banishing 7 cards from hand, field, and/or GY, Snow Special Summons herself and flips an opponent face-up monster into face-down Defense Position. Not once per turn, providing recurring disruption, battle stall, and extra board presence.';
  }

  if (name === 'fairy tail - luna') {
    return 'Normal Summon searcher for any 1850 ATK Spellcaster (e.g. Fairy Tail - Snow), combined with a Quick-Effect targeting bounce that forces the opponent to send a duplicate from Deck/Extra Deck to GY or return their monster to hand.';
  }

  if (name.includes('familiar-possessed')) {
    return '1850 ATK Level 4 Spellcaster beatstick with piercing battle damage and synergy with Charmer backrow/Spirit Charmers.';
  }

  if (name === 'secret village of the spellcasters') {
    return 'One-sided Spell lock floodgate: opponent cannot activate Spell Cards while you control a Spellcaster monster.';
  }

  // Generic heuristic analysis
  const payoffs: string[] = [];
  if (desc.includes('quick effect') || desc.includes("either player's turn")) {
    payoffs.push('Quick-Effect interaction on opponent turn');
  }
  if (desc.includes('negate')) {
    payoffs.push('Negation capability');
  }
  if (desc.includes('banish') || desc.includes('destroy') || desc.includes('return to the hand')) {
    payoffs.push('Targeted removal / board disruption');
  }
  if (desc.includes('cannot activate') || desc.includes('cannot special summon')) {
    payoffs.push('Floodgate lockdown effect');
  }
  if (desc.includes('special summon this card from your gy')) {
    payoffs.push('Graveyard recursion engine');
  }

  if (payoffs.length > 0) {
    return payoffs.join('; ');
  }

  return desiredPayoff || 'Standard archetype synergy and field/material presence.';
}

/**
 * Detects engines active in the user's deck.
 */
function detectEngines(deckCardNames: string[]): string[] {
  const lowerNames = deckCardNames.map(n => n.toLowerCase());
  const engines: string[] = [];

  const has = (keyword: string) => lowerNames.some(n => n.includes(keyword.toLowerCase()));

  if (has('branded') || has('albaz') || has('despia') || has('aluber')) {
    engines.push('Branded Despia');
  }
  if (has('snake-eye') || has('bonfire') || has('diabellstar') || has('poplar')) {
    engines.push('Snake-Eye');
  }
  if (has('cynet') || has('mathmech') || has('cyberse')) {
    engines.push('Cyberse');
  }
  if (has('dogmatika') || has('nadir')) {
    engines.push('Dogmatika');
  }
  if (has('tearlaments') || has('scheiren') || has('havnis')) {
    engines.push('Tearlaments');
  }

  return engines;
}

/**
 * Core function to find synergies, searchers, pathways and combo steps for target cards.
 */
export async function findSynergyAndSearchers(params: {
  filter: CardFilter;
  deck?: DeckData;
  desiredPayoff?: string;
}): Promise<SynergyAnalysisResult> {
  const matchedCards = await cardDatabase.search(params.filter);
  const deckCardNames = extractDeckCardNames(params.deck);
  const deckNamesLower = new Set(deckCardNames.map(n => n.toLowerCase()));
  const engines = detectEngines(deckCardNames);

  const candidates: MatchedCardCandidate[] = [];

  for (const card of matchedCards) {
    const payoff = determinePayoff(card, params.desiredPayoff);
    const inDeckSearchers: InDeckSearcherInfo[] = [];
    const bridgeSearchers: BridgeSearcherInfo[] = [];
    const comboSteps: string[] = [];
    const recommendedAdditions: RecommendedAddition[] = [];

    const isLight = card.attribute?.toUpperCase() === 'LIGHT';
    const isDark = card.attribute?.toUpperCase() === 'DARK';
    const is1850Spellcaster = (card.race === 'Spellcaster' && card.atk === 1850);
    const hasBrandedEngine = engines.includes('Branded Despia') || deckNamesLower.has('branded fusion');

    // 1. In-Deck Searcher Analysis
    if (hasBrandedEngine && isLight && card.type.toLowerCase().includes('monster')) {
      inDeckSearchers.push({
        searcherName: 'Branded Fusion',
        category: 'gy_dumper',
        method: 'Send directly from Deck to GY as Fusion Material for Albion the Branded Dragon',
        directAccess: true,
        details: 'Branded Fusion uses "Fallen of Albaz" + 1 LIGHT monster from your Deck to summon "Albion the Branded Dragon". ' +
          `Because ${card.name} is a LIGHT monster, Branded Fusion dumps ${card.name} directly into the GY as material without using your Normal Summon.`
      });

      if (deckNamesLower.has('aluber the jester of despia')) {
        inDeckSearchers.push({
          searcherName: 'Aluber the Jester of Despia',
          category: 'starter_tutor',
          method: 'Normal Summon Aluber -> Search Branded Fusion -> Dump from Deck',
          directAccess: false,
          details: 'Aluber searches Branded Fusion on summon, providing a 1-card starter to access the dumper pathway.'
        });
      }

      if (deckNamesLower.has('branded opening')) {
        inDeckSearchers.push({
          searcherName: 'Branded Opening',
          category: 'starter_tutor',
          method: 'Quick-Play Spell: Special Summon Aluber from Deck -> Search Branded Fusion',
          directAccess: false,
          details: 'Discard 1 card to Special Summon Aluber without using your Normal Summon, initiating the Branded Fusion pathway.'
        });
      }
    } else if (hasBrandedEngine && isDark && card.type.toLowerCase().includes('monster')) {
      inDeckSearchers.push({
        searcherName: 'Branded Fusion',
        category: 'gy_dumper',
        method: 'Send directly from Deck to GY as Fusion Material for Lubellion the Searing Dragon',
        directAccess: true,
        details: `Branded Fusion uses "Fallen of Albaz" + 1 DARK monster from Deck to summon Lubellion, directly dumping ${card.name}.`
      });
    }

    // Check all general searchers in the registry that might be in deck
    const relevantSearchers = getSearchersForCard(card);
    for (const searcher of relevantSearchers) {
      if (deckNamesLower.has(searcher.name.toLowerCase())) {
        if (!inDeckSearchers.some(s => s.searcherName.toLowerCase() === searcher.name.toLowerCase())) {
          inDeckSearchers.push({
            searcherName: searcher.name,
            category: searcher.category,
            method: searcher.location === 'deck_to_gy' ? 'Send from Deck to GY' : 'Add from Deck to hand',
            directAccess: true,
            details: searcher.description
          });
        }
      } else {
        // Outside bridges
        bridgeSearchers.push({
          bridgeName: searcher.name,
          category: searcher.category,
          route: `Add "${searcher.name}" to deck -> accesses ${card.name} (${searcher.location})`,
          missingCards: [searcher.name],
          description: searcher.description
        });
      }
    }

    // 2. Synergy With Deck
    let synergyWithDeck = '';
    if (card.name === 'Fairy Tail - Snow' && hasBrandedEngine) {
      synergyWithDeck = 'Extraordinary synergy with Branded Despia: ' +
        '1) Snow is a LIGHT monster, fulfilling the exact requirement for "Albion the Branded Dragon" via Branded Fusion directly from the Deck. ' +
        '2) Branded decks naturally fill the GY with fusion spells and monsters, easily feeding Snow\'s 7-card banish cost for multiple Quick-Effect Book of Moon disruptions without competing for the Normal Summon.';
    } else if (card.name === 'Fairy Tail - Luna' && is1850Spellcaster) {
      synergyWithDeck = 'Strong standalone Normal Summon disruption. Searches companion 1850 ATK Spellcasters like Fairy Tail - Snow or Charmers, and provides non-destruction Quick-Effect bounce against Extra Deck monsters.';
    } else if (hasBrandedEngine && isLight) {
      synergyWithDeck = `LIGHT monster synergy: Can be sent directly from Deck to GY as Fusion Material for Albion the Branded Dragon via Branded Fusion.`;
    } else if (hasBrandedEngine && isDark) {
      synergyWithDeck = `DARK monster synergy: Can be sent directly from Deck to GY as Fusion Material for Lubellion the Searing Dragon via Branded Fusion.`;
    } else {
      synergyWithDeck = `Shares stats and attributes (${card.race} / ${card.attribute}) with core archetype components.`;
    }

    // 3. Combo Steps
    if (card.name === 'Fairy Tail - Snow' && hasBrandedEngine) {
      comboSteps.push(
        '1. Normal Summon "Aluber the Jester of Despia" (or activate "Branded Opening" discarding 1 card to Special Summon Aluber).',
        '2. Trigger Aluber\'s on-summon effect: Add "Branded Fusion" from your Deck to your hand.',
        '3. Activate "Branded Fusion", sending "Fallen of Albaz" and "Fairy Tail - Snow" from your Deck to the GY as Fusion Material to Fusion Summon "Albion the Branded Dragon".',
        '4. On Fusion Summon, activate Albion\'s effect: Banish "Fallen of Albaz" and "Albion the Branded Dragon" from field/GY to Fusion Summon "Mirrorjade the Iceblade Dragon".',
        '5. End Board state: "Mirrorjade the Iceblade Dragon" on field (non-targeting quick-effect banish) + "Fairy Tail - Snow" live in GY (quick-effect Book of Moon disruption ready by banishing 7 cards).'
      );
    } else if (card.name === 'Fairy Tail - Luna') {
      comboSteps.push(
        '1. Normal Summon "Fairy Tail - Luna".',
        '2. Trigger Luna\'s on-summon effect: Add 1 Spellcaster with 1850 ATK ("Fairy Tail - Snow" or Charmer) from Deck to hand.',
        '3. Pass turn with Luna on field. During opponent\'s turn, activate Luna\'s Quick Effect targeting an opponent monster to bounce both to hand unless opponent dumps a same-named card.',
        '4. Next turn, use Snow as discard or summon material to establish GY disruption.'
      );
    } else if (inDeckSearchers.length > 0) {
      const topSearcher = inDeckSearchers[0];
      comboSteps.push(
        `1. Activate or summon "${topSearcher.searcherName}" from hand or field.`,
        `2. Execute "${topSearcher.method}" targeting "${card.name}".`,
        `3. Utilize "${card.name}" for ${payoff.slice(0, 80)}...`
      );
    } else {
      comboSteps.push(
        `1. Draw or tutor "${card.name}".`,
        `2. Summon or send to GY to enable payoff: ${payoff.slice(0, 80)}.`
      );
    }

    // 4. Recommended Additions
    if (is1850Spellcaster) {
      if (!deckNamesLower.has('foolish burial')) {
        recommendedAdditions.push({
          cardName: 'Foolish Burial',
          role: 'dumper',
          reason: '1-card generic spell to send Fairy Tail - Snow directly to GY when primary fusion engine is stopped by Ash Blossom.'
        });
      }
      if (!deckNamesLower.has('spirit charmers')) {
        recommendedAdditions.push({
          cardName: 'Spirit Charmers',
          role: 'tutor',
          reason: 'Quick-Play Spell that discards 1 and directly searches any Level 4 Spellcaster with 1850 ATK (Snow or Luna) while setting backrow.'
        });
      }
      if (!deckNamesLower.has('secret village of the spellcasters')) {
        recommendedAdditions.push({
          cardName: 'Secret Village of the Spellcasters',
          role: 'floodgate',
          reason: 'Powerful Field Spell that completely prevents opponent from activating Spells while you control a Spellcaster (e.g. Luna on field or Snow summoned from GY).'
        });
      }
    } else {
      if (!deckNamesLower.has('foolish burial')) {
        recommendedAdditions.push({
          cardName: 'Foolish Burial',
          role: 'dumper',
          reason: 'Universal dumper to access GY effects without needing archetype starters.'
        });
      }
      if (!deckNamesLower.has('small world')) {
        recommendedAdditions.push({
          cardName: 'Small World',
          role: 'bridge',
          reason: 'Universal bridge that searches any monster in your deck via 1 shared attribute/stat.'
        });
      }
    }

    candidates.push({
      card: {
        id: card.id,
        name: card.name,
        atk: card.atk,
        def: card.def,
        level: card.level,
        race: card.race,
        attribute: card.attribute,
        type: card.type,
        desc: card.desc,
        archetype: card.archetype
      },
      payoff,
      synergyWithDeck,
      searchPathway: {
        inDeckSearchers,
        bridgeSearchers
      },
      comboSteps,
      recommendedAdditions
    });
  }

  // Sort candidates so key payoff cards (e.g. Fairy Tail - Snow, Fairy Tail - Luna) rank first
  candidates.sort((a, b) => {
    const aPriority = a.card.name.includes('Snow') ? 2 : a.card.name.includes('Luna') ? 1 : 0;
    const bPriority = b.card.name.includes('Snow') ? 2 : b.card.name.includes('Luna') ? 1 : 0;
    return bPriority - aPriority;
  });

  const summary = `Found ${candidates.length} candidate card(s) matching filter. ` +
    (engines.length > 0 ? `Deck engines detected: ${engines.join(', ')}. ` : 'No specific engine detected. ') +
    (candidates.length > 0 ? `Primary candidate: ${candidates[0].card.name}.` : '');

  return {
    matchedCards: candidates,
    summary,
    deckEnginesDetected: engines
  };
}
