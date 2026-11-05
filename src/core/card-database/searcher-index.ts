import { Card } from '../../types/card.js';

export type SearcherCategory =
  | 'stat_tutor_1850'
  | 'gy_dumper'
  | 'type_tutor'
  | 'universal_bridge'
  | 'synergy_enabler';

export type SearcherLocation =
  | 'deck_to_hand'
  | 'deck_to_gy'
  | 'deck_to_field'
  | 'extra_to_gy'
  | 'floodgate_field';

export interface SearcherCriteria {
  race?: string | string[];
  attribute?: string | string[];
  atk?: number | { min?: number; max?: number };
  def?: number | { min?: number; max?: number };
  level?: number | { min?: number; max?: number };
  cardType?: string | string[];
  archetype?: string | string[];
  customFilter?: (card: Card) => boolean;
}

export interface SearcherEntry {
  id: string;
  name: string;
  category: SearcherCategory;
  cardType: 'Spell' | 'Trap' | 'Monster';
  location: SearcherLocation;
  description: string;
  costOrRequirement?: string;
  criteria: SearcherCriteria;
  notes?: string;
  tags: string[];
}

export const SEARCHER_REGISTRY: SearcherEntry[] = [
  // 1. Exact ATK 1850 Spellcaster Tutors
  {
    id: 'spirit-charmers',
    name: 'Spirit Charmers',
    category: 'stat_tutor_1850',
    cardType: 'Spell',
    location: 'deck_to_hand',
    costOrRequirement: 'Discard 1 card',
    description: 'Searches Level 4 Spellcaster with 1850 ATK (such as Fairy Tail - Snow, Fairy Tail - Luna, or Familiar-Possessed monsters). Adds 1 to hand and Sets 1 to field.',
    criteria: {
      race: 'Spellcaster',
      level: 4,
      atk: 1850
    },
    notes: 'Quick-Play Spell that directly accesses any 1850 ATK Spellcaster while setting backrow protection.',
    tags: ['1850 ATK', 'Spellcaster', 'Charmer', 'Fairy Tail']
  },
  {
    id: 'grand-spiritual-art-ichirin',
    name: 'Grand Spiritual Art - Ichirin',
    category: 'stat_tutor_1850',
    cardType: 'Spell',
    location: 'deck_to_hand',
    costOrRequirement: 'Reveal 1 Spellcaster with 1850 ATK in hand',
    description: 'Searches 1850 ATK Spellcaster with a different Attribute from your Deck; also negates the first opponent monster effect each turn if you control an 1850 DEF Spellcaster.',
    criteria: {
      race: 'Spellcaster',
      atk: 1850
    },
    notes: 'Continuous field spell tutor that swaps one 1850 Spellcaster into another of a different Attribute.',
    tags: ['1850 ATK', 'Spellcaster', 'Field Spell', 'Negate']
  },
  {
    id: 'fairy-tail-luna',
    name: 'Fairy Tail - Luna',
    category: 'stat_tutor_1850',
    cardType: 'Monster',
    location: 'deck_to_hand',
    costOrRequirement: 'Normal Summon',
    description: 'On Normal Summon: Adds 1 Spellcaster monster with 1850 ATK from Deck to hand (e.g. Fairy Tail - Snow). Also provides Quick-Effect non-destruction bounce.',
    criteria: {
      race: 'Spellcaster',
      atk: 1850
    },
    notes: 'Searches any 1850 ATK Spellcaster immediately upon Normal Summon while functioning as on-field quick disruption.',
    tags: ['1850 ATK', 'Spellcaster', 'Normal Summon Tutor', 'Bounce']
  },

  // 2. GY Dumpers (Send from Deck to GY)
  {
    id: 'foolish-burial',
    name: 'Foolish Burial',
    category: 'gy_dumper',
    cardType: 'Spell',
    location: 'deck_to_gy',
    description: 'Send 1 monster from your Deck to the GY.',
    criteria: {
      cardType: 'Monster'
    },
    notes: 'Universal 1-card dumper for any monster in the game, ideal for activating GY effects.',
    tags: ['Universal Dumper', 'GY Setup', 'Spell']
  },
  {
    id: 'branded-fusion',
    name: 'Branded Fusion',
    category: 'gy_dumper',
    cardType: 'Spell',
    location: 'deck_to_gy',
    costOrRequirement: 'Locks Extra Deck into Fusion Monsters for the turn',
    description: 'Fusion Summons using materials directly from Deck. Sends Fallen of Albaz + 1 LIGHT monster (e.g. Fairy Tail - Snow) for Albion, or Albaz + 1 DARK monster for Lubellion.',
    criteria: {
      customFilter: (card: Card) => {
        const attr = card.attribute?.toUpperCase();
        const isMonster = !card.type || card.type.toLowerCase().includes('monster');
        return isMonster && (attr === 'LIGHT' || attr === 'DARK');
      }
    },
    notes: 'Primary Branded engine starter. Sending Fairy Tail - Snow directly from Deck to GY summons Albion the Branded Dragon, which then bridges into Mirrorjade the Iceblade Dragon.',
    tags: ['Fusion from Deck', 'Branded', 'LIGHT Dumper', 'DARK Dumper', 'Albaz']
  },
  {
    id: 'beatrice-lady-of-the-eternal',
    name: 'Beatrice, Lady of the Eternal',
    category: 'gy_dumper',
    cardType: 'Monster',
    location: 'deck_to_gy',
    costOrRequirement: 'Detach 1 Xyz material (Quick Effect)',
    description: 'Quick Effect: Detach 1 material; send any 1 card from your Deck to the GY.',
    criteria: {},
    notes: 'Universal quick-effect dumper accessible via Rank 6 Xyz summons.',
    tags: ['Rank 6', 'Quick Effect', 'Universal Dumper']
  },
  {
    id: 'granguignol-the-dusk-dragon',
    name: 'Granguignol the Dusk Dragon',
    category: 'gy_dumper',
    cardType: 'Monster',
    location: 'deck_to_gy',
    description: 'If Fusion Summoned: Send 1 Level 6 or higher LIGHT or DARK monster from your Deck or Extra Deck to the GY. Can float into Dogmatika or Despia from Extra Deck.',
    criteria: {
      level: { min: 6 },
      attribute: ['LIGHT', 'DARK']
    },
    notes: 'Branded/Dogmatika bridge summoned using Blazing Cartesia + LIGHT/DARK monster.',
    tags: ['Fusion', 'Level 6+', 'LIGHT/DARK Dumper', 'Dogmatika']
  },
  {
    id: 'nadir-servant',
    name: 'Nadir Servant',
    category: 'gy_dumper',
    cardType: 'Spell',
    location: 'extra_to_gy',
    description: 'Sends 1 monster from Extra Deck to GY, then adds 1 Dogmatika monster or Fallen of Albaz from Deck or GY to hand with ATK <= the sent monster.',
    criteria: {
      archetype: ['Dogmatika', 'Albaz Dragon']
    },
    notes: 'Extra Deck dumper and searcher that bridges Dogmatika and Branded lines.',
    tags: ['Extra Deck Dumper', 'Dogmatika', 'Albaz']
  },
  {
    id: 'armageddon-knight',
    name: 'Armageddon Knight',
    category: 'gy_dumper',
    cardType: 'Monster',
    location: 'deck_to_gy',
    costOrRequirement: 'Normal/Flip/Special Summon',
    description: 'When this card is Summoned: You can send 1 DARK monster from your Deck to the GY.',
    criteria: {
      attribute: 'DARK',
      cardType: 'Monster'
    },
    notes: 'Classic DARK monster dumper on summon.',
    tags: ['DARK', 'Monster Dumper', 'Level 4 Warrior']
  },
  {
    id: 'dark-grepher',
    name: 'Dark Grepher',
    category: 'gy_dumper',
    cardType: 'Monster',
    location: 'deck_to_gy',
    costOrRequirement: 'Discard 1 DARK monster',
    description: 'Discard 1 DARK monster; send 1 DARK monster from your Deck to the GY. Can Special Summon itself by discarding a Level 5+ DARK.',
    criteria: {
      attribute: 'DARK',
      cardType: 'Monster'
    },
    notes: 'High-speed DARK graveyard setup engine.',
    tags: ['DARK', 'Monster Dumper', 'Hand Discard']
  },

  // 3. Type Tutors
  {
    id: 'cynet-mining',
    name: 'Cynet Mining',
    category: 'type_tutor',
    cardType: 'Spell',
    location: 'deck_to_hand',
    costOrRequirement: 'Send 1 card from hand to GY',
    description: 'Add 1 Level 4 or lower Cyberse monster from your Deck to your hand.',
    criteria: {
      race: 'Cyberse',
      level: { max: 4 }
    },
    notes: 'Universal tutor for Cyberse starters like Mathmech Circular, Cyberse Gadget, Lady Debug.',
    tags: ['Cyberse', 'Level 4 or lower', 'Normal Spell']
  },
  {
    id: 'fossil-dig',
    name: 'Fossil Dig',
    category: 'type_tutor',
    cardType: 'Spell',
    location: 'deck_to_hand',
    description: 'Add 1 Level 6 or lower Dinosaur monster from your Deck to your hand.',
    criteria: {
      race: 'Dinosaur',
      level: { max: 6 }
    },
    notes: 'Non-once-per-turn tutor for Dinosaurs such as Souleating Oviraptor or Misc.',
    tags: ['Dinosaur', 'Level 6 or lower', 'Normal Spell']
  },
  {
    id: 'e-emergency-call',
    name: 'E - Emergency Call',
    category: 'type_tutor',
    cardType: 'Spell',
    location: 'deck_to_hand',
    description: 'Add 1 "Elemental HERO" monster from your Deck to your hand.',
    criteria: {
      archetype: 'Elemental HERO',
      cardType: 'Monster'
    },
    notes: 'Primary HERO searcher for Stratos, Shadow Mist, Liquid Soldier.',
    tags: ['HERO', 'Elemental HERO', 'Warrior']
  },
  {
    id: 'a-hero-lives',
    name: 'A Hero Lives',
    category: 'type_tutor',
    cardType: 'Spell',
    location: 'deck_to_field',
    costOrRequirement: 'Pay half your LP while controlling no face-up monsters',
    description: 'Special Summon 1 Level 4 or lower "Elemental HERO" monster from your Deck.',
    criteria: {
      archetype: 'Elemental HERO',
      level: { max: 4 }
    },
    notes: 'Summons Stratos or Shadow Mist directly from Deck without using Normal Summon.',
    tags: ['HERO', 'Special Summon from Deck']
  },
  {
    id: 'reinforcement-of-the-army',
    name: 'Reinforcement of the Army',
    category: 'type_tutor',
    cardType: 'Spell',
    location: 'deck_to_hand',
    description: 'Add 1 Level 4 or lower Warrior monster from your Deck to your hand.',
    criteria: {
      race: 'Warrior',
      level: { max: 4 }
    },
    notes: 'Universal searcher for any Level 4 or lower Warrior.',
    tags: ['Warrior', 'Level 4 or lower', 'ROTA']
  },
  {
    id: 'king-of-the-feral-imps',
    name: 'King of the Feral Imps',
    category: 'type_tutor',
    cardType: 'Monster',
    location: 'deck_to_hand',
    costOrRequirement: 'Detach 1 Xyz material',
    description: 'Detach 1 material from this card; add 1 Reptile monster from your Deck to your hand.',
    criteria: {
      race: 'Reptile'
    },
    notes: 'Rank 4 Xyz generic tutor for Reptile engines (Ogdoadic, Snake Rain, Nauya).',
    tags: ['Reptile', 'Rank 4 Xyz']
  },
  {
    id: 'gallant-granite',
    name: 'Gallant Granite',
    category: 'type_tutor',
    cardType: 'Monster',
    location: 'deck_to_hand',
    costOrRequirement: 'Detach 1 Xyz material',
    description: 'Detach 1 material from this card; add 1 Rock monster from your Deck to your hand (or Special Summon from hand face-down).',
    criteria: {
      race: 'Rock'
    },
    notes: 'Rank 4 Xyz generic tutor for Rock monsters (Nibiru, the Primal Being, Block Dragon, Adamancipator).',
    tags: ['Rock', 'Rank 4 Xyz', 'Nibiru Searcher']
  },
  {
    id: 'bonfire',
    name: 'Bonfire',
    category: 'type_tutor',
    cardType: 'Spell',
    location: 'deck_to_hand',
    description: 'Add 1 Level 4 or lower Pyro monster from your Deck to your hand.',
    criteria: {
      race: 'Pyro',
      level: { max: 4 }
    },
    notes: 'Essential Snake-Eye and Volcanic starter (searches Snake-Eye Ash, Snake-Eyes Poplar).',
    tags: ['Pyro', 'Level 4 or lower', 'Snake-Eye']
  },
  {
    id: 'emergency-teleport',
    name: 'Emergency Teleport',
    category: 'type_tutor',
    cardType: 'Spell',
    location: 'deck_to_field',
    description: 'Special Summon 1 Level 3 or lower Psychic monster from your hand or Deck, but banish it during the End Phase.',
    criteria: {
      race: 'Psychic',
      level: { max: 3 }
    },
    notes: 'Quick-Play spell summoning Psychic monsters (Ghost Ogre, Noh-P.U.N.K. Ze Amin) straight from Deck.',
    tags: ['Psychic', 'Quick-Play', 'Special Summon from Deck']
  },

  // 4. Universal Bridges
  {
    id: 'small-world',
    name: 'Small World',
    category: 'universal_bridge',
    cardType: 'Spell',
    location: 'deck_to_hand',
    costOrRequirement: 'Reveal 1 monster in hand, banish 2 monsters face-down',
    description: 'Bridges any monster to another via an intermediate monster in Deck sharing exactly 1 property (Type, Attribute, Level, ATK, or DEF).',
    criteria: {
      cardType: 'Monster'
    },
    notes: 'Calculates 1-property shared bridges to find any target monster from any starting hand monster.',
    tags: ['Universal Bridge', 'Hand to Hand', 'Consistency']
  },
  {
    id: 'chaos-space',
    name: 'Chaos Space',
    category: 'universal_bridge',
    cardType: 'Spell',
    location: 'deck_to_hand',
    costOrRequirement: 'Send 1 LIGHT or DARK monster from hand to GY',
    description: 'Send 1 LIGHT or DARK monster from hand to GY; add 1 LIGHT or DARK monster that cannot be Normal Summoned/Set from Deck to hand with opposite Attribute, Level 4-8.',
    criteria: {
      attribute: ['LIGHT', 'DARK']
    },
    notes: 'Searches Black Dragon Collapserpent, White Dragon Wyverburster, Chaos Dragon Levianeer, etc.',
    tags: ['Chaos', 'LIGHT/DARK', 'Special Summon Only']
  },

  // 5. Synergy & Floodgate Enablers
  {
    id: 'secret-village-of-the-spellcasters',
    name: 'Secret Village of the Spellcasters',
    category: 'synergy_enabler',
    cardType: 'Spell',
    location: 'floodgate_field',
    description: 'If only you control a Spellcaster monster, your opponent cannot activate Spell Cards. Pairs with 1850 Spellcasters like Fairy Tail - Snow, Fairy Tail - Luna, and Charmers.',
    criteria: {
      race: 'Spellcaster'
    },
    notes: 'Lethal floodgate lock when paired with self-summoning Spellcasters like Fairy Tail - Snow or Luna.',
    tags: ['Floodgate', 'Spellcaster', 'Spell Lock', 'Field Spell']
  }
];

