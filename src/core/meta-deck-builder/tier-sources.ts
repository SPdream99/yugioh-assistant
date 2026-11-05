/**
 * Tier-list adapters for the formats YugiohMeta does not cover.
 *
 * - Master Duel: Master Duel Meta's public JSON API (`/api/v1/deck-types`) exposes
 *   a numeric `power` per deck, which is exactly what their tier list is built
 *   from. We bucket it the same way their page labels it (>=12 top tier).
 * - Genesys: the YGO Omega wiki publishes a ladder-derived tier table (tens of
 *   thousands of ranked matches). We read the table, not a screenshot.
 * - AE (Asian-English): there is no public, live tier list. We say so instead of
 *   substituting OCG numbers.
 */

import type { LiveTierDeck, LiveTierListResult } from "./live-tier-list.js";
import type { SupportedFormat } from "../banlist/banlist-manager.js";
import { httpFetch } from "../http/fetch-client.js";

const UA = {
  "User-Agent": "yugioh-assistant-mcp/1.2 (+tier list sync)",
  Accept: "application/json, text/html;q=0.9"
};

const MDM_API = "https://www.masterduelmeta.com/api/v1/top-decks?limit=200&sort=-created";
const MDM_PAGE = "https://www.masterduelmeta.com/tier-list";
const OMEGA_GENESYS = "https://omega.duelistsunite.org/wiki/yu-gi-oh-genesys-tier-list";

function base(format: SupportedFormat, sourceUrl: string): LiveTierListResult {
  return {
    available: false,
    format,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    cached: false,
    cacheAgeMinutes: 0,
    referencePeriod: "",
    decks: [],
    totalTops: 0
  };
}

function powerTier(power: number): string {
  if (power >= 12) return "Tier 1";
  if (power >= 7) return "Tier 2";
  if (power >= 3) return "Tier 3";
  if (power >= 1) return "Tier 4";
  return "Tier 5";
}

function shareTier(share: number): string {
  if (share >= 8) return "Tier 1";
  if (share >= 4) return "Tier 2";
  if (share >= 2) return "Tier 3";
  if (share >= 1) return "Tier 4";
  return "Tier 5";
}

/**
 * Master Duel tier list, derived from the latest topping decklists.
 *
 * Master Duel Meta's own tier page is rendered client-side and exposes no public
 * JSON for the tier numbers, but its API does expose the underlying topping
 * decks. We count them, which is the same measurement the site describes
 * ("computed from the latest topping decklists"), and label the metric.
 */
export async function fetchMasterDuelTierList(): Promise<LiveTierListResult> {
  const result = base("Master Duel", MDM_PAGE);
  try {
    const response = await httpFetch(MDM_API, { headers: UA, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      return { ...result, reason: `Master Duel Meta returned HTTP ${response.status}.` };
    }
    const payload: any = await response.json();
    const items: any[] = Array.isArray(payload) ? payload : payload.docs || payload.data || [];
    if (items.length === 0) {
      return { ...result, reason: "Master Duel Meta returned no topping decks." };
    }

    const counts = new Map<string, number>();
    for (const item of items) {
      const name = item?.deckType?.name;
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    const total = [...counts.values()].reduce((sum, n) => sum + n, 0) || 1;
    const decks: LiveTierDeck[] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([name, count]) => {
        const share = Math.round((count / total) * 1000) / 10;
        return { name, tops: count, percentage: share, tier: shareTier(share) };
      });

    return {
      ...result,
      available: true,
      sourceUrl: MDM_PAGE,
      referencePeriod: `Latest ${items.length} topping decklists`,
      decks,
      totalTops: items.length,
      reason: undefined
    };
  } catch (error) {
    return { ...result, reason: `Could not fetch the Master Duel tier list: ${(error as Error).message}` };
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** Genesys tier list from the YGO Omega ladder table. */
export async function fetchGenesysTierList(): Promise<LiveTierListResult> {
  const result = base("Genesys", OMEGA_GENESYS);
  try {
    const response = await httpFetch(OMEGA_GENESYS, { headers: UA, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      return { ...result, reason: `YGO Omega wiki returned HTTP ${response.status}.` };
    }
    const html = await response.text();

    const decks: LiveTierDeck[] = [];
    const HEADER_WORDS = new Set(["deck", "score", "win rate", "meta share", "players", "share", "tier"]);
    const pushDeck = (name: string, tier: string, percentage = 0) => {
      if (name.length < 3 || name.length > 60) return;
      if (!/^[A-Z0-9]/.test(name)) return;
      if (!/[A-Za-z]/.test(name)) return;
      if (/^\d+\s*to\s*\d+$/i.test(name)) return;
      if (/^tier\b/i.test(name)) return;
      if (HEADER_WORDS.has(name.toLowerCase())) return;

      const existing = decks.find((d) => d.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (existing.percentage === 0 && percentage > 0) existing.percentage = percentage;
        return;
      }
      decks.push({ name, tops: 0, percentage, tier });
    };

    // Pass 1: the "at a glance" table — "Tier 1 | Blitzclique, Angelechy".
    const rowRe = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    for (const row of html.match(rowRe) || []) {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
      if (cells.length < 2) continue;
      const tierLabel = cells[0].trim();
      if (!/^Tier\s*\d(\.\d)?$/i.test(tierLabel)) continue;
      const content = cells[1].trim();
      if (/^none$/i.test(content)) continue;
      if (/up to|decks? only|the best|\d+\s*decks/i.test(content)) continue;
      for (const name of content.split(",").map((n) => n.trim()).filter(Boolean)) {
        pushDeck(name, tierLabel);
      }
    }

    // Pass 2: per-tier tables — "Deck | Score | Win rate | Meta share | Players".
    const sections = html.split(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/i);
    const headings = html.match(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi) || [];
    for (let i = 0; i < headings.length; i++) {
      const title = stripTags(headings[i]);
      const tierMatch = title.match(/Tier\s*(\d(?:\.\d)?)/i);
      if (!tierMatch) continue;
      const tierLabel = `Tier ${tierMatch[1]}`;
      for (const row of sections[i + 1].match(rowRe) || []) {
        const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
        if (cells.length < 3) continue;
        const name = cells[0].trim();
        const shareMatch = cells.find((c, idx) => idx >= 2 && /^[\d.]+%$/.test(c));
        const share = shareMatch ? Number(shareMatch.replace("%", "")) : 0;
        pushDeck(name, tierLabel, share);
      }
    }

    if (decks.length === 0) {
      return { ...result, reason: "The Genesys tier table could not be parsed." };
    }

    return {
      ...result,
      available: true,
      referencePeriod: "YGO Omega Genesys ladder",
      decks,
      totalTops: 0,
      reason: undefined
    };
  } catch (error) {
    return { ...result, reason: `Could not fetch the Genesys tier list: ${(error as Error).message}` };
  }
}

/**
 * Asian-English has no public live tier list. AE uses the OCG card pool with its
 * own banlist, so the OCG list is the closest evidence — but it is a proxy, not
 * a measurement, and the caller must label it that way.
 */
export function aeTierListUnavailable(): LiveTierListResult {
  return {
    ...base("AE", "https://www.yugioh-card.com/en/play/alternate_format_tournaments/"),
    reason:
      "No public, live tier list exists for Asian-English. AE shares the OCG card pool with a separate banlist, so the OCG tier list is the nearest evidence — use it only as a labelled proxy, never as AE data."
  };
}
