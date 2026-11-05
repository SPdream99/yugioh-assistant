import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import type { SupportedFormat } from "../banlist/banlist-manager.js";
import { fetchMasterDuelTierList, fetchGenesysTierList, aeTierListUnavailable } from "./tier-sources.js";

export interface LiveTierDeck {
  name: string;
  tops: number;
  percentage: number;
  tier: string;
}

export interface LiveTierListResult {
  available: boolean;
  format: SupportedFormat;
  sourceUrl: string;
  fetchedAt: string;
  cached: boolean;
  cacheAgeMinutes: number;
  referencePeriod: string;
  decks: LiveTierDeck[];
  totalTops: number;
  totalPlayers?: number;
  eventBreakdown?: { t3Events: number; t2Events: number; t3Players: number; t2Players: number };
  reason?: string;
}

const API_BASE = "https://www.yugiohmeta.com/api/v1";
const TIER_LIST_URL = "https://www.yugiohmeta.com/tier-list";
const CACHE_TTL_MINUTES = 30;

function cachePath(format: SupportedFormat): string {
  return path.resolve(process.cwd(), "data", "cache", "live_tier_list", `${format}.json`);
}

function historyPath(yearMonth: string, format: SupportedFormat): string {
  return path.resolve(process.cwd(), "data", "cache", "live_tier_list", "history", `${yearMonth}_${format}.json`);
}

function deriveTier(percentage: number): string {
  // Thresholds tuned so they work for both TCG (larger top shares) and OCG.
  if (percentage >= 10) return "Tier 1";
  if (percentage >= 6) return "Tier 1.5";
  if (percentage >= 3) return "Tier 2";
  if (percentage >= 1) return "Tier 3";
  return "Rogue";
}

function isOcgFormat(format: SupportedFormat): boolean | null {
  if (format === "TCG") return false;
  if (format === "OCG") return true;
  return null;
}

/** Parses the official YugiohMeta rankings API payload. */
export function parseTierListApi(payload: any): {
  decks: LiveTierDeck[];
  referencePeriod: string;
  totalTops: number;
  totalPlayers?: number;
  eventBreakdown?: { t3Events: number; t2Events: number; t3Players: number; t2Players: number };
} | null {
  const record = Array.isArray(payload) ? payload[0] : payload;
  if (!record || !Array.isArray(record.deckTypes) || record.deckTypes.length === 0) return null;

  const totalDecks = Number(record.totalDecks) || record.deckTypes.reduce((sum: number, d: any) => sum + (Number(d.decksCount) || 0), 0);
  if (totalDecks <= 0) return null;

  const decks: LiveTierDeck[] = record.deckTypes.map((entry: any) => {
    const tops = Number(entry.decksCount) || 0;
    const percentage = Number(((tops / totalDecks) * 100).toFixed(2));
    return {
      name: entry.deckType?.name || "Unknown",
      tops,
      percentage,
      tier: deriveTier(percentage)
    };
  });

  return {
    decks,
    referencePeriod: record.range || "Last 1 month",
    totalTops: totalDecks,
    totalPlayers: Number(record.totalPlayerCount) || undefined,
    eventBreakdown: {
      t3Events: Number(record.t3Count) || 0,
      t2Events: Number(record.t2Count) || 0,
      t3Players: Number(record.t3PlayerCount) || 0,
      t2Players: Number(record.t2PlayerCount) || 0
    }
  };
}

/**
 * Parses the HTML tier-list page. Kept as a fallback for TCG if the JSON API changes.
 */