export function matchesCriteria(searcher: SearcherEntry, card: Card): boolean {
  const c = searcher.criteria;
  if (!c) return true;

  if (c.customFilter && !c.customFilter(card)) {
    return false;
  }

  if (c.race) {
    const races = Array.isArray(c.race) ? c.race : [c.race];
    if (!card.race || !races.some(r => r.toLowerCase() === card.race?.toLowerCase())) {
      return false;
    }
  }

  if (c.attribute) {
    const attrs = Array.isArray(c.attribute) ? c.attribute : [c.attribute];
    if (!card.attribute || !attrs.some(a => a.toLowerCase() === card.attribute?.toLowerCase())) {
      return false;
    }
  }

  if (c.cardType) {
    const types = Array.isArray(c.cardType) ? c.cardType : [c.cardType];
    if (!card.type || !types.some(t => card.type.toLowerCase().includes(t.toLowerCase()))) {
      return false;
    }
  }

  if (c.archetype) {
    const archs = Array.isArray(c.archetype) ? c.archetype : [c.archetype];
    if (!card.archetype || !archs.some(a => card.archetype?.toLowerCase().includes(a.toLowerCase()))) {
      return false;
    }
  }

  if (c.atk !== undefined) {
    if (typeof c.atk === 'number' && card.atk !== c.atk) return false;
    if (typeof c.atk === 'object') {
      if (c.atk.min !== undefined && (card.atk === undefined || card.atk < c.atk.min)) return false;
      if (c.atk.max !== undefined && (card.atk === undefined || card.atk > c.atk.max)) return false;
    }
  }

  if (c.def !== undefined) {
    if (typeof c.def === 'number' && card.def !== c.def) return false;
    if (typeof c.def === 'object') {
      if (c.def.min !== undefined && (card.def === undefined || card.def < c.def.min)) return false;
      if (c.def.max !== undefined && (card.def === undefined || card.def > c.def.max)) return false;
    }
  }

  if (c.level !== undefined) {
    if (typeof c.level === 'number' && card.level !== c.level) return false;
    if (typeof c.level === 'object') {
      if (c.level.min !== undefined && (card.level === undefined || card.level < c.level.min)) return false;
      if (c.level.max !== undefined && (card.level === undefined || card.level > c.level.max)) return false;
    }
  }

  return true;
}

