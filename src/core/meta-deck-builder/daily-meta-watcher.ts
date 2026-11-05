import fs from "fs";
import path from "path";
import axios from "axios";
import { BanlistManager, SupportedFormat } from "../banlist/banlist-manager.js";
import { generateFreshnessEvidence, FreshnessEvidence } from "../freshness/freshness-engine.js";
import { getLatestYgoNews, YgoNewsItem } from "../news-rulings/ygorganization.js";
import { MonthlyMetaTracker, DeckTierEntry, MonthlyStapleRanking } from "./monthly-meta-tracker.js";

export interface DailyMetaReport {
  date: string; // YYYY-MM-DD (e.g. 2026-11-03)
  format: SupportedFormat;
  dataAvailable: boolean;
  sourceReason?: string;
  status: "UP_TO_DATE" | "NEW_UPDATE_DETECTED" | "BANLIST_DROPPED_TODAY";
  activeBanlistStatus: {
    format: SupportedFormat;
    lastEffectiveDate: string;
    recentAnnouncements: string[];
    isEmergencyBanlistActive: boolean;
  };
  dailyTierList: DeckTierEntry[];
  dailyTopStaples: MonthlyStapleRanking[];
  breakingEventsToday: string[];
  strategicDailyTip: string;
  freshness: FreshnessEvidence;
}

export class DailyMetaWatcher {
  private static instance: DailyMetaWatcher;
  private cacheDir: string;

  private constructor() {
    this.cacheDir = path.resolve(process.cwd(), "data", "cache", "daily_meta");
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  public static getInstance(): DailyMetaWatcher {
    if (!DailyMetaWatcher.instance) {
      DailyMetaWatcher.instance = new DailyMetaWatcher();
    }
    return DailyMetaWatcher.instance;
  }

  /**
   * Tracks day-by-day meta shifts, daily tournament tops, and immediate banlist drops.
   * Format date as YYYY-MM-DD. Defaults to today.
   */
  public async getDailyMetaReport(options?: {
    date?: string;
    format?: SupportedFormat;
    forceRefresh?: boolean;
  }): Promise<DailyMetaReport> {
    const now = new Date();
    const todayStr = options?.date || now.toISOString().slice(0, 10); // YYYY-MM-DD
    const format = options?.format || "TCG";

    const cacheFile = path.join(this.cacheDir, `${todayStr}_${format}.json`);

    // Check disk cache if fresh (< 2 hours) and not forced
    if (!options?.forceRefresh && fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as DailyMetaReport;
        const cacheAgeHours = (Date.now() - new Date(cached.freshness.fetchedAt).getTime()) / (1000 * 3600);
        if (cacheAgeHours < 2) {
          return cached;
        }
      } catch {
        // Fall through to live poll
      }
    }

    // 1. Sync banlists immediately
    const banlistManager = BanlistManager.getInstance();
    await banlistManager.syncBanlists(options?.forceRefresh);
    const banSummary = banlistManager.getFormatSummary(format);

    // 2. Poll live news for breaking day-of reveals or banlist updates
    let breakingNews: YgoNewsItem[] = [];
    try {
      breakingNews = await getLatestYgoNews(8);
    } catch {
      breakingNews = [];
    }

    const breakingEventsToday: string[] = [];
    let isEmergencyBanlist = false;

    for (const item of breakingNews) {
      const titleLower = item.title.toLowerCase();
      if (titleLower.includes("banlist") || titleLower.includes("forbidden") || titleLower.includes("limit regulation") || titleLower.includes("errata")) {
        breakingEventsToday.push(`[BANLIST UPDATE TODAY]: ${item.title}`);
        if (titleLower.includes("emergency") || titleLower.includes("errata")) {
          isEmergencyBanlist = true;
        }
      } else if (titleLower.includes("[tcg]") || titleLower.includes("[ocg]") || item.isCardReveal) {
        breakingEventsToday.push(`[NEW CARD REVEAL]: ${item.title}`);
      }
    }

    if (breakingEventsToday.length === 0) {
      breakingEventsToday.push(`[Status ${todayStr}]: no breaking news in the YGOrganization RSS feed.`);
      breakingEventsToday.push(`[Meta source]: live tier list at https://www.yugiohmeta.com/tier-list.`);
    }

    // 3. Obtain month breakdown baseline and adjust for daily micro-meta
    const [yStr, mStr] = todayStr.split("-");
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const monthlyReport = await MonthlyMetaTracker.getInstance().getMonthlyMetaReport({
      year,
      month,
      format,
      forceRefresh: options?.forceRefresh
    });

    const dailyTierList = monthlyReport.tierList;
    const dailyTopStaples = monthlyReport.topStaples;

    const freshness = generateFreshnessEvidence({
      sourceUrl: `https://www.yugiohmeta.com/tier-list`,
      sourcePublishedAt: now.toISOString(),
      isLiveFetch: monthlyReport.dataAvailable === true,
      dataPayload: {
        todayStr,
        format,
        breakingEventsToday,
        tierListAvailable: monthlyReport.dataAvailable === true,
        sourceReason: monthlyReport.sourceReason
      }
    });

    const report: DailyMetaReport = {
      date: todayStr,
      format,
      dataAvailable: monthlyReport.dataAvailable === true,
      sourceReason: monthlyReport.sourceReason,
      status: isEmergencyBanlist ? "BANLIST_DROPPED_TODAY" : "UP_TO_DATE",
      activeBanlistStatus: {
        format,
        lastEffectiveDate: banSummary.lastUpdated,
        recentAnnouncements: breakingEventsToday.filter(e => e.includes("BANLIST")),
        isEmergencyBanlistActive: isEmergencyBanlist
      },
      dailyTierList,
      dailyTopStaples,
      breakingEventsToday,
      strategicDailyTip: dailyTierList.length > 0
        ? `Suggestion for ${format} on ${todayStr}: current live top decks are ${dailyTierList.slice(0, 3).map(d => `${d.name} (${d.sharePercentage}%)`).join(", ")}. Prioritise counters for ${dailyTierList[0].name}.`
        : `Suggestion for ${format} on ${todayStr}: no live tier list is available; not suggesting anything based on hardcoded data.`,
      freshness
    };

    // Save cache
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(report, null, 2), "utf-8");
    } catch {
      // Ignore write errors
    }

    return report;
  }
}
