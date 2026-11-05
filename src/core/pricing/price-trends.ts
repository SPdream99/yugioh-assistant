import axios from 'axios';
import { CardDatabase } from '../card-database/ygoprodeck.js';
import { getMultiMarketPrices } from './price-aggregator.js';
import { fetchYugipediaCardInfo, type YugipediaCardInfo } from '../card-database/yugipedia.js';
import { generateFreshnessEvidence, FreshnessEvidence } from '../freshness/freshness-engine.js';
import { SupportedFormat } from '../banlist/banlist-manager.js';
import { DynamicMetaManager } from '../meta-deck-builder/dynamic-meta-sync.js';
import type { Card } from '../../types/card.js';

export interface CardSetPriceDetail {
  setName: string;
  setCode: string;
  rarity: string;
  setPrice: number;
}

export interface CardDetailedMarketReport {
  id: number;
  name: string;
  type: string;
  attribute?: string;
  race?: string;
  level?: number;
  atk?: number;
  def?: number;
  desc: string;
  archetype?: string;
  banlistStatus: {
    tcg: string;
    ocg: string;
  };
  marketSummary: {
    lowestUsdEquivalent?: number;
    enTcg?: string;
    jpOcg?: string;
    aeOcg?: string;
  };
  printingsCount: number;
  setPrintings: CardSetPriceDetail[];
  popularityMetrics: {
    totalViews: number;
    weeklyViews: number;
    marketDemand: 'HOT' | 'RISING' | 'STABLE' | 'LOW';
    trendReason: string;
  };
  yugipedia?: {
    url: string;
    japaneseName?: string;
    romajiName?: string;
    translatedNames?: Record<string, string>;
    triviaUrl: string;
    tipsUrl: string;
    rulingsUrl: string;
  };
  freshness?: FreshnessEvidence;
}

export interface TrendingCardEntry {
  rank: number;
  name: string;
  id: number;
  category: 'Hand Trap' | 'Board Breaker' | 'Engine Pillar' | 'Extra Deck' | 'Rogue Tech';
  currentMarketPriceUsd: number;
  trend: 'SURGING' | 'RISING' | 'HIGH_DEMAND';
  weeklyViews: number;
  tournamentSharePercentage: number;
  keyReason: string;
  isEstimated?: boolean;
}

export interface TrendingMarketReport {
  format: SupportedFormat;
  updatedAt: string;
  hotCards: TrendingCardEntry[];
  marketShiftAnalysis: string;
  freshness: FreshnessEvidence;
  dataOrigin: string;
  note: string;
}

export async function getCardPriceTrendsAndDetails(cardQuery: string | number): Promise<CardDetailedMarketReport | null> {
  const db = CardDatabase.getInstance();
  let card: Card | undefined;

  if (typeof cardQuery === 'number') {
    card = db.getCardById(cardQuery);
  } else {
    card = db.getCardByName(cardQuery);
  }

  if (!card) {
    card = await db.fetchCardOnline(cardQuery);
  }

  if (!card) {
    return null;
  }

  let liveCardData: any = card;
  let isLiveCardFetch = false;
  try {
    const resp = await axios.get(`https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes&id=${card.id}`, { timeout: 8000 });
    if (resp.data?.data?.[0]) {
      liveCardData = resp.data.data[0];
      isLiveCardFetch = true;
    }
  } catch {
    // Retain card as is; freshness below will report isLiveFetch=false.
  }

  const [priceReport, yugipediaInfo] = await Promise.all([
    getMultiMarketPrices(card.name, card.id),
    fetchYugipediaCardInfo(card.name)
  ]);

  const setPrintings: CardSetPriceDetail[] = [];
  if (Array.isArray(liveCardData.card_sets)) {
    for (const s of liveCardData.card_sets) {
      const priceNum = parseFloat(s.set_price || '0');
      setPrintings.push({
        setName: s.set_name,
        setCode: s.set_code,
        rarity: s.set_rarity || s.set_rarity_code || 'Common',
        setPrice: !isNaN(priceNum) ? priceNum : 0
      });
    }
  }

  setPrintings.sort((a, b) => b.setPrice - a.setPrice);

  const misc = liveCardData.misc_info?.[0] || {};
  const totalViews = typeof misc.views === 'number' ? misc.views : 0;
  const weeklyViews = typeof misc.viewsweek === 'number' ? misc.viewsweek : 0;

  let marketDemand: 'HOT' | 'RISING' | 'STABLE' | 'LOW' = 'STABLE';
  let trendReason = 'Trading activity and interest are stable in the market.';

  if (weeklyViews > 1000) {
    marketDemand = 'HOT';
    trendReason = 'Extremely high searches and trades over the past week (>1,000/week); the card is a focus of the meta.';
  } else if (weeklyViews > 400) {
    marketDemand = 'RISING';
    trendReason = 'Interest is clearly trending up thanks to recent tournament usage.';
  } else if (weeklyViews < 50 && totalViews < 5000) {
    marketDemand = 'LOW';
    trendReason = 'Low price volatility; collector and competitive demand are both low.';
  }

  const freshness = generateFreshnessEvidence({
    sourceUrl: `https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes&id=${card.id}`,
    sourcePublishedAt: new Date().toISOString(),
    isLiveFetch: isLiveCardFetch,
    dataPayload: {
      id: card.id,
      name: card.name,
      weeklyViews,
      marketSummary: priceReport.summary,
      priceLiveQuoteCount: priceReport.liveQuoteCount ?? 0,
      priceFallbackQuoteCount: priceReport.fallbackQuoteCount ?? 0
    }
  });

  return {
    id: card.id,
    name: card.name,
    type: card.type,
    attribute: card.attribute,
    race: card.race,
    level: card.level,
    atk: card.atk,
    def: card.def,
    desc: card.desc,
    archetype: card.archetype,
    banlistStatus: {
      tcg: card.banlist_info?.ban_tcg || 'Unlimited',
      ocg: card.banlist_info?.ban_ocg || 'Unlimited'
    },
    marketSummary: priceReport.summary,
    printingsCount: setPrintings.length,
    setPrintings,
    popularityMetrics: {
      totalViews,
      weeklyViews,
      marketDemand,
      trendReason
    },
    yugipedia: yugipediaInfo ? {
      url: yugipediaInfo.url,
      japaneseName: yugipediaInfo.japaneseName,
      romajiName: yugipediaInfo.romajiName,
      translatedNames: yugipediaInfo.translatedNames,
      triviaUrl: yugipediaInfo.triviaUrl || `https://yugipedia.com/wiki/Card_Trivia:${encodeURIComponent(card.name)}`,
      tipsUrl: yugipediaInfo.tipsUrl || `https://yugipedia.com/wiki/Card_Tips:${encodeURIComponent(card.name)}`,
      rulingsUrl: yugipediaInfo.rulingsUrl || `https://yugipedia.com/wiki/Card_Rulings:${encodeURIComponent(card.name)}`
    } : undefined,
    freshness
  };
}

