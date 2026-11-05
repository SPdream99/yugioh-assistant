import { Card, CardFilter } from '../../types/card.js';
import { CardDatabase, cardDatabase } from './card-database.js';

export interface ParsedSearchQuery {
  filter: CardFilter;
  semanticTags: string[];
  textKeywords: string[];
}

const SEMANTIC_PATTERNS: Record<string, RegExp> = {
  floodgate: /(cannot activate|cannot special summon|cannot attack|effects are negated|skip your|neither player can|only you control)/i,
  negate: /negate/i,
  'quick effect': /(quick effect|during either player's turn|during your opponent's turn)/i,
  quick: /(quick effect|during either player's turn|during your opponent's turn)/i,
  'hand trap': /(discard this card|send this card from your hand|during either player's turn: you can (discard|send))/i,
  handtrap: /(discard this card|send this card from your hand|during either player's turn: you can (discard|send))/i,
  removal: /(destroy|banish|return .* to the hand|return .* to the deck|send .* to the gy)/i,
  searcher: /add .* from your deck to your hand/i,
  tutor: /add .* from your deck to your hand/i,
  dumper: /send .* from your deck to the gy/i,
  mill: /send .* from your deck to the gy/i
};

/**
 * Parses natural language queries containing field specifiers (e.g., "atk:1850 race:Spellcaster negate")
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const filter: CardFilter = {};
  const semanticTags: string[] = [];
  const textKeywords: string[] = [];

  // Match key:value or key>=value or key<=value
  const tokenRegex = /(\b[a-zA-Z]+)([:=]|>=|<=)([a-zA-Z0-9_\-\/]+)/g;

  let remaining = query;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(query)) !== null) {
    const key = match[1].toLowerCase();
    const op = match[2];
    const val = match[3];

    // Remove token from remaining text
    remaining = remaining.replace(match[0], ' ');

    switch (key) {
      case 'atk':
      case 'attack': {
        const num = parseInt(val, 10);
        if (!isNaN(num)) {
          if (op === '>=') filter.atk = { min: num };
          else if (op === '<=') filter.atk = { max: num };
          else filter.atk = num;
        }
        break;
      }
      case 'def':
      case 'defense': {
        const num = parseInt(val, 10);
        if (!isNaN(num)) {
          if (op === '>=') filter.def = { min: num };
          else if (op === '<=') filter.def = { max: num };
          else filter.def = num;
        }
        break;
      }
      case 'level':
      case 'lvl':
      case 'rank': {
        const num = parseInt(val, 10);
        if (!isNaN(num)) {
          if (op === '>=') filter.level = { min: num };
          else if (op === '<=') filter.level = { max: num };
          else filter.level = num;
        }
        break;
      }
      case 'race': {
        filter.race = val;
        break;
      }
      case 'attr':
      case 'attribute': {
        filter.attribute = val;
        break;
      }
      case 'archetype':
      case 'arch': {
        filter.archetype = val;
        break;
      }
      case 'type':
      case 'cardtype': {
        filter.type = val;
        break;
      }
      case 'name': {
        filter.name = val;
        break;
      }
    }
  }

  // Parse remaining words for semantic tags or plain keywords
  const rawWords = remaining.split(/\s+/).map(w => w.trim().toLowerCase()).filter(Boolean);

  // Check multi-word tags first (like "quick effect", "hand trap")
  const remainingStr = rawWords.join(' ');
  for (const tag of Object.keys(SEMANTIC_PATTERNS)) {
    if (tag.includes(' ') && remainingStr.includes(tag)) {
      semanticTags.push(tag);
    }
  }

  for (const word of rawWords) {
    if (SEMANTIC_PATTERNS[word]) {
      if (!semanticTags.includes(word)) {
        semanticTags.push(word);
      }
    } else if (word === 'monster' || word === 'spell' || word === 'trap') {
      if (!filter.type) {
        filter.type = word;
      }
    } else {
      textKeywords.push(word);
    }
  }

  return { filter, semanticTags, textKeywords };
}

/**
 * Enhanced search function wrapping CardDatabase with natural language query parsing and smart filtering.
 */
export async function cardSearch(
  query: string | CardFilter,
  db: CardDatabase = cardDatabase
): Promise<Card[]> {
  if (typeof query === 'object') {
    return db.search(query);
  }

  const { filter, semanticTags, textKeywords } = parseSearchQuery(query);

  // Execute structural filter
  let results = await db.search(filter);

  // Apply semantic tag filtering if specified
  if (semanticTags.length > 0) {
    results = results.filter(card => {
      const desc = (card.desc || '').toLowerCase();
      return semanticTags.some(tag => {
        const regex = SEMANTIC_PATTERNS[tag];
        return regex ? regex.test(desc) : false;
      });
    });
  }

  // Apply free text keyword filtering if specified
  if (textKeywords.length > 0) {
    results = results.filter(card => {
      const cardText = `${card.name} ${card.desc || ''} ${card.archetype || ''}`.toLowerCase();
      return textKeywords.every(kw => cardText.includes(kw));
    });
  }

  return results;
}

export { CardDatabase, cardDatabase };
