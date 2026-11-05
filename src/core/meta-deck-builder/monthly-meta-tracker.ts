import fs from "fs";
import path from "path";
import { BanlistManager, SupportedFormat } from "../banlist/banlist-manager.js";
import { generateFreshnessEvidence, FreshnessEvidence } from "../freshness/freshness-engine.js";
import { getLatestYgoNews } from "../news-rulings/ygorganization.js";
import { DynamicMetaManager } from "./dynamic-meta-sync.js";
import { fetchLiveTierList, loadTierListSnapshot, type LiveTierListResult } from "./live-tier-list.js";

export interface DeckTierEntry {
  name: string;
  sharePercentage: number;
  tier: "Tier 1" | "Tier 1.5" | "Tier 2" | "Tier 3" | "Rogue";
  playstyle: string;
  keyCards: string[];
  trend: "RISING" | "FALLING" | "STABLE";
  monthlyChangeDescription: string;
}

export interface MonthlyStapleRanking {
  rank: number;
  name: string;
  category: "Hand Trap" | "Board Breaker" | "Extra Deck Utility" | "Consistency";
  usageRatePercentage: number;
  note: string;
}

export interface MonthlyMetaReport {
  year: number;
  month: number;
  yearMonth: string; // e.g. "2026-11"
  format: SupportedFormat;
  dataAvailable: boolean;
  sourceReason?: string;
  activeBanlistSummary: string;
  tierList: DeckTierEntry[];
  topStaples: MonthlyStapleRanking[];
  keyMetaEvents: string[];
  strategicAdvice: string;
  freshness: FreshnessEvidence;
}

export interface MonthComparisonResult {
  monthA: string; // e.g. "2026-10"
  monthB: string; // e.g. "2026-11"
  format: SupportedFormat;
  dataAvailable: boolean;
  sourceReason?: string;
  changes: {
    deck: string;
    shareA: number;
    shareB: number;
    diff: number;
    trend: "RISING" | "FALLING" | "STABLE";
  }[];
  risingStars: string[];
  fallingDecks: string[];
  banlistImpactAnalysis: string;
  freshness: FreshnessEvidence;
}

function tierFromPercentage(percentage: number): DeckTierEntry["tier"] {
  if (percentage >= 10) return "Tier 1";
  if (percentage >= 6) return "Tier 1.5";
  if (percentage >= 3) return "Tier 2";
  if (percentage >= 1) return "Tier 3";
  return "Rogue";
}

function toDeckEntries(live: LiveTierListResult): DeckTierEntry[] {
  return live.decks.map(deck => ({
    name: deck.name,
    sharePercentage: deck.percentage,
    tier: tierFromPercentage(deck.percentage),
    playstyle: "Live tier list (YugiohMeta tournament tops)",
    keyCards: [],
    trend: "STABLE",
    monthlyChangeDescription: `${deck.tops} tournament tops · ${deck.percentage}% share (${live.referencePeriod})`
  }));
}

function liveStaplesFor(format: SupportedFormat): MonthlyStapleRanking[] {
  const manager = DynamicMetaManager.getInstance();
  const live = manager.getLiveStaples(format);
  const isLive = manager.isCacheLive(24);
  return live.slice(0, 10).map((staple, index) => {
    const cat = (staple.category || "").toLowerCase();
    const category: MonthlyStapleRanking["category"] =
      cat.includes("hand") ? "Hand Trap" :
      cat.includes("board") ? "Board Breaker" :
      cat.includes("extra") ? "Extra Deck Utility" : "Consistency";
    return {
      rank: index + 1,
      name: staple.name,
      category,
      usageRatePercentage: 0,
      note: isLive
        ? "Live staple list (YGOPRODeck ?staple=yes). Usage rate is not exposed by the tier-list source."
        : "Cached/fallback staple list (last live sync is older than 24h). Run ygo_sync_meta for a live refresh."
    };
  });
}

export class MonthlyMetaTracker {
  private static instance: MonthlyMetaTracker;

  private constructor() {}

  public static getInstance(): MonthlyMetaTracker {
    if (!MonthlyMetaTracker.instance) {
      MonthlyMetaTracker.instance = new MonthlyMetaTracker();
    }
    return MonthlyMetaTracker.instance;
  }

