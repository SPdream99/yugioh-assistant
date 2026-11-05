import type { DeckData } from '../../types/deck.js';

export interface DeckValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Parses YDK formatted text content into DeckData structure.
 */
export function parseYdk(content: string, name?: string): DeckData {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const main: number[] = [];
  const extra: number[] = [];
  const side: number[] = [];
  const metadata: Record<string, any> = {};
  let deckName = name;

  type Section = 'main' | 'extra' | 'side' | 'header';
  let currentSection: Section = 'header';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const lower = line.toLowerCase();
    if (lower.startsWith('#created by')) {
      const creator = line.substring(11).trim();
      metadata['createdBy'] = creator;
      if (!deckName && creator) {
        deckName = creator;
      }
      continue;
    }

    if (lower === '#main') {
      currentSection = 'main';
      continue;
    }

    if (lower === '#extra') {
      currentSection = 'extra';
      continue;
    }

    if (lower === '!side') {
      currentSection = 'side';
      continue;
    }

    // Ignore other comments starting with #
    if (line.startsWith('#')) {
      continue;
    }

    // Parse passcode
    const passcode = parseInt(line, 10);
    if (!isNaN(passcode) && passcode > 0) {
      if (currentSection === 'extra') {
        extra.push(passcode);
      } else if (currentSection === 'side') {
        side.push(passcode);
      } else {
        // Defaults to main deck if no section or in main section
        main.push(passcode);
      }
    }
  }

  return {
    name: deckName,
    main,
    extra,
    side,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  };
}

/**
 * Formats DeckData into standard YDK file string.
 */
export function formatYdk(deck: DeckData): string {
  const createdBy = deck.metadata?.createdBy || deck.name || 'YuGiOh Assistant';
  const itemToString = (item: any): string => {
    if (typeof item === 'number') return item.toString();
    if (typeof item === 'string') return item;
    return item && typeof item.id === 'number' ? item.id.toString() : '';
  };

  const lines: string[] = [
    `#created by ${createdBy}`,
    '#main',
    ...deck.main.map(itemToString).filter(Boolean),
    '#extra',
    ...(deck.extra || []).map(itemToString).filter(Boolean),
    '!side',
    ...(deck.side || []).map(itemToString).filter(Boolean),
    ''
  ];

  return lines.join('\n');
}

/**
 * Validates a deck against official Yu-Gi-Oh deck building rules and optional banlist.
 */
export function validateDeck(
  deck: DeckData,
  banlist?: Record<number, number>
): DeckValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const extra = deck.extra || [];
  const side = deck.side || [];

  // 1. Main Deck size rule: 40 - 60 cards
  if (deck.main.length < 40) {
    errors.push(`Main deck must contain at least 40 cards (currently has ${deck.main.length}).`);
  } else if (deck.main.length > 60) {
    errors.push(`Main deck cannot exceed 60 cards (currently has ${deck.main.length}).`);
  } else if (deck.main.length > 50) {
    warnings.push(`Main deck has ${deck.main.length} cards (consider trimming closer to 40 for optimal consistency).`);
  }

  // 2. Extra Deck size rule: 0 - 15 cards
  if (extra.length > 15) {
    errors.push(`Extra deck cannot exceed 15 cards (currently has ${extra.length}).`);
  }

  // 3. Side Deck size rule: 0 - 15 cards
  if (side.length > 15) {
    errors.push(`Side deck cannot exceed 15 cards (currently has ${side.length}).`);
  }

  // Advisory warnings
  if (extra.length === 0) {
    warnings.push('Extra deck is empty.');
  }
  if (side.length === 0) {
    warnings.push('Side deck is empty.');
  }

  // 4. Card copy limits across all sections
  const cardCounts = new Map<number | string, number>();
  const allCards = [...deck.main, ...extra, ...side];

  for (const item of allCards) {
    const key = typeof item === 'object' && item !== null && 'id' in item ? item.id : item;
    cardCounts.set(key, (cardCounts.get(key) || 0) + 1);
  }

  for (const [id, count] of cardCounts.entries()) {
    // Standard rule: Max 3 copies
    if (count > 3) {
      errors.push(`Card ${id} exceeds maximum allowed copies of 3 (has ${count} copies across main, extra, side).`);
    }

    // Banlist rule check if provided
    if (banlist && typeof id === 'number' && Object.prototype.hasOwnProperty.call(banlist, id)) {
      const maxAllowed = banlist[id];
      if (count > maxAllowed) {
        errors.push(`Card ${id} exceeds banlist limit of ${maxAllowed} (has ${count} copies).`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
