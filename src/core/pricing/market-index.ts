import type { Card } from '../../types/card.js';

/**
 * Market index: one flat, sortable record per card, built from the card database
 * (\`card_prices\`, per-printing \`set_price\`, \`misc_info.views\`).
 *
 * Why this exists: \`ygo_check_prices\` answers "what does THIS card cost". It cannot
 * answer "which card is the most expensive", "what is rising", "what is worth
 * buying under $5" — those need the whole pool in one comparable table.
 *
 * Honesty rules baked into the record:
 *  - A zero price stays zero. We never estimate a missing price.
 *  - \`confidence\` says which number can be trusted (live market vs single printing).
 *  - \`notes\` flags outlier printings (a stale asking price 25x the market average).
 */

export type PriceBasis = 'market' | 'top_printing' | 'floor';

export interface PrintingQuote {
  setName: string;
  setCode: string;
  rarity: string;
  priceUsd: number;
}

export interface MarketRecord {
  id: number;
  name: string;
  type: string;
  archetype?: string;
  attribute?: string;
  race?: string;
  level?: number;
  atk?: number;
  def?: number;

  /** TCGPlayer aggregate market price reported by YGOPRODeck (cheapest typical copy). */
  marketUsd: number;
  /** Cheapest priced printing. */
  floorUsd: number;
  /** Most expensive priced printing (collector value). */
  topUsd: number;
  cardmarketEur: number;
  ebayUsd: number;

  topPrinting?: PrintingQuote;
  /** Every set entry in the dataset, including printings with set_price = 0. */
  printingsListed: number;
  /** Set entries that actually carried a price (these drive floor/top). */
  printings: number;
  /** Cheapest priced printing — the realistic entry copy. */
  floorPrinting?: PrintingQuote;

  views: number;
  weeklyViews: number;

  banTcg: string;
  banOcg: string;
  releasedTcg?: string;
  releasedOcg?: string;

  /** Percentile (0-100) of weekly views inside the priced pool. Demand, not price movement. */
  demandScore: number;
  confidence: 'high' | 'medium' | 'low';
  confidenceRationale: string;
  notes: string[];
}

export interface MarketFilter {
  query?: string;
  archetype?: string;
  type?: string;
  race?: string;
  attribute?: string;
  levelMin?: number;
  levelMax?: number;
  atkMin?: number;
  atkMax?: number;
  minPrice?: number;
  maxPrice?: number;
  banlist?: 'Forbidden' | 'Limited' | 'Semi-Limited' | 'Unlimited';
  releasedWithinDays?: number;
  /** Liquidity floor: exclude collector cards nobody searches for. */
  minWeeklyViews?: number;
}

export type MarketSort =
  | 'price_desc'
  | 'price_asc'
  | 'demand'
  | 'liquidity_adjusted'
  | 'release_desc'
  | 'name_asc';

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const dateToDays = (iso?: string): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  return Math.floor((Date.now() - t) / 86_400_000);
};

/** Placeholder entries ("???") and tokens are not tradeable cards. */
function isTradeable(card: Card): boolean {
  const name = (card.name || '').trim();
  if (!name || name === '???' || name === '?') return false;
  if (/^token$/i.test(name)) return false;
  return true;
}

function extractPrintings(card: any): PrintingQuote[] {
  const sets = Array.isArray(card.card_sets) ? card.card_sets : [];
  return sets
    .map((s: any) => ({
      setName: String(s.set_name || ''),
      setCode: String(s.set_code || ''),
      rarity: String(s.set_rarity || ''),
      priceUsd: num(s.set_price)
    }))
    .filter((p: PrintingQuote) => p.priceUsd > 0)
    .sort((a: PrintingQuote, b: PrintingQuote) => b.priceUsd - a.priceUsd);
}

