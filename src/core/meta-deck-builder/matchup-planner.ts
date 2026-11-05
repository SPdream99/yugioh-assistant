/**
 * Matchup planning and side-deck skeleton.
 *
 * Uses the live tier list to work out what you are actually likely to face
 * (weighted by tops, not by share percentage alone), then proposes a side deck
 * from the format's staple pool by role.
 *
 * The counter choices are heuristics and are labelled as such: the tool never
 * claims a specific card "beats" a specific deck without evidence.
 */

import { fetchLiveTierList, type LiveTierDeck } from "./live-tier-list.js";
import { getStaplesForFormat, type StapleCard, type Format } from "./staple-recommender.js";
import type { SupportedFormat } from "../banlist/banlist-manager.js";

export interface MatchupEntry {
  deck: string;
  sharePercentage: number;
  tops: number;
  expectedFrequency: number;
}

export interface SideDeckPlan {
  slot: number;
  role: string;
  suggestions: Array<{ name: string; passcode: number; category: string; note: string }>;
}

export interface MatchupPlan {
  available: boolean;
  format: string;
  referencePeriod?: string;
  totalTops: number;
  field: MatchupEntry[];
  sidePlan: SideDeckPlan[];
  notes: string[];
  reason?: string;
  freshness?: unknown;
}

const ROLE_ORDER = [
  "Hand Traps",
  "Board Breakers",
  "Floodgates",
  "Going Second",
  "Graveyard Hate",
  "Backrow Removal"
];

export async function buildMatchupPlan(options: {
  format: SupportedFormat;
  deckName?: string;
  sideSize?: number;
}): Promise<MatchupPlan> {
  const format = options.format;
  const sideSize = Math.max(1, Math.min(options.sideSize ?? 15, 15));
  const notes = [
    "Field weights use tops (not share %) so the list reflects what actually placed.",
    "Side suggestions are role-based staples, not proven counters to a specific deck."
  ];

  const tier = await fetchLiveTierList(format).catch(() => null);
  if (!tier || !tier.available || tier.decks.length === 0) {
    return {
      available: false,
      format,
      totalTops: 0,
      field: [],
      sidePlan: [],
      notes,
      reason: `No live tier list is available for ${format}.`
    };
  }

  const decks: LiveTierDeck[] = tier.decks.slice(0, 10);
  const totalTops = decks.reduce((sum, d) => sum + (d.tops || 0), 0) || 1;
  const field: MatchupEntry[] = decks.map((d) => ({
    deck: d.name,
    sharePercentage: d.percentage,
    tops: d.tops,
    expectedFrequency: Math.round(((d.tops || 0) / totalTops) * 1000) / 10
  }));

  const staples: StapleCard[] = getStaplesForFormat(format as Format);
  const byCategory = new Map<string, StapleCard[]>();
  for (const staple of staples) {
    const list = byCategory.get(staple.category) || [];
    list.push(staple);
    byCategory.set(staple.category, list);
  }

  const availableRoles = [...byCategory.keys()].sort(
    (a, b) => (ROLE_ORDER.indexOf(a) === -1 ? 99 : ROLE_ORDER.indexOf(a)) - (ROLE_ORDER.indexOf(b) === -1 ? 99 : ROLE_ORDER.indexOf(b))
  );

  const sidePlan: SideDeckPlan[] = [];
  let slot = 1;
  for (const role of availableRoles) {
    if (slot > sideSize) break;
    const pool = (byCategory.get(role) || []).slice(0, 3);
    if (pool.length === 0) continue;
    sidePlan.push({
      slot,
      role,
      suggestions: pool.slice(0, Math.min(3, sideSize - slot + 1)).map((card) => ({
        name: card.name,
        passcode: card.id,
        category: role,
        note: `Standard ${role.toLowerCase()} choice in ${format}.`
      }))
    });
    slot += 1;
  }

  return {
    available: true,
    format,
    referencePeriod: (tier as any).referencePeriod,
    totalTops,
    field,
    sidePlan,
    notes,
    freshness: (tier as any).freshness
  };
}