export async function getTrendingHotCards(format: SupportedFormat = 'TCG', limit: number = 8): Promise<TrendingMarketReport> {
  const db = CardDatabase.getInstance();
  const meta = DynamicMetaManager.getInstance();

  // LIVE source only: YGOPRODeck ?staple=yes + recently released high-demand cards
  // (see DynamicMetaManager.syncMeta). No curated fallback list.
  const liveStaples = meta.getLiveStaples(format);
  const candidates = liveStaples.slice(0, limit);

  const hotCards: TrendingCardEntry[] = [];
  let rank = 1;
  let livePriceCount = 0;
  let liveViewsCount = 0;

  const mapCategory = (category: string): TrendingCardEntry['category'] => {
    const c = (category || '').toLowerCase();
    if (c.includes('hand')) return 'Hand Trap';
    if (c.includes('board')) return 'Board Breaker';
    if (c.includes('extra')) return 'Extra Deck';
    if (c.includes('consistency')) return 'Engine Pillar';
    return 'Rogue Tech';
  };

  for (const staple of candidates) {
    // Fresh card data (views/weekly views) from YGOPRODeck.
    let card: any = await db.fetchCardOnline(staple.id).catch(() => undefined);
    let weeklyViews = 0;
    if (card) {
      weeklyViews = card.misc_info?.[0]?.viewsweek ?? 0;
      liveViewsCount++;
    }

    let priceUsd = 0;
    try {
      const priceReport = await getMultiMarketPrices(staple.name, staple.id);
      priceUsd = priceReport.summary.lowestUsdEquivalent || 0;
      if (priceReport.quotes?.some((q: any) => q.price > 0)) livePriceCount++;
    } catch {
      priceUsd = 0;
    }

    const trend: TrendingCardEntry['trend'] =
      weeklyViews > 1000 ? 'SURGING' : weeklyViews > 300 ? 'RISING' : 'HIGH_DEMAND';

    hotCards.push({
      rank: rank++,
      name: staple.name,
      id: staple.id,
      category: mapCategory(staple.category),
      currentMarketPriceUsd: priceUsd,
      trend,
      weeklyViews,
      tournamentSharePercentage: 0,
      keyReason: `Live staple list (${staple.tier} tier, ${staple.category}). weeklyViews=${weeklyViews}; prices from TCGPlayer/Yuyu-tei/TCGCorner.`,
      isEstimated: false
    });
  }

  const isLive = candidates.length > 0 && meta.isCacheLive(24);
  const freshness = generateFreshnessEvidence({
    sourceUrl: 'https://db.ygoprodeck.com/api/v7/cardinfo.php?staple=yes',
    sourcePublishedAt: new Date().toISOString(),
    isLiveFetch: isLive,
    dataPayload: {
      format,
      hotCardsCount: hotCards.length,
      livePriceCount,
      liveViewsCount,
      stapleCacheLive: meta.isCacheLive(24)
    }
  });

  const marketShiftAnalysis = isLive
    ? `${hotCards.length} staples taken directly from YGOPRODeck ?staple=yes (live, cache <24h) plus recent high-demand cards. Trends derive from live weekly views; prices from TCGPlayer/Yuyu-tei/TCGCorner. The source has no tournament share, so that field is 0.`
    : 'The live staple cache has not been synced in 24h or is empty. Run ygo_sync_meta; this tool does not return a curated fallback list.';

  return {
    format,
    updatedAt: new Date().toISOString(),
    hotCards,
    marketShiftAnalysis,
    freshness,
    dataOrigin: 'live_staple_list_ygoprodeck',
    note: 'There is no public daily price-trend endpoint; this tool only reflects the live staple list, live weekly views and current prices. If the live staple list is empty, hotCards is empty rather than hardcoded.'
  };
}