export function getSearchersForCard(card: Card): SearcherEntry[] {
  return SEARCHER_REGISTRY.filter(entry => matchesCriteria(entry, card));
}

export interface SmallWorldBridgeResult {
  bridgeCard: Card;
  sharedWithStarter: string;
  sharedWithTarget: string;
}

export function checkSmallWorldConnection(a: Card, b: Card): { matchCount: number; matchedProps: string[] } {
  const matchedProps: string[] = [];
  if (a.race && b.race && a.race.toLowerCase() === b.race.toLowerCase()) matchedProps.push('Race: ' + a.race);
  if (a.attribute && b.attribute && a.attribute.toLowerCase() === b.attribute.toLowerCase()) matchedProps.push('Attribute: ' + a.attribute);
  if (a.level !== undefined && b.level !== undefined && a.level === b.level) matchedProps.push('Level: ' + a.level);
  if (a.atk !== undefined && b.atk !== undefined && a.atk === b.atk) matchedProps.push('ATK: ' + a.atk);
  if (a.def !== undefined && b.def !== undefined && a.def === b.def) matchedProps.push('DEF: ' + a.def);

  return {
    matchCount: matchedProps.length,
    matchedProps
  };
}

export function calculateSmallWorldBridges(starter: Card, target: Card, pool: Card[]): SmallWorldBridgeResult[] {
  const bridges: SmallWorldBridgeResult[] = [];

  for (const bridge of pool) {
    if (bridge.name === starter.name || bridge.name === target.name) continue;

    const conn1 = checkSmallWorldConnection(starter, bridge);
    if (conn1.matchCount !== 1) continue;

    const conn2 = checkSmallWorldConnection(bridge, target);
    if (conn2.matchCount !== 1) continue;

    bridges.push({
      bridgeCard: bridge,
      sharedWithStarter: conn1.matchedProps[0],
      sharedWithTarget: conn2.matchedProps[0]
    });
  }

  return bridges;
}
