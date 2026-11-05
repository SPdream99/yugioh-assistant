/**
 * Deck cost and cross-market comparison.
 *
 * Prices come from the existing multi-market aggregator (TCGPlayer, Yuyu-tei,
 * TCGCorner). Because each card needs a network round trip, the tool prices a
 * bounded number of unique cards and reports `partial: true` when it stops early
 * instead of inventing numbers.
 *
 * No currency conversion or shipping is applied: those are not in the sources.
 */

import { getMultiMarketPrices, convertToUsd } from "./price-aggregator.js";

export interface CardCost {
  name: string;
  passcode?: number;
  copies: number;
  markets: Record<string, number | null>;
  cheapest?: { market: string; price: number };
  error?: string;
}

export interface DeckCostReport {
  available: boolean;
  pricedCards: number;
  totalCards: number;
  partial: boolean;
  currency: string;
  totals: Record<string, number>;
  cheapestMarket?: string;
  cheapestTotal?: number;
  mostExpensiveTotal?: number;
  potentialSaving?: number;
  cards: CardCost[];
  reason?: string;
  notes: string[];
}

export interface DeckCostOptions {
  /** Unique cards with the number of copies in the deck. */
  cards: Array<{ name: string; passcode?: number; copies: number }>;
  /** Maximum unique cards to price (default 15, max 30). */
  maxCards?: number;
  /** Hard time budget; stops early and marks the result partial. */
  timeBudgetMs?: number;
}

function cheapestOf(markets: Record<string, number | null>): { market: string; price: number } | undefined {
  const entries = Object.entries(markets).filter(([, price]) => typeof price === "number" && price > 0) as Array<[string, number]>;
  if (entries.length === 0) return undefined;
  const [market, price] = entries.sort((a, b) => a[1] - b[1])[0];
  return { market, price };
}

export async function computeDeckCost(options: DeckCostOptions): Promise<DeckCostReport> {
  const notes = [
    "Prices are the aggregator's per-market values; no FX conversion or shipping is applied.",
    "A card with no listing in a market is counted as null, not as zero."
  ];

  const cards = (options.cards || []).filter((c) => c && c.name);
  if (cards.length === 0) {
    return {
      available: false,
      pricedCards: 0,
      totalCards: 0,
      partial: false,
      currency: "USD",
      totals: {},
      cards: [],
      reason: "No cards supplied.",
      notes
    };
  }

  const limit = Math.max(1, Math.min(options.maxCards ?? 15, 30));
  const budget = options.timeBudgetMs ?? 45_000;
  const started = Date.now();
  const priced: CardCost[] = [];
  const totals: Record<string, number> = {};
  let partial = false;

  for (const card of cards.slice(0, limit)) {
    if (Date.now() - started > budget) {
      partial = true;
      break;
    }
    try {
      const report = await getMultiMarketPrices(card.name, card.passcode);
      const markets: Record<string, number | null> = {};
      for (const quote of (report as any).quotes || []) {
        const platform = String(quote.platform || "unknown");
        const key = platform.includes("Cardmarket") ? "TCGCorner" : platform;
        const usd = convertToUsd(Number(quote.price) || 0, String(quote.currency || "USD"));
        if (!Number.isFinite(usd) || usd <= 0) continue;
        markets[key] = markets[key] === null || markets[key] === undefined ? Math.round(usd * 100) / 100 : Math.min(markets[key] as number, Math.round(usd * 100) / 100);
      }
      const cheapest = cheapestOf(markets);
      priced.push({ name: card.name, passcode: card.passcode, copies: card.copies, markets, cheapest });
      for (const [market, price] of Object.entries(markets)) {
        if (typeof price === "number" && price > 0) {
          totals[market] = Math.round(((totals[market] || 0) + price * card.copies) * 100) / 100;
        }
      }
    } catch (error) {
      priced.push({ name: card.name, passcode: card.passcode, copies: card.copies, markets: {}, error: (error as Error).message });
    }
  }

  if (cards.length > limit) partial = true;

  const totalsWithValues = Object.entries(totals).filter(([, value]) => value > 0);
  const cheapestMarket = totalsWithValues.sort((a, b) => a[1] - b[1])[0];
  const mostExpensive = totalsWithValues.sort((a, b) => b[1] - a[1])[0];

  return {
    available: priced.some((c) => Object.keys(c.markets).length > 0),
    pricedCards: priced.filter((c) => Object.keys(c.markets).length > 0).length,
    totalCards: cards.reduce((sum, c) => sum + c.copies, 0),
    partial,
    currency: "USD",
    totals,
    cheapestMarket: cheapestMarket?.[0],
    cheapestTotal: cheapestMarket?.[1],
    mostExpensiveTotal: mostExpensive?.[1],
    potentialSaving: cheapestMarket && mostExpensive ? Math.round((mostExpensive[1] - cheapestMarket[1]) * 100) / 100 : undefined,
    cards: priced,
    notes: partial
      ? [...notes, `Partial result: priced ${priced.length} of ${cards.length} unique cards within the budget.`]
      : notes
  };
}