export function buildMarketIndex(cards: Iterable<Card>): MarketRecord[] {
  const records: MarketRecord[] = [];

  for (const card of cards) {
    if (!isTradeable(card)) continue;

    const anyCard = card as any;
    const prices = anyCard.card_prices?.[0] || {};
    const misc = anyCard.misc_info?.[0] || {};

    const marketUsd = num(prices.tcgplayer_price);
    const printings = extractPrintings(anyCard);
    const listedSets = Array.isArray(anyCard.card_sets) ? anyCard.card_sets : [];
    const floorUsd = printings.length > 0 ? printings[printings.length - 1].priceUsd : 0;
    const topUsd = printings.length > 0 ? printings[0].priceUsd : 0;
    const floorPrinting = printings.length > 0 ? printings[printings.length - 1] : undefined;

    const notes: string[] = [];
    const searches = num(misc.viewsweek);
    const totalViews = num(misc.views);

    if (marketUsd === 0 && topUsd === 0) {
      // No price at all: keep the row for stat filters, but it never enters a price ranking.
      notes.push('No market or printing price reported for this card.');
    } else if (printings.length === 0 && listedSets.length > 0) {
      // Common in YGOPRODeck: the printings are listed but every set_price is 0.
      // Say that explicitly so nobody reads `confidence: medium` as "one printing".
      notes.push(
        `${listedSets.length} printing(s) are listed but none carries a set_price in this dataset, so only the aggregate market price is available.`
      );
    }

    // A single printing priced 25x above the market average is almost always an
    // asking price or a stale listing, not a traded market. Say so instead of
    // letting it top a "most expensive" list unchallenged.
    if (marketUsd > 0 && topUsd > marketUsd * 25 && topUsd > 100) {
      notes.push(
        `Top printing (${printings[0].setCode || printings[0].setName}) is ${Math.round(
          topUsd / marketUsd
        )}x the TCGPlayer aggregate — treat it as an asking price, not a traded one.`
      );
    }

    let confidence: MarketRecord['confidence'];
    let confidenceRationale: string;
    if (marketUsd > 0 && printings.length >= 2) {
      confidence = 'high';
      confidenceRationale = `Aggregate market price plus ${printings.length} priced printings (top ${printings[0].setCode || printings[0].setName}).`;
    } else if (marketUsd > 0) {
      confidence = 'medium';
      confidenceRationale = printings.length === 1
        ? 'Aggregate market price plus a single priced printing; no spread to cross-check.'
        : `Aggregate market price only — ${listedSets.length} printing(s) are listed but none carries a set_price.`;
    } else {
      confidence = 'low';
      confidenceRationale = 'No aggregate market price; only untraded printing listings.';
    }

    records.push({
      id: card.id,
      name: card.name,
      type: card.type,
      archetype: card.archetype,
      attribute: card.attribute,
      race: card.race,
      level: card.level,
      atk: card.atk,
      def: card.def,
      marketUsd,
      floorUsd,
      topUsd,
      cardmarketEur: num(prices.cardmarket_price),
      ebayUsd: num(prices.ebay_price),
      topPrinting: printings[0],
      floorPrinting,
      printingsListed: listedSets.length,
      printings: printings.length,
      views: totalViews,
      weeklyViews: searches,
      banTcg: card.banlist_info?.ban_tcg || 'Unlimited',
      banOcg: card.banlist_info?.ban_ocg || 'Unlimited',
      releasedTcg: typeof misc.tcg_date === 'string' ? misc.tcg_date : undefined,
      releasedOcg: typeof misc.ocg_date === 'string' ? misc.ocg_date : undefined,
      demandScore: 0,
      confidence,
      confidenceRationale,
      notes
    });
  }

  // Percentile rank of weekly views across cards that actually carry a price.
  const priced = records.filter(r => r.marketUsd > 0).map(r => r.weeklyViews).sort((a, b) => a - b);
  if (priced.length > 0) {
    const rankOf = (value: number): number => {
      let lo = 0;
      let hi = priced.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (priced[mid] < value) lo = mid + 1;
        else hi = mid;
      }
      return Math.round((lo / priced.length) * 100);
    };
    for (const record of records) record.demandScore = record.marketUsd > 0 ? rankOf(record.weeklyViews) : 0;
  }

  return records;
}

export function priceOf(record: MarketRecord, basis: PriceBasis): number {
  if (basis === 'top_printing') return record.topUsd || record.marketUsd;
  if (basis === 'floor') return record.floorUsd || record.marketUsd;
  return record.marketUsd || record.topUsd;
}

