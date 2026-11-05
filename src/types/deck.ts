import type { Card } from './card.js';

export interface DeckData {
  name?: string;
  main: (number | string | Card)[];
  extra: (number | string | Card)[];
  side: (number | string | Card)[];
  metadata?: Record<string, any>;
  mainDeck?: any[];
  extraDeck?: any[];
  sideDeck?: any[];
  cards?: any[];
}

export interface ResolvedDeck {
  name?: string;
  main: Card[];
  extra: Card[];
  side: Card[];
  cardCounts: Map<number, number>;
}
