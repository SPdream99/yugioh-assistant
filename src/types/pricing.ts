import type { FreshnessEvidence } from '../core/freshness/freshness-engine.js';

export type PricingPlatform = 'TCGPlayer' | 'Yuyu-tei' | 'TCGCorner';

export interface CardPriceQuote {
  platform: PricingPlatform;
  currency: string;
  price: number;
  rarity?: string;
  url: string;
  inStock?: boolean;
  details?: string;
  /** True when this quote is only a search link because the live source failed. */
  isFallback?: boolean;
  source?: "live" | "fallback";
}

export interface MarketPriceSummary {
  lowestUsdEquivalent?: number;
  enTcg?: string;
  jpOcg?: string;
  aeOcg?: string;
}

export interface MarketPriceReport {
  cardName: string;
  passcode?: number;
  quotes: CardPriceQuote[];
  summary: MarketPriceSummary;
  timestamp: string;
  freshness?: FreshnessEvidence;
  liveQuoteCount?: number;
  fallbackQuoteCount?: number;
}