export function applyMarketFilter(
  records: MarketRecord[],
  filter: MarketFilter,
  basis: PriceBasis = 'market'
): MarketRecord[] {
  const query = filter.query?.trim().toLowerCase();

  return records.filter(record => {
    if (query) {
      const haystack = `${record.name} ${record.archetype || ''} ${record.type}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filter.archetype && !(record.archetype || '').toLowerCase().includes(filter.archetype.toLowerCase())) {
      return false;
    }
    if (filter.type && !record.type.toLowerCase().includes(filter.type.toLowerCase())) return false;
    if (filter.race && (record.race || '').toLowerCase() !== filter.race.toLowerCase()) return false;
    if (filter.attribute && (record.attribute || '').toLowerCase() !== filter.attribute.toLowerCase()) {
      return false;
    }

    if (typeof filter.levelMin === 'number' && (record.level ?? -1) < filter.levelMin) return false;
    if (typeof filter.levelMax === 'number' && (record.level ?? -1) > filter.levelMax) return false;
    if (typeof filter.atkMin === 'number' && (record.atk ?? -1) < filter.atkMin) return false;
    if (typeof filter.atkMax === 'number' && (record.atk ?? -1) > filter.atkMax) return false;

    const price = priceOf(record, basis);
    if (typeof filter.minPrice === 'number' && price < filter.minPrice) return false;
    if (typeof filter.maxPrice === 'number' && price > filter.maxPrice) return false;

    if (filter.banlist && record.banTcg.toLowerCase() !== filter.banlist.toLowerCase()) return false;

    if (typeof filter.releasedWithinDays === 'number') {
      const age = dateToDays(record.releasedTcg);
      if (age === undefined || age > filter.releasedWithinDays) return false;
    }

    if (typeof filter.minWeeklyViews === 'number' && record.weeklyViews < filter.minWeeklyViews) return false;

    return true;
  });
}

export function sortMarket(records: MarketRecord[], sort: MarketSort, basis: PriceBasis = 'market'): MarketRecord[] {
  const copy = [...records];
  switch (sort) {
    case 'price_asc':
      return copy.sort((a, b) => priceOf(a, basis) - priceOf(b, basis) || a.name.localeCompare(b.name));
    case 'demand':
      return copy.sort((a, b) => b.demandScore - a.demandScore || b.weeklyViews - a.weeklyViews);
    case 'liquidity_adjusted': {
      const scores = computeLiquidityScores(copy, basis);
      return copy.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0) || a.name.localeCompare(b.name));
    }
    case 'release_desc':
      return copy.sort((a, b) => (b.releasedTcg || '').localeCompare(a.releasedTcg || ''));
    case 'name_asc':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'price_desc':
    default:
      return copy.sort((a, b) => priceOf(b, basis) - priceOf(a, basis) || a.name.localeCompare(b.name));
  }
}

/**
 * Liquidity-adjusted score = geometric mean of two log-normalised values:
 *   price:  log10(1 + price) / log10(1 + 10,000)
 *   demand: log10(1 + weeklyViews) / log10(1 + 50,000)
 *
 * Why not "price × log(views)": on real data it puts a $1,800 / 63-view card
 * (score 3,251) 13x above a $58 / 17,481-view card (score 248) — the price gap
 * wins. Why not percentiles either: a $370 card with 147 views scored above a
 * $69 card with 11,888 views, because views are rank-compressed at the top
 * (most cards have almost no views).
 *
 * Absolute log scales fix both: a 277x demand gap is ~1.9 decades, a 30x price
 * gap is ~1.5 decades, so demand actually matters. Caps are the observed market
 * ceiling, not a prediction. Score is 0..1 and is NOT money or expected value.
 */
export const LIQUIDITY_PRICE_CAP_USD = 10_000;
export const LIQUIDITY_VIEWS_CAP = 50_000;

export function computeLiquidityScores(records: MarketRecord[], basis: PriceBasis): Map<number, number> {
  const scores = new Map<number, number>();
  const priceCap = Math.log10(1 + LIQUIDITY_PRICE_CAP_USD);
  const demandCap = Math.log10(1 + LIQUIDITY_VIEWS_CAP);

  for (const record of records) {
    const price = priceOf(record, basis);
    if (price <= 0) {
      scores.set(record.id, 0);
      continue;
    }
    const priceNorm = Math.min(1, Math.log10(1 + price) / priceCap);
    const demandNorm = Math.min(1, Math.log10(1 + record.weeklyViews) / demandCap);
    scores.set(record.id, Math.sqrt(priceNorm * demandNorm));
  }

  return scores;
}

/** Ranked view used by every market answer. */
export interface RankedCard {
  rank: number;
  id: number;
  name: string;
  type: string;
  archetype?: string;
  attribute?: string;
  race?: string;
  level?: number;
  atk?: number;
  def?: number;
  priceUsd: number;
  marketUsd: number;
  topPrintingPriceUsd: number;
  topPrinting?: PrintingQuote;
  floorPrinting?: PrintingQuote;
  printingsPriced: number;
  printingsListed: number;
  cardmarketEur: number;
  printings: number;
  weeklyViews: number;
  demandScore: number;
  banTcg: string;
  releasedTcg?: string;
  confidence: MarketRecord['confidence'];
  confidenceRationale: string;
  /** 0..1 composite of price percentile and demand percentile (only for liquidity_adjusted). */
  liquidityScore?: number;
  notes?: string[];
}

export function toRanked(
  records: MarketRecord[],
  basis: PriceBasis,
  limit: number,
  liquidityScores?: Map<number, number>
): RankedCard[] {
  return records.slice(0, limit).map((record, index) => ({
    rank: index + 1,
    id: record.id,
    name: record.name,
    type: record.type,
    archetype: record.archetype,
    attribute: record.attribute,
    race: record.race,
    level: record.level,
    atk: record.atk,
    def: record.def,
    priceUsd: Number(priceOf(record, basis).toFixed(2)),
    marketUsd: Number(record.marketUsd.toFixed(2)),
    topPrintingPriceUsd: Number(record.topUsd.toFixed(2)),
    topPrinting: record.topPrinting,
    floorPrinting: record.floorPrinting,
    printingsPriced: record.printings,
    printingsListed: record.printingsListed,
    cardmarketEur: Number(record.cardmarketEur.toFixed(2)),
    printings: record.printings,
    weeklyViews: record.weeklyViews,
    demandScore: record.demandScore,
    banTcg: record.banTcg,
    releasedTcg: record.releasedTcg,
    confidence: record.confidence,
    confidenceRationale: record.confidenceRationale,
    liquidityScore: liquidityScores ? Number((liquidityScores.get(record.id) || 0).toFixed(3)) : undefined,
    notes: record.notes.length > 0 ? record.notes : undefined
  }));
}