export function parseTierListHtml(html: string): { decks: LiveTierDeck[]; referencePeriod: string; totalTops: number } {
  const names: string[] = [];
  for (const match of html.matchAll(/href="\/tier-list\/deck-types\/([^"#]+)#TCG"/g)) {
    try {
      names.push(decodeURIComponent(match[1]).replace(/\s+/g, " ").trim());
    } catch {
      names.push(match[1].replace(/\s+/g, " ").trim());
    }
  }

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

  const pairs: { tops: number; percentage: number }[] = [];
  for (const match of text.matchAll(/\((\d+)\)\s*([\d.]+)%/g)) {
    const tops = Number(match[1]);
    const percentage = Number(match[2]);
    if (!Number.isNaN(tops) && !Number.isNaN(percentage)) pairs.push({ tops, percentage });
  }

  const decks: LiveTierDeck[] = [];
  const seen = new Set<string>();
  const count = Math.min(names.length, pairs.length);
  for (let i = 0; i < count; i++) {
    const name = names[i];
    const { tops, percentage } = pairs[i];
    if (!name || name.length > 80 || seen.has(name)) continue;
    seen.add(name);
    decks.push({ name, tops, percentage, tier: deriveTier(percentage) });
  }

  const periodMatch = text.match(/Last\s+\d+\s+(?:day|days|week|weeks|month|months)/i);
  const referencePeriod = periodMatch ? periodMatch[0] : "Last 1 month";
  const totalTops = decks.reduce((sum, d) => sum + d.tops, 0);

  return { decks, referencePeriod, totalTops };
}

function saveSnapshot(format: SupportedFormat, result: LiveTierListResult): void {
  try {
    const file = cachePath(format);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf-8");

    const ym = new Date().toISOString().slice(0, 7);
    const hist = historyPath(ym, format);
    fs.mkdirSync(path.dirname(hist), { recursive: true });
    fs.writeFileSync(hist, JSON.stringify(result, null, 2), "utf-8");
  } catch {
    // Cache write is optional
  }
}

/** Loads a real snapshot saved when the live tier list was fetched in that month. */
export function loadTierListSnapshot(yearMonth: string, format: SupportedFormat): LiveTierListResult | null {
  const file = historyPath(yearMonth, format);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as LiveTierListResult;
    if (!parsed.decks || parsed.decks.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Fetches the live tier list from the YugiohMeta JSON API.
 * The website exposes `/api/v1/deck-types/rankings` with `ocg=false|true`,
 * which covers both TCG and OCG. AE/Genesys/Master Duel are not provided.
 */
export async function fetchLiveTierList(
  format: SupportedFormat = "TCG",
  options: { forceRefresh?: boolean } = {}
): Promise<LiveTierListResult> {
  const now = new Date();
  const base: LiveTierListResult = {
    available: false,
    format,
    sourceUrl: TIER_LIST_URL,
    fetchedAt: now.toISOString(),
    cached: false,
    cacheAgeMinutes: 0,
    referencePeriod: "Last 1 month",
    decks: [],
    totalTops: 0
  };

  // Formats YugiohMeta does not cover use their own live source.
  if (format === "Master Duel") {
    const md = await fetchMasterDuelTierList();
    return { ...md, cached: false, cacheAgeMinutes: 0 };
  }
  if (format === "Genesys") {
    const gx = await fetchGenesysTierList();
    return { ...gx, cached: false, cacheAgeMinutes: 0 };
  }
  if (format === "AE") {
    return aeTierListUnavailable();
  }

  const ocg = isOcgFormat(format);
  if (ocg === null) {
    return {
      ...base,
      reason: `No live tier list source is wired for ${format}; refusing to return hardcoded data.`
    };
  }

  const file = cachePath(format);

  if (!options.forceRefresh && fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf-8")) as LiveTierListResult;
      const ageMinutes = (Date.now() - new Date(cached.fetchedAt).getTime()) / 60000;
      if (ageMinutes < CACHE_TTL_MINUTES && cached.decks.length > 0) {
        return { ...cached, cached: true, cacheAgeMinutes: Math.round(ageMinutes) };
      }
    } catch {
      // Fall through to live fetch
    }
  }

  const apiUrl = `${API_BASE}/deck-types/rankings?range=Last%201%20month&ocg=${ocg ? "true" : "false"}&t3Only=false`;

  try {
    const resp = await axios.get(apiUrl, {
      timeout: 20000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json"
      }
    });

    const parsed = parseTierListApi(resp.data);
    if (!parsed) {
      return { ...base, sourceUrl: apiUrl, reason: "The rankings API returned an empty or malformed payload." };
    }

    const result: LiveTierListResult = {
      available: true,
      format,
      sourceUrl: apiUrl,
      fetchedAt: new Date().toISOString(),
      cached: false,
      cacheAgeMinutes: 0,
      referencePeriod: parsed.referencePeriod,
      decks: parsed.decks,
      totalTops: parsed.totalTops,
      totalPlayers: parsed.totalPlayers,
      eventBreakdown: parsed.eventBreakdown
    };

    saveSnapshot(format, result);
    return result;
  } catch (error) {
    // TCG-only HTML fallback if the JSON API is temporarily unavailable.
    if (format === "TCG") {
      try {
        const resp = await axios.get(TIER_LIST_URL, {
          timeout: 20000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml"
          }
        });
        const parsed = parseTierListHtml(String(resp.data));
        if (parsed.decks.length > 0) {
          const result: LiveTierListResult = {
            available: true,
            format,
            sourceUrl: TIER_LIST_URL,
            fetchedAt: new Date().toISOString(),
            cached: false,
            cacheAgeMinutes: 0,
            referencePeriod: parsed.referencePeriod,
            decks: parsed.decks,
            totalTops: parsed.totalTops
          };
          saveSnapshot(format, result);
          return result;
        }
      } catch {
        // Fall through to the error result.
      }
    }

    return {
      ...base,
      sourceUrl: apiUrl,
      reason: `Could not fetch the live tier list: ${(error as Error).message}`
    };
  }
}
