import type { CardPriceQuote } from '../../types/pricing.js';
import { getYuyuteiPrices } from './yuyutei.js';
import { getTcgCornerPrices } from './tcgcorner.js';

/**
 * Per-card multi-market enrichment.
 *
 * The ranking index is US-centric on purpose: Yuyu-tei has no bulk price feed,
 * and TCGCorner is a Shopify store with fuzzy search. Scraping both for 14,000
 * cards is neither possible nor honest. So the ranking stays on TCGPlayer /
 * Cardmarket aggregates, and multi-market quotes are attached only to the
 * handful of cards actually being discussed — with a per-source status so a
 * failure is never dressed up as a price.
 */

const FX_TO_USD: Record<string, number> = {
  USD: 1,
  JPY: 1 / 150,
  HKD: 1 / 7.8,
  EUR: 1.08,
  GBP: 1.28
};

export const FX_NOTE =
  'Currency conversion uses fixed reference rates (JPY 150/USD, HKD 7.8/USD, EUR 1.08/USD), not live FX. Shipping, import duty and buyer premiums are excluded. Each market shows its cheapest live listing, which can be a different printing or condition than the US aggregate — a gap is not automatically arbitrage.';

export interface EnrichedQuote {
  platform: CardPriceQuote['platform'];
  currency: string;
  price: number;
  priceUsd: number;
  rarity?: string;
  url: string;
  inStock?: boolean;
  details?: string;
}

export interface CardMarketEnrichment {
  card: string;
  jp?: EnrichedQuote;
  ae?: EnrichedQuote;
  status: {
    yuyutei: 'live' | 'unavailable';
    tcgcorner: 'live' | 'unavailable';
  };
  note: string;
}

function pickLowest(quotes: CardPriceQuote[]): EnrichedQuote | undefined {
  const live = quotes
    .filter(q => q.price > 0 && !q.isFallback)
    .sort((a, b) => a.price * (FX_TO_USD[a.currency] ?? 1) - b.price * (FX_TO_USD[b.currency] ?? 1));
  const best = live[0];
  if (!best) return undefined;
  return {
    platform: best.platform,
    currency: best.currency,
    price: best.price,
    priceUsd: Number((best.price * (FX_TO_USD[best.currency] ?? 1)).toFixed(2)),
    rarity: best.rarity,
    url: best.url,
    inStock: best.inStock,
    details: best.details
  };
}

async function enrichOne(cardName: string): Promise<CardMarketEnrichment> {
  const [jpRes, aeRes] = await Promise.allSettled([
    getYuyuteiPrices(cardName),
    getTcgCornerPrices(cardName)
  ]);

  const jpQuotes = jpRes.status === 'fulfilled' ? jpRes.value : [];
  const aeQuotes = aeRes.status === 'fulfilled' ? aeRes.value : [];

  const jp = pickLowest(jpQuotes);
  const ae = pickLowest(aeQuotes);

  const notes: string[] = [];
  if (!jp) notes.push('Yuyu-tei (JP OCG): no matching live listing.');
  if (!ae) notes.push('TCGCorner (AE): no matching live listing.');

  return {
    card: cardName,
    jp,
    ae,
    status: {
      yuyutei: jp ? 'live' : 'unavailable',
      tcgcorner: ae ? 'live' : 'unavailable'
    },
    note: notes.length > 0 ? notes.join(' ') : 'Both secondary markets returned a matching live listing.'
  };
}

/** Bounded, batched enrichment. Never throws: a dead source degrades to `unavailable`. */
export async function enrichCardMarkets(cardNames: string[], limit = 3): Promise<CardMarketEnrichment[]> {
  const targets = cardNames.slice(0, Math.max(1, Math.min(limit, 10)));
  const results: CardMarketEnrichment[] = [];

  for (let i = 0; i < targets.length; i += 3) {
    const batch = targets.slice(i, i + 3);
    const settled = await Promise.allSettled(batch.map(name => enrichOne(name)));
    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j];
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      } else {
        results.push({
          card: batch[j],
          status: { yuyutei: 'unavailable', tcgcorner: 'unavailable' },
          note: 'Enrichment failed for this card.'
        });
      }
    }
  }

  return results;
}
