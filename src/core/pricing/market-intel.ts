import { CardDatabase } from '../card-database/ygoprodeck.js';
import type { Card } from '../../types/card.js';
import { getLatestYgoNews, type YgoNewsItem } from '../news-rulings/ygorganization.js';
import { DynamicMetaManager } from '../meta-deck-builder/dynamic-meta-sync.js';
import { generateFreshnessEvidence } from '../freshness/freshness-engine.js';
import {
  buildMarketIndex,
  applyMarketFilter,
  sortMarket,
  priceOf,
  toRanked,
  computeLiquidityScores,
  type MarketRecord,
  type MarketFilter,
  type MarketSort,
  type PriceBasis
} from './market-index.js';
import { computeMovers, describeHistory, recordDailySnapshot, type MoverReport } from './price-history.js';
import { enrichCardMarkets, FX_NOTE } from './market-enrich.js';

export type MarketIntent = 'top_price' | 'movers' | 'explain' | 'search';

export interface MarketQueryInput {
  intent?: MarketIntent;
  query?: string;
  card?: string;
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
  minWeeklyViews?: number;
  priceBasis?: PriceBasis;
  sortBy?: MarketSort;
  windowDays?: number;
  limit?: number;
  includeNews?: boolean;
  includeMarkets?: boolean;
}

export interface Driver {
  type: 'news' | 'banlist' | 'release' | 'demand' | 'collector' | 'meta' | 'data';
  statement: string;
  confidence: 'high' | 'medium' | 'low';
  sourceUrl?: string;
  evidence?: string;
}

export interface NewsMatch {
  title: string;
  pubDate: string;
  link: string;
  matchedOn: string;
  score: number;
}

const NEWS_TTL_MS = 10 * 60 * 1000;
let newsCache: { at: number; items: YgoNewsItem[] } | undefined;

async function loadNews(limit = 30): Promise<YgoNewsItem[]> {
  if (newsCache && Date.now() - newsCache.at < NEWS_TTL_MS) return newsCache.items;
  try {
    const items = await getLatestYgoNews(limit);
    newsCache = { at: Date.now(), items };
    return items;
  } catch {
    return newsCache?.items ?? [];
  }
}

// ---------------------------------------------------------------------------
// Index cache
// ---------------------------------------------------------------------------

let indexCache: { key: string; records: MarketRecord[] } | undefined;

function getRecords(cards: Iterable<Card>): MarketRecord[] {
  const db = CardDatabase.getInstance();
  const key = `${db.cacheTimestamp || 0}:${db.cards.size}`;
  if (indexCache && indexCache.key === key) return indexCache.records;
  const records = buildMarketIndex(cards);
  indexCache = { key, records };
  return records;
}

async function ensureCardPool(): Promise<CardDatabase> {
  const db = CardDatabase.getInstance();
  if (db.cards.size < 1000) {
    // Fresh install: pull the pool once. A failure here is not fatal — the
    // built-in stub set still lets the tool answer, just with a tiny pool.
    await db.fetchCards(false).catch(() => undefined);
  } else {
    // Keep the price index within two days of the source. Failures degrade to
    // the cached pool, and freshness evidence reports the real age.
    await db.ensureFresh(48).catch(() => false);
  }
  return db;
}

