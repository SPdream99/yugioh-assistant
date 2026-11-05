import type { CardPriceQuote, MarketPriceReport, MarketPriceSummary } from '../../types/pricing.js';
import { getTcgPlayerPrices } from './tcgplayer.js';
import { getYuyuteiPrices } from './yuyutei.js';
import { getTcgCornerPrices } from './tcgcorner.js';
import { generateFreshnessEvidence } from '../freshness/freshness-engine.js';

// Approximate baseline exchange rates to USD for multi-market normalization
const FX_RATES_TO_USD: Record<string, number> = {
  USD: 1.0,
  JPY: 1 / 150.0,
  HKD: 1 / 7.8,
  EUR: 1.08,
  GBP: 1.28
};

export function convertToUsd(price: number, currency: string): number {
  const rate = FX_RATES_TO_USD[currency.toUpperCase()] || 1.0;
  return price * rate;
}

/**
 * Aggregates live or estimated card price quotes across Western TCG (TCGPlayer),
 * Japanese OCG (Yuyu-tei), and Asian-English / Asian OCG (TCGCorner) markets.
 */
export async function getMultiMarketPrices(cardName: string, passcode?: number): Promise<MarketPriceReport> {
  const [tcgplayerRes, yuyuteiRes, tcgcornerRes] = await Promise.allSettled([
    getTcgPlayerPrices(cardName, passcode),
    getYuyuteiPrices(cardName),
    getTcgCornerPrices(cardName)
  ]);

  const allQuotes: CardPriceQuote[] = [];

  const tcgplayerQuotes = tcgplayerRes.status === 'fulfilled' ? tcgplayerRes.value : [];
  const yuyuteiQuotes = yuyuteiRes.status === 'fulfilled' ? yuyuteiRes.value : [];
  const tcgcornerQuotes = tcgcornerRes.status === 'fulfilled' ? tcgcornerRes.value : [];

  allQuotes.push(...tcgplayerQuotes, ...yuyuteiQuotes, ...tcgcornerQuotes);

  // Helper to extract lowest valid price for a given platform
  const getLowestPlatformQuote = (platform: 'TCGPlayer' | 'Yuyu-tei' | 'TCGCorner'): CardPriceQuote | undefined => {
    return allQuotes
      .filter(q => (q.platform === platform || (platform === 'TCGCorner' && q.platform.includes('Cardmarket'))) && q.price > 0)
      .sort((a, b) => a.price - b.price)[0];
  };

  const lowestTcg = getLowestPlatformQuote('TCGPlayer');
  const lowestYuyu = getLowestPlatformQuote('Yuyu-tei');
  const lowestCorner = getLowestPlatformQuote('TCGCorner');

  // Compute lowest USD equivalent across all active priced quotes
  const validPricesUsd = allQuotes
    .filter(q => q.price > 0)
    .map(q => ({
      quote: q,
      usdValue: convertToUsd(q.price, q.currency)
    }))
    .sort((a, b) => a.usdValue - b.usdValue);

  const lowestUsd = validPricesUsd.length > 0
    ? parseFloat(validPricesUsd[0].usdValue.toFixed(2))
    : undefined;

  const summary: MarketPriceSummary = {
    lowestUsdEquivalent: lowestUsd,
    enTcg: lowestTcg ? `$${lowestTcg.price.toFixed(2)} USD (${lowestTcg.rarity || 'TCG'})` : 'Check TCGPlayer live link',
    jpOcg: lowestYuyu ? `¥${lowestYuyu.price.toLocaleString()} JPY (${lowestYuyu.rarity || 'OCG'})` : 'Check Yuyu-tei live link',
    aeOcg: lowestCorner
      ? (lowestCorner.currency === 'EUR'
          ? `€${lowestCorner.price.toFixed(2)} EUR (~$${(lowestCorner.price * 8.4).toFixed(2)} HKD / Cardmarket)`
          : `$${lowestCorner.price.toFixed(2)} HKD (${lowestCorner.rarity || 'AE'})`)
      : 'Check TCGCorner live link'
  };

  const liveQuotes = allQuotes.filter(q => !q.isFallback && q.price > 0);
  const fallbackQuotes = allQuotes.filter(q => q.isFallback);

  const freshness = generateFreshnessEvidence({
    sourceUrl: `https://www.tcgplayer.com/search/yugioh/product?q=${encodeURIComponent(cardName)}`,
    sourcePublishedAt: new Date().toISOString(),
    isLiveFetch: liveQuotes.length > 0,
    dataPayload: {
      cardName,
      quotes: allQuotes,
      liveQuoteCount: liveQuotes.length,
      fallbackQuoteCount: fallbackQuotes.length
    }
  });

  return {
    cardName,
    passcode,
    quotes: allQuotes,
    summary,
    timestamp: new Date().toISOString(),
    freshness,
    liveQuoteCount: liveQuotes.length,
    fallbackQuoteCount: fallbackQuotes.length
  } as MarketPriceReport;
}