  /**
   * Returns the current live tier list. No hardcoded tier data is ever returned.
   * If the upstream source is unavailable, the report is marked dataAvailable=false.
   */
  public async getMonthlyMetaReport(options?: {
    year?: number;
    month?: number;
    format?: SupportedFormat;
    forceRefresh?: boolean;
  }): Promise<MonthlyMetaReport> {
    const now = new Date();
    const year = options?.year || now.getUTCFullYear();
    const month = options?.month || now.getUTCMonth() + 1;
    const format = options?.format || "TCG";
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;

    const live = await fetchLiveTierList(format, { forceRefresh: options?.forceRefresh });

    const banlistManager = BanlistManager.getInstance();
    await banlistManager.syncBanlists(options?.forceRefresh);
    const banSummary = banlistManager.getFormatSummary(format);
    const activeBanlistSummary = `Banlist ${format}: ${banSummary.forbiddenCount} forbidden, ${banSummary.limitedCount} limited, ${banSummary.semiLimitedCount} semi-limited. Updated: ${banSummary.lastUpdated}`;

    if (!live.available) {
      return {
        year,
        month,
        yearMonth,
        format,
        dataAvailable: false,
        sourceReason: live.reason || "Live tier list unavailable.",
        activeBanlistSummary,
        tierList: [],
        topStaples: liveStaplesFor(format),
        keyMetaEvents: [live.reason || "Live tier list unavailable."],
        strategicAdvice: "No live tier list data for this format. Refusing hardcoded data.",
        freshness: generateFreshnessEvidence({
          sourceUrl: live.sourceUrl,
          sourcePublishedAt: live.fetchedAt,
          isLiveFetch: false,
          dataPayload: { format, reason: live.reason }
        })
      };
    }

    const tierList = toDeckEntries(live);
    const topStaples = liveStaplesFor(format);

    let recentNewsTitles: string[] = [];
    try {
      const news = await getLatestYgoNews(5);
      recentNewsTitles = news.map(n => n.title);
    } catch {
      recentNewsTitles = [];
    }

    const keyMetaEvents = [
      `Live tier list: ${live.decks.length} deck-types, ${live.totalTops} tournament tops (${live.referencePeriod}).`,
      ...recentNewsTitles.slice(0, 4)
    ];

    const top3 = tierList.slice(0, 3);
    const strategicAdvice = top3.length > 0
      ? `Current top decks: ${top3.map(d => `${d.name} (${d.sharePercentage}%)`).join(", ")}. ` +
        `Prioritise side-deck counters for ${top3[0].name} and prepare hand traps/board breakers that match the speed of ${top3.map(d => d.name).join(", ")}.`
      : "The live tier list has no decks yet.";

    return {
      year,
      month,
      yearMonth,
      format,
      dataAvailable: true,
      activeBanlistSummary,
      tierList,
      topStaples,
      keyMetaEvents,
      strategicAdvice,
      freshness: generateFreshnessEvidence({
        sourceUrl: live.sourceUrl,
        sourcePublishedAt: live.fetchedAt,
        isLiveFetch: true,
        dataPayload: { decks: live.decks, totalTops: live.totalTops, referencePeriod: live.referencePeriod, cached: live.cached, cacheAgeMinutes: live.cacheAgeMinutes }
      })
    };
  }

  /**
   * Compares two months using real snapshots saved when live tier lists were fetched.
   * There is no hardcoded month-over-month data.
   */
  public async compareMonthlyMeta(options: {
    monthA: string;
    monthB: string;
    format?: SupportedFormat;
  }): Promise<MonthComparisonResult> {
    const format = options.format || "TCG";
    const snapA = loadTierListSnapshot(options.monthA, format);
    const snapB = loadTierListSnapshot(options.monthB, format);

    if (!snapA || !snapB) {
      const missing = [!snapA ? options.monthA : null, !snapB ? options.monthB : null].filter(Boolean).join(", ");
      return {
        monthA: options.monthA,
        monthB: options.monthB,
        format,
        dataAvailable: false,
        sourceReason: `No live snapshot for ${missing}. Call ygo_get_monthly_meta for that month first; there is no hardcoded data to compare against.`,
        changes: [],
        risingStars: [],
        fallingDecks: [],
        banlistImpactAnalysis: "Not enough live snapshots to compare the two months.",
        freshness: generateFreshnessEvidence({
          sourceUrl: "https://www.yugiohmeta.com/tier-list",
          sourcePublishedAt: new Date().toISOString(),
          isLiveFetch: false,
          dataPayload: { monthA: options.monthA, monthB: options.monthB, available: false }
        })
      };
    }

    const mapA = new Map(snapA.decks.map(d => [d.name, d.percentage]));
    const changes = snapB.decks.map(dB => {
      const shareA = mapA.get(dB.name) || 0;
      const diff = Number((dB.percentage - shareA).toFixed(2));
      const trend: "RISING" | "FALLING" | "STABLE" = diff > 1.5 ? "RISING" : diff < -1.5 ? "FALLING" : "STABLE";
      return { deck: dB.name, shareA, shareB: dB.percentage, diff, trend };
    });

    const risingStars = changes.filter(c => c.trend === "RISING").map(c => `${c.deck} (+${c.diff}%)`);
    const fallingDecks = changes.filter(c => c.trend === "FALLING").map(c => `${c.deck} (${c.diff}%)`);

    return {
      monthA: options.monthA,
      monthB: options.monthB,
      format,
      dataAvailable: true,
      changes,
      risingStars,
      fallingDecks,
      banlistImpactAnalysis: `Comparing live snapshots ${options.monthA} → ${options.monthB}: ` +
        `${risingStars.length} decks rising, ${fallingDecks.length} decks falling. ` +
        `Source: ${snapA.sourceUrl} (snapshot ${snapA.fetchedAt}) and ${snapB.sourceUrl} (snapshot ${snapB.fetchedAt}).`,
      freshness: generateFreshnessEvidence({
        sourceUrl: "https://www.yugiohmeta.com/tier-list",
        sourcePublishedAt: new Date().toISOString(),
        isLiveFetch: true,
        dataPayload: { monthA: options.monthA, monthB: options.monthB, changes }
      })
    };
  }
}