// ---------------------------------------------------------------------------
// News correlation
// ---------------------------------------------------------------------------

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/["“”]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchNews(items: YgoNewsItem[], cardName: string, archetype: string | undefined): NewsMatch[] {
  const name = normalize(cardName);
  const arche = archetype ? normalize(archetype) : '';

  const matches: NewsMatch[] = [];
  for (const item of items) {
    const haystack = normalize(`${item.title} ${item.snippet} ${(item.categories || []).join(' ')}`);
    let score = 0;
    let matchedOn = '';

    if (name && haystack.includes(name)) {
      score = 100;
      matchedOn = 'exact card name';
    } else if (arche && arche.length > 2 && haystack.includes(arche)) {
      score = 55;
      matchedOn = `archetype "${archetype}"`;
    }

    // No set-code-only matches: a shared "JUMP" or "SJCS" prefix produces
    // unrelated articles and turns noise into a fake explanation.
    if (score === 0) continue;

    // Banlist articles are a stronger driver than a generic mention.
    if (/banlist|forbidden|limited|unbanned|ban list/i.test(item.title)) score += 25;
    if (item.isCardReveal) score += 10;

    matches.push({
      title: item.title,
      pubDate: item.pubDate,
      link: item.link,
      matchedOn,
      score
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Explain
// ---------------------------------------------------------------------------

function findCard(records: MarketRecord[], needle: string): MarketRecord | undefined {
  const q = needle.trim().toLowerCase();
  if (!q) return undefined;
  return (
    records.find(r => r.name.toLowerCase() === q) ||
    records.find(r => r.name.toLowerCase().includes(q)) ||
    records.find(r => q.includes(r.name.toLowerCase()) && r.name.length > 5)
  );
}

function printingsOf(card: Card | undefined): Array<{ setName: string; setCode: string; rarity: string; priceUsd: number }> {
  const sets = Array.isArray((card as any)?.card_sets) ? (card as any).card_sets : [];
  return sets
    .map((s: any) => ({
      setName: String(s.set_name || ''),
      setCode: String(s.set_code || ''),
      rarity: String(s.set_rarity || ''),
      priceUsd: parseFloat(String(s.set_price || '0')) || 0
    }))
    .filter((p: { priceUsd: number }) => p.priceUsd > 0)
    .sort((a: { priceUsd: number }, b: { priceUsd: number }) => b.priceUsd - a.priceUsd)
    .slice(0, 6);
}

/** Every printing, priced or not: lets the caller name the entry rarity without inventing a price. */
function listedPrintingsOf(card: Card | undefined): Array<{
  setName: string;
  setCode: string;
  rarity: string;
  priceUsd: number;
  hasPrice: boolean;
}> {
  const sets = Array.isArray((card as any)?.card_sets) ? (card as any).card_sets : [];
  return sets
    .map((s: any) => {
      const priceUsd = parseFloat(String(s.set_price || '0')) || 0;
      return {
        setName: String(s.set_name || ''),
        setCode: String(s.set_code || ''),
        rarity: String(s.set_rarity || ''),
        priceUsd,
        hasPrice: priceUsd > 0
      };
    })
    .sort((a: { priceUsd: number }, b: { priceUsd: number }) => b.priceUsd - a.priceUsd)
    .slice(0, 8);
}

async function explain(
  input: MarketQueryInput,
  records: MarketRecord[]
): Promise<Record<string, unknown>> {
  const needle = input.card || input.query || '';
  if (!needle.trim()) {
    return { available: false, reason: 'Pass `card` (or `query`) to explain a card.' };
  }

  const record = findCard(records, needle);
  if (!record) {
    return {
      available: false,
      reason: `No card matched "${needle}" in the ${records.length}-card index.`,
      hint: 'Try the exact English name, or use ygo_search_cards to find it.'
    };
  }

  const db = CardDatabase.getInstance();
  const card = db.getCardById(record.id);
  const printings = printingsOf(card);
  const listedPrintings = listedPrintingsOf(card);

  const news = await loadNews(30);
  const matches = matchNews(news, record.name, record.archetype);

  const drivers: Driver[] = [];

  if (record.banTcg !== 'Unlimited') {
    drivers.push({
      type: 'banlist',
      statement: `Current TCG status is ${record.banTcg} — copy limits directly move demand (and therefore price) for this card.`,
      confidence: 'high',
      sourceUrl: 'https://www.yugioh-card.com/en/limited/'
    });
  }

  for (const match of matches) {
    drivers.push({
      type: 'news',
      statement: `Recent article matches on ${match.matchedOn}: "${match.title}"`,
      confidence: match.score >= 100 ? 'high' : match.score >= 55 ? 'medium' : 'low',
      sourceUrl: match.link,
      evidence: match.pubDate
    });
  }

  const releaseAge = record.releasedTcg
    ? Math.floor((Date.now() - Date.parse(record.releasedTcg)) / 86_400_000)
    : undefined;
  if (releaseAge !== undefined && releaseAge <= 120) {
    drivers.push({
      type: 'release',
      statement: `Released ${releaseAge} day(s) ago (${record.releasedTcg}) — new-set supply is still being absorbed, which is the usual window for price swings.`,
      confidence: 'high'
    });
  }

  if (record.demandScore >= 90 && record.marketUsd > 0) {
    drivers.push({
      type: 'demand',
      statement: `Weekly search interest is in the top ${Math.max(1, 100 - record.demandScore)}% of priced cards (${record.weeklyViews.toLocaleString()} views/week). Search interest is a demand signal, not a measured price change.`,
      confidence: 'medium',
      sourceUrl: 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes'
    });
  }

  const ratio = record.marketUsd > 0 ? record.topUsd / record.marketUsd : 0;
  if (record.marketUsd > 0 && ratio > 5 && ratio <= 25) {
    drivers.push({
      type: 'collector',
      statement: `The top printing (${record.topPrinting?.setCode || 'n/a'} · ${record.topPrinting?.rarity}) is ${Math.round(
        ratio
      )}x the TCGPlayer aggregate — collector demand is priced separately from the playable copy.`,
      confidence: 'high'
    });
  } else if (record.marketUsd > 0 && ratio > 25) {
    drivers.push({
      type: 'data',
      statement: `One printing (${record.topPrinting?.setCode || 'n/a'}) is listed at $${record.topUsd.toFixed(
        2
      )}, ${Math.round(ratio)}x the $${record.marketUsd.toFixed(
        2
      )} TCGPlayer aggregate. That is an asking price or a stale listing, not a traded market — do not report it as the card's value without a completed sale.`,
      confidence: 'high'
    });
  }

  try {
    const archetypes = DynamicMetaManager.getInstance().getTopArchetypes();
    const hit = record.archetype
      ? archetypes.find(a => a.name.toLowerCase() === record.archetype!.toLowerCase())
      : undefined;
    if (hit) {
      drivers.push({
        type: 'meta',
        statement: `Archetype ${hit.name} is in the tracked live top archetypes (tier ${hit.tier}, ${hit.sharePercentage}% share).`,
        confidence: 'medium'
      });
    }
  } catch {
    // Meta cache is optional evidence.
  }

  if (drivers.length === 0) {
    drivers.push({
      type: 'data',
      statement:
        'No banlist change, recent article or release-window signal matched this card. Its price is not being driven by a documented event right now.',
      confidence: 'medium'
    });
  }

  const history = describeHistory();

  return {
    available: true,
    card: {
      id: record.id,
      name: record.name,
      type: record.type,
      archetype: record.archetype,
      attribute: record.attribute,
      race: record.race,
      level: record.level,
      atk: record.atk,
      def: record.def
    },
    price: {
      marketUsd: Number(record.marketUsd.toFixed(2)),
      floorUsd: Number(record.floorUsd.toFixed(2)),
      topPrintingUsd: Number(record.topUsd.toFixed(2)),
      cardmarketEur: Number(record.cardmarketEur.toFixed(2)),
      confidence: record.confidence,
      confidenceRationale: record.confidenceRationale,
      printingsPriced: record.printings,
      printingsListed: record.printingsListed,
      floorPrinting: record.floorPrinting,
      printings,
      listedPrintings
    },
    demand: {
      weeklyViews: record.weeklyViews,
      totalViews: record.views,
      percentile: record.demandScore,
      note: 'Weekly views measure search interest. They are not a price change and must not be reported as one.'
    },
    banlist: { tcg: record.banTcg, ocg: record.banOcg },
    releasedTcg: record.releasedTcg,
    drivers,
    newsMatches: matches,
    history: {
      daysAvailable: history.daysAvailable,
      latest: history.dates[history.dates.length - 1],
      note:
        history.daysAvailable < 2
          ? 'Price history is still accumulating; no measured delta exists yet.'
          : `Measured deltas available back to ${history.dates[0]}.`
    },
    markets: input.includeMarkets === false
      ? undefined
      : {
          fxNote: FX_NOTE,
          cards: await enrichCardMarkets([record.name], 1),
          note: 'US price comes from the ranking index; JP/AE quotes are fetched live for this card only.'
        },
    links: {
      tcgplayer: `https://www.tcgplayer.com/search/yugioh/product?q=${encodeURIComponent(record.name)}`,
      yugipedia: `https://yugipedia.com/wiki/${encodeURIComponent(record.name.replace(/\s+/g, '_'))}`
    },
    caveats: record.notes
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runMarketQuery(input: MarketQueryInput): Promise<Record<string, unknown>> {
  const db = await ensureCardPool();
  const records = getRecords(db.cards.values());
  const intent: MarketIntent = input.intent || (input.card ? 'explain' : input.minPrice !== undefined || input.maxPrice !== undefined ? 'search' : 'top_price');

  const snapshot = recordDailySnapshot(records);
  const history = describeHistory();

  const filter: MarketFilter = {
    query: input.query,
    archetype: input.archetype,
    type: input.type,
    race: input.race,
    attribute: input.attribute,
    levelMin: input.levelMin,
    levelMax: input.levelMax,
    atkMin: input.atkMin,
    atkMax: input.atkMax,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    banlist: input.banlist,
    releasedWithinDays: input.releasedWithinDays,
    minWeeklyViews: input.minWeeklyViews
  };

  const basis: PriceBasis = input.priceBasis || 'market';
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

  const dataset = {
    totalCards: records.length,
    pricedCards: records.filter(r => r.marketUsd > 0).length,
    source: 'YGOPRODeck cardinfo (TCGPlayer/Cardmarket aggregates)',
    sourceUrl: 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes',
    cacheTimestamp: db.cacheTimestamp ? new Date(db.cacheTimestamp).toISOString() : undefined,
    snapshot,
    history: { daysAvailable: history.daysAvailable, latest: history.dates[history.dates.length - 1] }
  };

  const freshness = generateFreshnessEvidence({
    sourceUrl: 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes',
    sourcePublishedAt: db.cacheTimestamp ? new Date(db.cacheTimestamp) : new Date(),
    isLiveFetch: Boolean(db.cacheTimestamp && Date.now() - db.cacheTimestamp < 36 * 3600 * 1000),
    dataPayload: { intent, filter, limit, pricedCards: dataset.pricedCards }
  });

  if (intent === 'explain') {
    const result = await explain(input, records);
    return {
      intent,
      generatedAt: new Date().toISOString(),
      dataset,
      freshness,
      ...result
    };
  }

  const filtered = applyMarketFilter(records.filter(r => r.marketUsd > 0 || r.topUsd > 0), filter, basis);

  if (intent === 'movers') {
    const windowDays = input.windowDays ?? 30;
    const movers: MoverReport = computeMovers(records, windowDays, limit, basis === 'top_printing' ? 'top_printing' : 'market');

    // Without two snapshots, demand leaders answer the spirit of the question
    // ("what is hot right now") — clearly labelled as interest, not price.
    const fallback = movers.available ? [] : sortMarket(filtered, 'demand', basis).slice(0, limit);
    const recentWindow = applyMarketFilter(
      records.filter(r => r.marketUsd > 0 || r.topUsd > 0),
      { ...filter, releasedWithinDays: 120 },
      basis
    );
    const recentReleases = movers.available
      ? []
      : sortMarket(recentWindow, 'demand', basis).slice(0, Math.min(5, limit));

    return {
      intent,
      generatedAt: new Date().toISOString(),
      dataset,
      freshness,
      query: { windowDays, limit, filters: filter },
      movers,
      demandFallback: movers.available
        ? undefined
        : {
            basis: 'weekly_views',
            note:
              'No measured price delta yet. These are the cards with the highest weekly search interest under your filters — a demand signal, not a price increase.',
            results: toRanked(fallback, basis, limit),
            recentReleases: {
              note: 'Separate signal: cards released in the last 120 days, ranked by weekly search interest. New-set supply is still being absorbed, which is when price swings actually happen.',
              results: toRanked(recentReleases, basis, recentReleases.length)
            }
          },
      caveats: [
        'Movers are computed only from our own daily snapshots; every entry reports its baseline and latest date.',
        'Search interest is not price movement. Do not call a demandFallback entry "rising in price".'
      ]
    };
  }

  const sort: MarketSort = input.sortBy || 'price_desc';
  const liquidityScores = sort === 'liquidity_adjusted'
    ? computeLiquidityScores(filtered, basis)
    : undefined;
  const ranked = toRanked(sortMarket(filtered, sort, basis), basis, limit, liquidityScores);

  const top = ranked[0];
  const summary = top
    ? intent === 'top_price'
      ? `Highest ${basis === 'top_printing' ? 'printing' : 'aggregate'} price in this pool: ${top.name} at $${top.priceUsd.toFixed(2)} (confidence ${top.confidence}).`
      : sort === 'liquidity_adjusted'
        ? `${ranked.length} cards matched; ranked by price×demand percentile. Top: ${top.name} at $${top.priceUsd.toFixed(2)}, ${top.weeklyViews.toLocaleString()} views/week, score ${top.liquidityScore}.`
        : `${ranked.length} cards matched; ranked by ${sort} on the ${basis} price. Top: ${top.name} at $${top.priceUsd.toFixed(2)}.`
    : 'No card matched the filters.';

  // A "most expensive" question has two legitimate answers: the playable copy
  // and the collector printing. Show both instead of picking one silently.
  let alternateBasis: Record<string, unknown> | undefined;
  if (intent === 'top_price') {
    const other: PriceBasis = basis === 'top_printing' ? 'market' : 'top_printing';
    alternateBasis = {
      priceBasis: other,
      note:
        other === 'top_printing'
          ? 'Collector view: the most expensive individual printing rather than the typical copy. A single asking price can dominate this list — check each note.'
          : 'Playable view: the typical copy players actually buy.',
      results: toRanked(sortMarket(filtered, 'price_desc', other), other, Math.min(3, limit))
    };
  }

  let newsMatches: NewsMatch[] | undefined;
  if (input.includeNews) {
    const news = await loadNews(30);
    const terms = new Set<string>();
    if (input.query) terms.add(input.query);
    if (input.archetype) terms.add(input.archetype);
    for (const card of ranked.slice(0, 3)) {
      const hit = matchNews(news, card.name, card.archetype);
      if (hit.length > 0) {
        newsMatches = [...(newsMatches || []), ...hit];
      }
    }
    if (newsMatches) {
      const seen = new Set<string>();
      newsMatches = newsMatches.filter(n => (seen.has(n.link) ? false : (seen.add(n.link), true))).slice(0, 8);
    }
  }

  return {
    intent,
    generatedAt: new Date().toISOString(),
    dataset,
    freshness,
    query: { filters: filter, sortBy: sort, priceBasis: basis, limit, matched: filtered.length },
    ranking: sort === 'liquidity_adjusted'
      ? {
          formula: 'sqrt(logPriceNorm × logDemandNorm)',
          priceNorm: 'log10(1 + price) / log10(1 + 10000) — clips at $10,000',
          demandNorm: 'log10(1 + weeklyViews) / log10(1 + 50000) — clips at 50,000 views/week',
          whyThisFormula:
            'price × log(views) fails: a $1,800 / 63-view card scores 3,251 vs 248 for a $58 / 17,481-view card, so the collector card wins. Percentiles fail too: rank compression lets a $370 / 147-view card beat a $69 / 11,888-view one. Absolute log scales make a 277x demand gap (~1.9 decades) outweigh a 30x price gap (~1.5 decades).',
          caution: 'The score is a ranking heuristic, not money and not expected sale value.'
        }
      : undefined,
    results: ranked,
    alternateBasis,
    markets: input.includeMarkets
      ? {
          fxNote: FX_NOTE,
          cards: await enrichCardMarkets(ranked.slice(0, 3).map(r => r.name), 3),
          note: 'Enriched the top 3 results only; the ranking itself is US-based.'
        }
      : undefined,
    newsMatches,
    summary,
    caveats: [
      'Prices are YGOPRODeck aggregates of TCGPlayer/Cardmarket data, not live sale-by-sale listings.',
      'market = YGOPRODeck aggregate TCGPlayer price (the cheapest commonly listed copy); top_printing = most expensive printing; floor = cheapest priced printing. Check priceBasis before comparing numbers.',
      'Cards with no reported price are excluded from price rankings rather than assigned an estimate.',
      'A printing priced 25x above the aggregate is flagged in `notes` as an asking price or stale listing, not a traded market.',
      'confidence high = aggregate + 2 or more priced printings; medium = aggregate only (often because set_price is 0 for every printing); low = listings without a traded price. Read `confidenceRationale` instead of guessing.',
      'Weekly views measure search interest, not demand you can verify as sales. Use minWeeklyViews as a liquidity floor, never as proof a card sells.'
    ]
  };
}

/** Exposed for tests and for reuse by ygo_search_cards. */
export { getRecords as __getMarketRecords, ensureCardPool as __ensureCardPool, priceOf };
