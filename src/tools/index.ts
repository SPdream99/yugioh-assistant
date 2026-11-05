import { z } from "zod";
import { parseYdk, formatYdk, validateDeck } from "../core/deck-parser/ydk.js";
import { checkDeckLegality } from "../core/deck-parser/legality.js";
import { parseYdke, formatYdke } from "../core/deck-parser/ydke.js";
import { CardDatabase } from "../core/card-database/ygoprodeck.js";
import { BanlistManager } from "../core/banlist/banlist-manager.js";
import { readCardData, TYPE_FUSION, TYPE_SYNCHRO, TYPE_XYZ, TYPE_LINK } from "../core/card-scripts/card-data.js";
import { findSynergyAndSearchers } from "../core/card-database/combo-finder.js";
import { analyzeCardMechanics, judgeInteraction } from "../core/card-scripts/judge-engine.js";
import { analyzeLuaCard } from "../core/card-scripts/lua-ast.js";
import { analyzeScriptDeep, analyzeScriptCorpus } from "../core/card-scripts/script-insights.js";
import { buildCompetitiveDeck, optimizeUserDeck } from "../core/meta-deck-builder/deck-synthesizer.js";
import { DynamicMetaManager } from "../core/meta-deck-builder/dynamic-meta-sync.js";
import { registerCustomCard, migrateTempId, getCustomCard, listCustomCards } from "../core/custom-cards/registry.js";
import { generateBatchGridPrompt, sliceAndAssignArtworks } from "../core/custom-cards/batch-art-slicer.js";
import { getMultiMarketPrices } from "../core/pricing/price-aggregator.js";
import { getLatestYgoNews } from "../core/news-rulings/ygorganization.js";
import { getFastEffectTimingGuide, getDamageStepGuide, getSegocGuide, explainMechanic } from "../core/news-rulings/rulebook.js";
import {
  ensureRulebook,
  getRulebookStatus,
  getRulebookText,
  getRulebookSections,
  getRulebookSectionPage,
  getOfficialRulebookExcerpt,
  searchRulebook,
  syncOfficialRulebook
} from "../core/news-rulings/official-rulebook.js";
import {
  ensureJudgeCorpus,
  getJudgeCorpusStatus,
  getJudgeDocPage,
  getJudgeDocSection,
  listJudgeDocuments,
  searchJudgeDocs,
  syncJudgeCorpus,
  citationFor
} from "../core/news-rulings/official-docs.js";
import {
  getCard as getWikiCard,
  getCardTab as getWikiCardTab,
  getWikiPage,
  searchWiki,
  getWikiStatus,
  YUGIPEDIA_LICENSE
} from "../core/wiki/yugipedia.js";
import { exportTournamentDecklistPdf } from "../core/deck-export/decklist-pdf.js";
import { renderDeckGridPng } from "../core/deck-export/deck-image.js";
import { MonthlyMetaTracker } from "../core/meta-deck-builder/monthly-meta-tracker.js";
import { DailyMetaWatcher } from "../core/meta-deck-builder/daily-meta-watcher.js";
import { getCardPriceTrendsAndDetails, getTrendingHotCards } from "../core/pricing/price-trends.js";
import { runMarketQuery } from "../core/pricing/market-intel.js";
import { getPrintingPrices } from "../core/pricing/printing-prices.js";
import {
  searchYgoproDecksDetailed,
  searchMasterDuelDecks,
  searchKonamiDecks,
  searchFormatLibraryDecks,
  findCombos,
  findCounters,
  type CommunityDeck,
  type DeckSort
} from "../core/deck-community/community-decks.js";
import {
  createArchetypeDocx,
  readAndValidateDocx,
  exportDatabaseAndScripts,
  generateArtPrompts,
  sliceArtGrid,
  buildFullPipeline
} from "../core/archetype-studio/studio_manager.js";
import { fetchYugipediaCardInfo } from "../core/card-database/yugipedia.js";
import { buildCardDossier } from "../core/card-database/card-dossier.js";
import { buildMatchupPlan } from "../core/meta-deck-builder/matchup-planner.js";
import { computeDeckCost } from "../core/pricing/deck-cost.js";
import { measureConsistency } from "../core/deck-consistency/lab.js";
import { compareDecks } from "../core/deck-tools/deck-compare.js";
import { auditDeckLocks, detectLocks } from "../core/card-scripts/lock-detector.js";
import { verifyRulingClaim } from "../core/card-scripts/ruling-verifier.js";
import { runGoldenSuite, loadGoldenCases } from "../core/card-scripts/golden-regression.js";
import { runAiBenchmark, exportSelfPlay } from "../core/ai/agent.js";
import { createPolicy } from "../core/ai/policy.js";
import { guardOutputPath } from "../utils/safe-path.js";
import { readTextFileSafe } from "../utils/safe-path.js";
import { loadDeckUniversal } from "../core/deck-parser/universal-deck-loader.js";
import { citationsForQuestion, citationsForMechanics, type Mechanic } from "../core/news-rulings/citations.js";
import { simulateDuelScenario } from "../core/card-scripts/duel-simulator.js";
import { runOcgCoreDuel } from "../core/card-scripts/ocgcore-runtime.js";
import { TOOL_FIRST_MARK } from "../server-instructions.js";
import { attachMedia } from "../mcp-media.js";
import { runScenario, type ScenarioSpec } from "../core/card-scripts/scenario-runner.js";
import { parseBoard } from "../core/card-scripts/board-dsl.js";
import { SCENARIO_PRESETS, listScenarioPresets } from "../core/card-scripts/scenario-presets.js";
import {
  resolveCardScript,
  scriptInventory,
  listGeneratedScripts,
  upgradeGeneratedScripts,
  createScriptFromNews
} from "../core/card-scripts/script-resolver.js";
import { DeckData } from "../types/deck.js";
import fs from "fs";

// ---------------------------------------------------------------------------
// Shared helpers for tools that accept card names or deck text
// ---------------------------------------------------------------------------

/** Accepts passcodes or card names and returns passcodes, skipping unknown names. */
async function resolveCardRefs(refs: Array<number | string> | undefined): Promise<number[]> {
  if (!Array.isArray(refs)) return [];
  const db = CardDatabase.getInstance();
  const out: number[] = [];

  for (const ref of refs) {
    if (typeof ref === "number" && Number.isFinite(ref)) {
      out.push(ref);
      continue;
    }
    const asNumber = Number(ref);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      out.push(asNumber);
      continue;
    }
    try {
      const card = await db.fetchCardOnline(String(ref));
      if (card) out.push(card.id);
    } catch {
      // Unknown names are dropped; the caller can compare lengths.
    }
  }

  return out;
}

/** Parses YDKE / YDK / text into passcode arrays for the simulator. */
async function deckArraysFromInput(input: string): Promise<{ main: number[]; extra: number[]; side: number[] }> {
  const { deck } = await loadDeckUniversal({ input });
  const toCodes = async (list: (number | string | any)[]) => {
    const codes: number[] = [];
    for (const entry of list || []) {
      if (typeof entry === "number") codes.push(entry);
      else if (typeof entry === "string") {
        const n = Number(entry);
        if (Number.isFinite(n)) codes.push(n);
        else {
          const [resolved] = await resolveCardRefs([entry]);
          if (resolved) codes.push(resolved);
        }
      } else if (entry && typeof entry.id === "number") codes.push(entry.id);
    }
    return codes;
  };
  return {
    main: await toCodes(deck.main),
    extra: await toCodes(deck.extra),
    side: await toCodes(deck.side)
  };
}

/** Parses deck text into cards with copy counts, resolving names when needed. */
async function deckCardsFromInput(input: string): Promise<Array<{ name: string; passcode: number; copies: number }>> {
  const parsed = await deckArraysFromInput(input);
  const counts = new Map<number, number>();
  for (const code of [...parsed.main, ...parsed.extra, ...parsed.side]) {
    if (!code) continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }

  const db = CardDatabase.getInstance();
  const out: Array<{ name: string; passcode: number; copies: number }> = [];
  for (const [passcode, copies] of counts) {
    const cached = db.getCardById(passcode);
    let name = cached?.name;
    if (!name) {
      try {
        const fetched = await db.fetchCardOnline(passcode);
        name = fetched?.name;
      } catch {
        // ignore
      }
    }
    out.push({ passcode, name: name || `Card ${passcode}`, copies });
  }
  return out;
}

export const TOOLS = [
  {
    name: "ygo_parse_deck",
    description: `USE THIS FIRST when the user supplies a .ydk path, raw .ydk text or a ydke:// link. Parse the deck into card data and validate it; never transcribe the list by hand. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      ydkContent: z.string().optional().describe("Raw .ydk text"),
      filePath: z.string().optional().describe("Absolute or relative path to a .ydk file"),
      ydkeUrl: z.string().optional().describe("ydke:// link (e.g. ydke://base64!base64!base64!)"),
      name: z.string().optional().describe("Deck name"),
      format: z
        .enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"])
        .optional()
        .default("TCG")
        .describe("Banlist used to validate copy limits (default TCG)")
    }),
    handler: async (args: any) => {
      let deck: DeckData;
      if (args.ydkeUrl) {
        deck = parseYdke(args.ydkeUrl, args.name);
      } else if (args.filePath) {
        const read = readTextFileSafe(args.filePath);
        if (!read.ok) throw new Error(read.reason);
        deck = parseYdk(read.text!, args.name);
      } else if (args.ydkContent) {
        deck = parseYdk(args.ydkContent, args.name);
      } else {
        throw new Error("Provide one of: ydkContent, filePath or ydkeUrl");
      }

      const db = CardDatabase.getInstance();
      const resolved = db.resolveDeck(deck);
      const legality = await checkDeckLegality(deck, args.format || "TCG");

      return {
        deck,
        mainCount: deck.main.length,
        extraCount: deck.extra.length,
        sideCount: deck.side.length,
        format: legality.format,
        // `validation` keeps its old shape; it is now banlist-aware and zone-aware.
        validation: {
          valid: legality.valid,
          errors: legality.errors,
          warnings: legality.warnings
        },
        banlistLimits: legality.banlist,
        unresolvedCards: legality.unresolved,
        resolvedPreview: {
          main: (resolved.main || []).slice(0, 10).map((c: any) => c.name),
          extra: (resolved.extra || []).map((c: any) => c.name)
        }
      };
    }
  },

  {
    name: "ygo_check_legality",
    description: `USE THIS for every "is this legal / how many copies can I run / is X banned" question. Checks Main/Extra/Side sizes, banlist copy limits for the requested format (forbidden / limited / semi-limited), and that Fusion/Synchro/Xyz/Link monsters are only in the Extra Deck. Works from a .ydk path, raw .ydk text, a ydke:// link, or a DeckData object. Never state a banlist status from memory. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      deck: z.any().optional().describe("DeckData, a .ydk path, raw .ydk text, a ydke:// link, or a plain card list"),
      input: z.string().optional().describe("Alias for deck (a .ydk path, .ydk text or ydke:// link)"),
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).optional().default("TCG").describe("Banlist format")
    }),
    handler: async (args: any) => {
      const raw = args.deck ?? args.input;
      if (raw === undefined || raw === null || raw === "") {
        return { available: false, reason: "Provide 'deck' or 'input' (a .ydk path, .ydk text, a ydke:// link or a DeckData object)." };
      }
      const { deck } = await loadDeckUniversal({ input: raw });
      if ((deck.main || []).length === 0) {
        return { available: false, reason: "Could not read any cards from the input deck (0 Main Deck cards)." };
      }
      const result = await checkDeckLegality(deck, args.format);
      return { source: "deck-legality", deckName: deck.name, available: true, ...result };
    }
  },

  {
    name: "ygo_export_deck",
    description: "Export a deck as .ydk text, a canonical ydke:// link, or both.",
    parameters: z.object({
      deck: z.any().describe("Deck data { main: number[], extra: number[], side: number[] }"),
      format: z.enum(["ydk", "ydke", "both"]).default("both").describe("Output format")
    }),
    handler: async (args: any) => {
      const deck: DeckData = args.deck;
      const result: any = {};
      if (args.format === "ydk" || args.format === "both") {
        result.ydk = formatYdk(deck);
      }
      if (args.format === "ydke" || args.format === "both") {
        result.ydke = formatYdke(deck);
      }
      return result;
    }
  },

  {
    name: "ygo_find_community_decks",
    description: `USE THIS when the user wants real decklists that other people published ("show me decks for an archetype", "what are people building", "a tournament list", "official Konami recipe"). Pulls live community/tournament decks from YGOPRODeck, Master Duel Meta and Konami's official card database (Neuron), and returns each deck's canonical page URL plus a ready-to-use ydke:// link. Every deck plugs straight into ygo_check_legality, ygo_deck_cost, ygo_consistency_lab or ygo_optimize_deck — do not retype the list by hand. Never invent a community deck or a deck URL. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      query: z.string().optional().describe("Free-text name/card keyword, e.g. an archetype name"),
      archetype: z.string().optional().describe("Archetype / deck-type filter"),
      category: z
        .string()
        .optional()
        .describe(
          "YGOPRODeck category taxonomy: 'type/<archetype-slug>', a full /category/type/... URL, or a bare archetype. Resolves to their _sft_post_tag filter."
        ),
      tournament: z.string().optional().describe("Tournament name filter, e.g. 'YCS Providence'"),
      deckSize: z.number().optional().describe("Exact Main Deck size filter (e.g. 40)"),
      minPrice: z.number().optional().describe("Minimum deck price in USD (source-reported)"),
      maxPrice: z.number().optional().describe("Maximum deck price in USD (source-reported)"),
      from: z.string().optional().describe("Only decks submitted on/after this date (YYYY-MM-DD)"),
      to: z.string().optional().describe("Only decks submitted on/before this date (YYYY-MM-DD)"),
      containsCard: z.string().optional().describe("Only decks that contain this card (name resolved to a passcode)"),
      excludeCard: z.string().optional().describe("Exclude decks that contain this card"),
      format: z
        .string()
        .optional()
        .describe(
          "Format filter: tcg | ocg | ae | genesys | meta | casual | master duel. Passed to the source's own category filter."
        ),
      source: z
        .enum(["all", "ygoprodeck", "masterduelmeta", "konami", "formatlibrary"])
        .optional()
        .describe(
          "YGOPRODeck = TCG/OCG community + curated tournament decks; Master Duel Meta = Master Duel decks; konami = official card-database deck recipes (needs a query); formatlibrary = retro/community formats (GOAT, Edison, Fiber). Defaults to ygoprodeck when a YGOPRODeck-only filter is used."
        ),
      sort: z.enum(["popular", "recent", "comments"]).optional().default("popular").describe("Sort order"),
      limit: z.number().optional().default(5).describe("Decks per source (1-20)"),
      offset: z.number().optional().default(0).describe("Paging offset for YGOPRODeck"),
      includeNames: z.boolean().optional().default(false).describe("Resolve passcodes to card names (larger payload)"),
      includeCombos: z
        .boolean()
        .optional()
        .default(true)
        .describe("Attach structured combos for the archetype from Master Duel Meta's public combo API")
    }),
    handler: async (args: any) => {
      const hasYgoOnlyFilter = Boolean(
        args.category ||
        args.tournament ||
        args.deckSize != null ||
        args.minPrice != null ||
        args.maxPrice != null ||
        args.from ||
        args.to ||
        args.containsCard ||
        args.excludeCard
      );
      const source = args.source || (hasYgoOnlyFilter ? "ygoprodeck" : "all");
      const sourceNote = args.source
        ? undefined
        : hasYgoOnlyFilter
          ? "Source defaulted to ygoprodeck because the requested filters only exist on YGOPRODeck."
          : "Source defaulted to all (YGOPRODeck + Master Duel Meta).";
      const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
      const sort: DeckSort = args.sort || "popular";
      const formatAlias: Record<string, string> = {
        tcg: "Tournament Meta Decks",
        ocg: "Tournament Meta Decks OCG",
        ae: "Tournament Meta Decks OCG (Asian-English)",
        genesys: "Tournament Meta Decks (Genesys)",
        meta: "meta decks",
        casual: "fun/casual decks",
        "master duel": "master duel decks"
      };
      const format = args.format ? formatAlias[String(args.format).toLowerCase()] || args.format : undefined;

      const errors: string[] = [];
      const decks: CommunityDeck[] = [];
      const sourceUrls: string[] = [];
      let appliedFilters: Record<string, unknown> | undefined;
      let categoryUrl: string | undefined;

      if (source === "all" || source === "ygoprodeck") {
        sourceUrls.push("https://ygoprodeck.com/deck-search/");
        try {
          const result = await searchYgoproDecksDetailed({
            query: args.query,
            archetype: args.archetype,
            category: args.category,
            format,
            tournament: args.tournament,
            deckSize: args.deckSize,
            minPrice: args.minPrice,
            maxPrice: args.maxPrice,
            from: args.from,
            to: args.to,
            containsCard: args.containsCard,
            excludeCard: args.excludeCard,
            sort,
            limit,
            offset: args.offset,
            includeNames: args.includeNames
          });
          decks.push(...result.decks);
          appliedFilters = result.appliedFilters;
          categoryUrl = result.categoryUrl;
        } catch (error) {
          errors.push(`YGOPRODeck: ${(error as Error).message}`);
        }
      }

      if (source === "all" || source === "masterduelmeta") {
        sourceUrls.push("https://www.masterduelmeta.com/top-decks");
        try {
          decks.push(
            ...(await searchMasterDuelDecks({
              query: args.query,
              archetype: args.archetype,
              limit,
              includeNames: args.includeNames
            }))
          );
        } catch (error) {
          errors.push(`Master Duel Meta: ${(error as Error).message}`);
        }
      }

      if (source === "konami") {
        sourceUrls.push("https://www.db.yugioh-card.com/yugiohdb/deck_search.action?request_locale=en");
        try {
          decks.push(
            ...(await searchKonamiDecks({
              query: args.query || args.archetype || args.category || "",
              limit: Math.min(limit, 5)
            }))
          );
        } catch (error) {
          errors.push(`Konami: ${(error as Error).message}`);
        }
      }

      if (source === "formatlibrary") {
        sourceUrls.push("https://www.formatlibrary.com/decks");
        try {
          decks.push(
            ...(await searchFormatLibraryDecks({
              query: args.query || args.archetype,
              format: args.format,
              limit
            }))
          );
        } catch (error) {
          errors.push(`Format Library: ${(error as Error).message}`);
        }
      }

      // Same list can appear on YGOPRODeck and Konami with different ids.
      // The deck itself is identified by its ydke, not by the source row.
      const byList = new Map<string, CommunityDeck>();
      const duplicatesRemoved: Array<{ name: string; kept: string; duplicateOf: string }> = [];
      for (const deck of decks) {
        const existing = byList.get(deck.ydke);
        if (existing) {
          existing.alsoFoundIn = [
            ...(existing.alsoFoundIn || []),
            { source: deck.source, url: deck.url, name: deck.name }
          ];
          duplicatesRemoved.push({ name: deck.name, kept: existing.name, duplicateOf: existing.url });
        } else {
          byList.set(deck.ydke, deck);
        }
      }
      const uniqueDecks = [...byList.values()];

      const db = CardDatabase.getInstance();
      if (args.includeNames) {
        for (const deck of uniqueDecks) {
          if (deck.cardNames) continue;
          const names = (list: number[]) => list.map(id => db.getCardById(id)?.name || `#${id}`);
          deck.cardNames = {
            main: names(deck.cards.main),
            extra: names(deck.cards.extra),
            side: names(deck.cards.side)
          };
        }
      }

      let combos: Awaited<ReturnType<typeof findCombos>> | undefined;
      if (args.includeCombos !== false) {
        const archetype = args.archetype || args.query;
        if (archetype) {
          try {
            combos = await findCombos({ archetype, limit: 10 });
            // A free-text query may be a card name, not an archetype.
            if (!combos.available && args.query) {
              const byCard = await findCombos({ card: args.query, limit: 10 });
              if (byCard.available) combos = byCard;
            }
          } catch (error) {
            errors.push(`Combos: ${(error as Error).message}`);
          }
        }
      }

      return {
        available: uniqueDecks.length > 0,
        count: uniqueDecks.length,
        duplicatesRemoved: duplicatesRemoved.length > 0 ? duplicatesRemoved : undefined,
        source: source,
        sourceNote,
        sourceUrls,
        categoryUrl,
        appliedFilters,
        fetchedAt: new Date().toISOString(),
        decks: uniqueDecks,
        combos,
        errors: errors.length > 0 ? errors : undefined,
        note:
          uniqueDecks.length === 0
            ? errors.length > 0
              ? `No deck could be fetched: ${errors.join(" | ")}`
              : "No deck matched. Check the archetype spelling, or pass source:'ygoprodeck' with a format alias such as tcg/ocg."
            : "Each deck carries its page URL and a ydke:// link. Feed the ydke into ygo_check_legality / ygo_deck_cost / ygo_consistency_lab / ygo_optimize_deck.",
        next: uniqueDecks[0]
          ? [
              { tool: "ygo_check_legality", args: { input: uniqueDecks[0].ydke }, why: "Verify banlist and size before recommending it." },
              { tool: "ygo_deck_cost", args: { input: uniqueDecks[0].ydke }, why: "Price the real list across markets." },
              { tool: "ygo_optimize_deck", args: { input: uniqueDecks[0].ydke }, why: "Grade staples and propose swaps." }
            ]
          : undefined
      };
    }
  },

  {
    name: "ygo_find_combos",
    description: `USE THIS for "how does this deck combo / what is the line" questions that need real combo data. Returns structured combos (starting cards + ordered steps) from Master Duel Meta's public combo API, filtered by archetype or by a specific card, each with a source URL. For a combo derived from a list you already hold, pass the deck to ygo_find_synergy_and_combos instead — this tool reports published combos, it does not invent them. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      archetype: z.string().optional().describe("Archetype / deck type (e.g. a deck type name)"),
      card: z.string().optional().describe("Card name to find combos that use it (searches the 300 newest public combos)"),
      limit: z.number().optional().default(10).describe("Max combos (1-30)")
    }),
    handler: async (args: any) => {
      if (!args.archetype && !args.card) {
        return { available: false, reason: "Provide an archetype or a card name." };
      }
      const result = await findCombos({ archetype: args.archetype, card: args.card, limit: args.limit });
      return {
        ...result,
        fetchedAt: new Date().toISOString(),
        note:
          "Combos are the site's published step-by-step lists, capped at the 300 newest entries. Absence here is not proof that no combo exists.",
        next: result.available
          ? [
              { tool: "ygo_find_community_decks", args: { archetype: result.archetype, includeCombos: false }, why: "See the real decks that use these lines." },
              { tool: "ygo_judge_card", args: { cardName: result.combos[0]?.startingCards?.[0] }, why: "Check the starter's actual script behaviour." }
            ]
          : undefined
      };
    }
  },

  {
    name: "ygo_find_counters",
    description: `USE THIS for "how do I beat this deck / what counters it / which card stops this combo". Returns published counter strategies from Master Duel Meta (counter cards with impact, chokepoints, and the author's explanation), filtered by archetype or by a card that appears as a counter. Each entry carries a source URL. This is community evidence, not a ruling — verify card behaviour with ygo_judge_card. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      archetype: z.string().optional().describe("Deck type to counter (e.g. a deck type name)"),
      card: z.string().optional().describe("Card name used as a counter/chokepoint, to find decks it answers"),
      limit: z.number().optional().default(5).describe("Max counter entries (1-20)")
    }),
    handler: async (args: any) => {
      if (!args.archetype && !args.card) {
        return { available: false, reason: "Provide an archetype or a card name." };
      }
      const result = await findCounters({ archetype: args.archetype, card: args.card, limit: args.limit });
      return {
        ...result,
        fetchedAt: new Date().toISOString(),
        note:
          "Counters are community submissions capped at the 300 newest entries. 'impact' is the author's label, not a measured win rate.",
        next: result.available
          ? [
              { tool: "ygo_judge_card", args: { cardName: result.counters[0]?.counterCards?.[0]?.name }, why: "Confirm the counter's actual effect and timing." },
              { tool: "ygo_find_community_decks", args: { archetype: result.archetype }, why: "See the builds these counters are aimed at." }
            ]
          : undefined
      };
    }
  },

  {
    name: "ygo_compare_decks",
    description: `USE THIS for "what do these two lists share", "core vs tech", or comparing a community deck with your own. Compares two decks section by section (Main/Extra/Side) and returns shared cards, cards only in A or B, and copy-count differences with an overlap percentage. Accepts .ydk paths, raw .ydk text, ydke:// links or DeckData. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      deckA: z.any().describe("First deck: .ydk path, raw .ydk text, ydke:// link or DeckData"),
      deckB: z.any().describe("Second deck: same accepted shapes")
    }),
    handler: async (args: any) => {
      if (args.deckA === undefined || args.deckB === undefined) {
        return { available: false, reason: "Provide both deckA and deckB." };
      }
      const [{ deck: a }, { deck: b }] = await Promise.all([
        loadDeckUniversal({ input: args.deckA }),
        loadDeckUniversal({ input: args.deckB })
      ]);
      if ((a.main || []).length === 0 || (b.main || []).length === 0) {
        return {
          available: false,
          reason: `Could not read both decks (A main=${(a.main || []).length}, B main=${(b.main || []).length}).`
        };
      }
      const db = CardDatabase.getInstance();
      const nameOf = (id: number) => db.getCardById(id)?.name || `#${id}`;
      const comparison = compareDecks(a, b, nameOf);
      return {
        available: true,
        decks: {
          a: { name: a.name, main: (a.main || []).length, extra: (a.extra || []).length, side: (a.side || []).length },
          b: { name: b.name, main: (b.main || []).length, extra: (b.extra || []).length, side: (b.side || []).length }
        },
        ...comparison,
        next: [
          { tool: "ygo_check_legality", args: { input: args.deckA }, why: "Confirm list A is legal before changing it." },
          { tool: "ygo_optimize_deck", args: { input: args.deckA }, why: "Grade list A and propose swaps." }
        ]
      };
    }
  },

  {
    name: "ygo_get_card",
    description: `USE THIS for every individual card fact: name, passcode, ATK/DEF, Level, attribute, type, effect text or banlist status. Look up one card by name or passcode. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      name: z.string().optional().describe("Card name (English)"),
      id: z.number().optional().describe("Card passcode (8 digits)")
    }),
    handler: async (args: any) => {
      const db = CardDatabase.getInstance();
      let card: any;
      let isLiveFetch = false;
      let source = "local_cache";
      let sourceError: string | undefined;

      // Always prefer a live YGOPRODeck lookup; the local cache is only a fallback.
      if (args.name || args.id) {
        try {
          card = await db.fetchCardOnline(args.id || args.name);
          if (card) {
            isLiveFetch = true;
            source = "ygoprodeck_live";
          }
        } catch (error) {
          sourceError = (error as Error).message;
        }
      }

      if (!card) {
        card = args.id ? db.getCardById(args.id) : (args.name ? db.getCardByName(args.name) : undefined);
      }
      if (!card) {
        const custom = args.id ? getCustomCard(args.id) : undefined;
        if (custom) {
          card = custom.cardData;
          source = "custom_registry";
        }
      }
      if (!card) {
        return {
          found: false,
          message: `No card found for ${args.name || args.id}`,
          freshness: {
            isLiveFetch: false,
            source,
            fetchedAt: new Date().toISOString(),
            error: sourceError
          }
        };
      }

      const yugipedia = card?.name ? await fetchYugipediaCardInfo(card.name) : undefined;
      return {
        found: true,
        card,
        freshness: {
          isLiveFetch,
          source,
          fetchedAt: new Date().toISOString(),
          sourceUrl: args.id
            ? `https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes&id=${args.id}`
            : `https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes&fname=${encodeURIComponent(args.name || "")}`,
          error: sourceError
        },
        yugipedia: yugipedia ? {
          url: yugipedia.url,
          japaneseName: yugipedia.japaneseName,
          romajiName: yugipedia.romajiName,
          translatedNames: yugipedia.translatedNames,
          triviaUrl: yugipedia.triviaUrl,
          tipsUrl: yugipedia.tipsUrl,
          rulingsUrl: yugipedia.rulingsUrl
        } : undefined
      };
    }
  },

  {
    name: "ygo_card_dossier",
    description: `USE THIS FIRST for a full card profile (database record + wiki + script provenance + optional rulings/prices). One call for everything about a card: official database record (stats, text), wiki record (names in 12 languages, Yu-Gi-Oh! Card Database ID, which tabs exist, page URL), script provenance (official/custom/generated/missing), and optional rulings summary and cached prices. Reports per-source status so a partial answer is explicit. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      name: z.string().optional().describe("Card name (English)"),
      passcode: z.number().optional().describe("Card passcode"),
      includeRulings: z.boolean().optional().default(false).describe("Include a rulings summary from the wiki (extra request)"),
      includePrices: z.boolean().optional().default(false).describe("Include cached market prices")
    }),
    handler: async (args: any) => {
      if (!args.name && typeof args.passcode !== "number") {
        return { available: false, reason: "Provide 'name' or 'passcode'." };
      }
      return buildCardDossier({
        name: args.name,
        passcode: args.passcode,
        includeRulings: Boolean(args.includeRulings),
        includePrices: Boolean(args.includePrices)
      });
    }
  },

  {
    name: "ygo_search_cards",
    description: `USE THIS whenever the task is card discovery (ATK, DEF, type, race, attribute, level, archetype, effect text) or a price-ranked list ("most expensive Dragon", "Spellcasters under $5"). Search the live card pool; do not list candidate cards from memory. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      name: z.string().optional().describe("Card name containing the keyword"),
      type: z.string().optional().describe("Card type: Normal Monster, Effect Monster, Spell Card, Trap Card, Link Monster,..."),
      race: z.string().optional().describe("Race: Spellcaster, Dragon, Warrior, Fiend, Cyberse, Pyro, ..."),
      attribute: z.string().optional().describe("Attribute: LIGHT, DARK, FIRE, WATER, EARTH, WIND, DIVINE"),
      level: z.number().optional().describe("Level / Rank"),
      atk: z.number().optional().describe("Exact ATK"),
      def: z.number().optional().describe("Exact DEF"),
      minAtk: z.number().optional().describe("Minimum ATK"),
      maxAtk: z.number().optional().describe("Maximum ATK"),
      archetype: z.string().optional().describe("Archetype name (e.g. an archetype)"),
      desc: z.string().optional().describe("Keyword present in the effect text"),
      minPrice: z.number().optional().describe("Minimum USD market price (switches to the market index)"),
      maxPrice: z.number().optional().describe("Maximum USD market price (switches to the market index)"),
      sortBy: z
        .enum(["price_desc", "price_asc", "demand", "liquidity_adjusted", "release_desc", "name_asc"])
        .optional()
        .describe("Sort order. price_* / demand / liquidity_adjusted require the market index; release_desc = newest TCG release first"),
      limit: z.number().optional().default(20).describe("Max results (1-50)")
    }),
    handler: async (args: any) => {
      const wantsMarket =
        args.minPrice !== undefined ||
        args.maxPrice !== undefined ||
        (args.sortBy && args.sortBy !== "name_asc");

      if (wantsMarket) {
        // Price/momentum questions ("cards under $5", "most expensive Dragon") are
        // ranking problems over the whole pool, not stat filters over a cache.
        const market = await runMarketQuery({
          intent: "search",
          query: args.name,
          type: args.type,
          race: args.race,
          attribute: args.attribute,
          archetype: args.archetype,
          levelMin: args.level,
          levelMax: args.level,
          atkMin: typeof args.minAtk === "number" ? args.minAtk : args.atk,
          atkMax: typeof args.maxAtk === "number" ? args.maxAtk : args.atk,
          minPrice: args.minPrice,
          maxPrice: args.maxPrice,
          sortBy: args.sortBy || "price_desc",
          limit: Math.min(Math.max(args.limit ?? 20, 1), 50)
        });
        return { delegatedTo: "market_index", ...market };
      }

      const db = CardDatabase.getInstance();
      let results = db.searchCards(args);
      let isLiveFetch = false;
      let source = "local_cache";
      let sourceError: string | undefined;

      // Complex local filters need the whole card pool. Refresh it when the cache is
      // older than 24h so newly released cards are searchable.
      if (!args.name && !args.archetype) {
        const refreshed = await db.ensureFresh(24).catch(() => false);
        if (refreshed) {
          results = db.searchCards(args);
          isLiveFetch = true;
          source = "ygoprodeck_live";
        }
      }

      // Name/archetype searches are cheap server-side filters: always refresh from
      // YGOPRODeck so a stale local cache can never shadow a newly released card.
      if (args.name || args.archetype) {
        try {
          const axiosModule = await import("axios");
          const axios = axiosModule.default || axiosModule;
          const params: Record<string, any> = { misc: "yes" };
          if (args.name) params.fname = args.name.trim();
          if (args.archetype) params.archetype = args.archetype.trim();
          const resp = await axios.get("https://db.ygoprodeck.com/api/v7/cardinfo.php", { params, timeout: 12000 });
          if (resp.data && Array.isArray(resp.data.data)) {
            for (const c of resp.data.data) {
              db.cards.set(c.id, c);
              db.nameIndex.set(c.name.toLowerCase(), c);
            }
            results = db.searchCards(args);
            isLiveFetch = true;
            source = "ygoprodeck_live";
          }
        } catch (error) {
          sourceError = (error as Error).message;
        }
      }

      return {
        totalFound: results.length,
        cards: results.slice(0, Math.min(Math.max(args.limit ?? 20, 1), 50)).map((c: any) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          race: c.race,
          attribute: c.attribute,
          level: c.level,
          atk: c.atk,
          def: c.def,
          desc: (c.desc || "").slice(0, 250) + "..."
        })),
        freshness: {
          isLiveFetch,
          source,
          fetchedAt: new Date().toISOString(),
          sourceUrl: "https://db.ygoprodeck.com/api/v7/cardinfo.php",
          cacheAgeHours: db.cacheTimestamp ? Math.round((Date.now() - db.cacheTimestamp) / 3600000) : null,
          error: sourceError
        }
      };
    }
  },

  {
    name: "ygo_find_synergy_and_combos",
    description: `USE THIS for "find a card that does X" or "how do I search it" questions. Find monsters/cards by concrete stats (e.g. 1850 ATK Spellcaster), match them against your deck's existing searchers, and output the combo line. Do not invent search targets from memory. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      filter: z.object({
        race: z.string().optional().describe("Race: Spellcaster, Dragon, Warrior, ..."),
        atk: z.number().optional().describe("Exact ATK (e.g. 1850)"),
        attribute: z.string().optional().describe("Attribute: LIGHT, DARK, ..."),
        level: z.number().optional().describe("Level"),
        type: z.string().optional().describe("Card type")
      }),
      deck: z.any().optional().describe("DeckData, or .ydk / ydke:// content"),
      desiredPayoff: z.string().optional().default("disruption").describe("Desired role: negate, floodgate, disruption, draw, recur")
    }),
    handler: async (args: any) => {
      let deckData: DeckData | undefined;
      if (args.deck) {
        if (typeof args.deck === "string") {
          if (args.deck.startsWith("ydke://")) deckData = parseYdke(args.deck);
          else deckData = parseYdk(args.deck);
        } else if (args.deck.main) {
          deckData = args.deck;
        }
      }
      const db = CardDatabase.getInstance();
      const refreshed = await db.ensureFresh(24).catch(() => false);
      const result = await findSynergyAndSearchers({
        filter: args.filter,
        deck: deckData,
        desiredPayoff: args.desiredPayoff
      });
      return {
        ...result,
        freshness: {
          isLiveFetch: refreshed,
          source: refreshed ? "ygoprodeck_live" : "local_cache",
          fetchedAt: new Date().toISOString(),
          cacheAgeHours: db.cacheTimestamp ? Math.round((Date.now() - db.cacheTimestamp) / 3600000) : null
        }
      };
    }
  },

  {
    name: "ygo_judge_card",
    description: `USE THIS for every ruling question about a specific card. Full mechanics adjudication from the ProjectIgnis Lua source: HOPT/SOPT, cost vs effect, targeting, miss timing, Damage Step, negate activation vs negate effect. Accepts a passcode or a card name, reports the script provenance (official/custom/generated/missing) and attaches rulebook + PSCT citations. Do not assert a ruling from memory. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      passcode: z.number().optional().describe("Card passcode"),
      cardName: z.string().optional().describe("Card name (used to resolve the passcode when 'passcode' is omitted)")
    }),
    handler: async (args: any) => {
      let passcode: number | undefined = args.passcode;
      let resolvedName = args.cardName as string | undefined;

      if (!passcode && args.cardName) {
        try {
          const found = await CardDatabase.getInstance().fetchCardOnline(args.cardName);
          if (found) {
            passcode = found.id;
            resolvedName = found.name;
          }
        } catch {
          // fall through to the explicit error below
        }
      }

      if (!passcode) {
        return {
          available: false,
          reason: "Provide 'passcode', or a 'cardName' that the card database recognises."
        };
      }

      const script = await resolveCardScript(passcode, { allowGenerate: false });
      const analysis = await analyzeCardMechanics(
        passcode,
        resolvedName,
        script.available ? script.text : undefined
      );

      const mechanics: Mechanic[] = [];
      if (analysis.negationProperties?.negatesActivation || analysis.negationProperties?.negatesEffect) mechanics.push("negation");
      if (analysis.costProperties?.hasCost) mechanics.push("cost");
      if (analysis.targetingProperties?.targets) mechanics.push("targeting");
      if (analysis.timingProperties?.canMissTiming) mechanics.push("timing");
      if (analysis.effects.some((e) => e.isHOPT)) mechanics.push("hopt");
      if (analysis.effects.some((e) => (e.effectType || []).some((t) => t.includes("QUICK")))) mechanics.push("chain");
      if (analysis.effects.some((e) => (e.categories || []).some((c) => c.includes("SPECIAL_SUMMON")))) mechanics.push("summon");
      if (mechanics.length === 0) mechanics.push("chain");

      const citations = citationsForMechanics(mechanics, 4);

      return {
        ...analysis,
        script: {
          provenance: script.provenance ?? "missing",
          path: script.path,
          generated: script.provenance === "generated",
          note:
            script.provenance === "generated"
              ? "This analysis used an auto-generated script. Do not rely on it for tournament rulings."
              : script.provenance
                ? undefined
                : "No script found. Call ygo_ensure_script to generate a temporary one."
        },
        citations
      };
    }
  },

  {
    name: "ygo_analyze_lua",
    description: "Parse the Lua structure of ANY card script with an AST (luaparse), not just official ones: effects, condition/cost/target/operation, summon procedures (Fusion/Synchro/Xyz/Link/Pendulum), Effect API calls, constants and simulator-profile warnings.",
    parameters: z.object({
      luaCode: z.string().optional().describe("Raw Lua script content"),
      luaPath: z.string().optional().describe("Absolute/relative path to a .lua file"),
      passcode: z.number().optional().describe("Passcode to cross-reference (default 0)"),
      includeApiCalls: z.boolean().optional().default(false).describe("Include every API call (may be long)"),
      deep: z.boolean().optional().default(false).describe("Also return the deep insight layer: effect kinds, cost/target/operation pipeline, count limits, risks and complexity")
    }),
    handler: async (args: any) => {
      let code = args.luaCode as string | undefined;
      if (!code && args.luaPath) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const resolved = path.isAbsolute(args.luaPath) ? args.luaPath : path.resolve(process.cwd(), args.luaPath);
        if (!fs.existsSync(resolved)) {
          return { parsed: false, error: `File not found: ${resolved}` };
        }
        code = fs.readFileSync(resolved, "utf-8");
      }
      if (!code) {
        return { parsed: false, error: "Provide luaCode or luaPath." };
      }
      const analysis = analyzeLuaCard(code, args.passcode || 0);
      const insights = args.deep ? analyzeScriptDeep(code, args.passcode || 0) : undefined;
      if (!args.includeApiCalls) {
        return { ...analysis, apiCalls: analysis.apiCalls.slice(0, 40), insights };
      }
      return { ...analysis, insights };
    }
  },

  {
    name: "ygo_script_insights",
    description: "Deep card-script analysis. `card` mode explains every effect: kind (ignition/trigger/quick/continuous/flip/summon), trigger event, whether the condition/cost/target/operation pipeline is complete, what it costs, whether it targets, reset duration, hard/soft/duel once-per-turn, plus structural risks (missing LoadScript, invalid constants, target without operation, skeleton code) and complexity metrics. `corpus` mode aggregates a whole folder of scripts: effect-kind distribution, most common trigger events and categories, count-limit mix, recurring risks and the worst offenders.",
    parameters: z.object({
      mode: z.enum(["card", "corpus"]).default("card").describe("card = one script; corpus = aggregate a folder"),
      passcode: z.number().optional().describe("Card passcode (card mode)"),
      cardName: z.string().optional().describe("Card name, resolved to a passcode (card mode)"),
      luaCode: z.string().optional().describe("Raw Lua (card mode)"),
      luaPath: z.string().optional().describe("Path to a .lua file (card mode)"),
      dir: z.string().optional().describe("Folder of c<id>.lua files (corpus mode; defaults to the cached official scripts)"),
      limit: z.number().optional().default(200).describe("Maximum scripts to scan in corpus mode")
    }),
    handler: async (args: any) => {
      const fs = await import("node:fs");
      const path = await import("node:path");

      if (args.mode === "corpus") {
        const root = process.cwd();
        const dir = args.dir
          ? (path.isAbsolute(args.dir) ? args.dir : path.resolve(root, args.dir))
          : path.resolve(root, "data", "ocgcore-scripts", "official");

        if (!fs.existsSync(dir)) {
          return { available: false, reason: `Folder not found: ${dir}` };
        }

        const files = fs.readdirSync(dir).filter((f) => /^c\d+\.lua$/.test(f)).slice(0, Math.max(1, Math.min(args.limit || 200, 2000)));
        if (files.length === 0) {
          return { available: false, reason: `No c<id>.lua files in ${dir}` };
        }

        const entries = files.map((file) => ({
          passcode: Number(file.match(/^c(\d+)\.lua$/)![1]),
          lua: fs.readFileSync(path.join(dir, file), "utf-8")
        }));

        return {
          available: true,
          folder: dir,
          ...analyzeScriptCorpus(entries)
        };
      }

      let passcode = args.passcode as number | undefined;
      if (!passcode && args.cardName) {
        try {
          const found = await CardDatabase.getInstance().fetchCardOnline(args.cardName);
          if (found) passcode = found.id;
        } catch {
          // fall through
        }
      }

      let code = args.luaCode as string | undefined;
      if (!code && args.luaPath) {
        const resolved = path.isAbsolute(args.luaPath) ? args.luaPath : path.resolve(process.cwd(), args.luaPath);
        if (!fs.existsSync(resolved)) return { available: false, reason: `File not found: ${resolved}` };
        code = fs.readFileSync(resolved, "utf-8");
      }
      if (!code && passcode) {
        const resolved = await resolveCardScript(passcode, { allowGenerate: false });
        if (resolved.available) code = resolved.text;
        else return { available: false, reason: resolved.reason || "No script found for this card." };
      }
      if (!code) {
        return { available: false, reason: "Provide passcode, cardName, luaCode or luaPath for card mode." };
      }

      return { available: true, ...analyzeScriptDeep(code, passcode || 0) };
    }
  },

  {
    name: "ygo_judge_interaction",
    description: "Official ruling on the interaction between two specific cards, grounded in the ocgcore engine and the Konami rulebook.",
    parameters: z.object({
      cardA: z.string().describe("Name or passcode of card A"),
      cardB: z.string().describe("Name or passcode of card B"),
      question: z.string().describe("Scenario description or interaction question")
    }),
    handler: async (args: any) => {
      const adjudication = await judgeInteraction(args.cardA, args.cardB, args.question);
      return {
        adjudication,
        citations: citationsForQuestion(`${args.question} ${args.cardA} ${args.cardB}`, 3)
      };
    }
  },

  {
    name: "ygo_build_meta_deck",
    description: `USE THIS whenever the user asks you to build, produce or suggest a decklist. Build a tournament-legal deck (40-60 Main, up to 15 Extra, 15 Side) that respects the banlist of the chosen format (TCG, OCG, AE, Genesys, Master Duel), with strategy, staples and a legal list. Every generated list is re-validated (banlist, sizes, Extra Deck placement) before it is returned. If the archetype has no template the tool returns available:false plus availableArchetypes — it never substitutes another deck. Never output a decklist from memory; every card must come from this tool's response.`,
    parameters: z.object({
      archetype: z.string().describe("Archetype name (e.g. an archetype)"),
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).default("TCG").describe("Format (TCG, OCG, Asian-English AE, Genesys, Master Duel)"),
      goSecond: z.boolean().optional().describe("Play second (blind 2nd)"),
      targetCount: z.number().min(40).max(60).optional().default(40).describe("Desired Main Deck size (40-60 cards)")
    }),
    handler: async (args: any) => {
      return await buildCompetitiveDeck(args);
    }
  },

  {
    name: "ygo_optimize_deck",
    description: `USE THIS when the user asks to upgrade, fix or grade an existing deck. Grade the staple / hand-trap / board-breaker ratio and propose upgrades under the current banlist and meta. Do not propose replacement cards from memory; start from this tool's output. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      deck: z
        .any()
        .describe("DeckData, a .ydk file path, raw .ydk text, a ydke:// link, or a plain card list"),
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).default("TCG").describe("Format (TCG, OCG, AE, Genesys, Master Duel)")
    }),
    handler: async (args: any) => {
      // One loader for every input shape (path, ydke, ydk text, object, card list).
      const { deck: deckData } = await loadDeckUniversal({ input: args.deck });
      const mainCount = (deckData.main || []).length;
      if (mainCount === 0) {
        throw new Error(
          "Could not read any cards from the input deck (0 cards). Check the file path, the .ydk content, or the ydke:// link."
        );
      }

      const result = await optimizeUserDeck(deckData, args.format);
      const legality = await checkDeckLegality(result.optimizedDeck, args.format);

      return {
        ...result,
        inputMainCount: mainCount,
        legality,
        // Be explicit when the input was already broken: the optimiser cannot
        // invent a legal deck out of an illegal one.
        inputWarnings: [
          ...(mainCount < 40 ? [`Input Main Deck has only ${mainCount} cards; a legal deck needs 40-60.`] : []),
          ...(legality.valid ? [] : [`Optimised deck is not legal in ${args.format}: ${legality.errors.join("; ")}`])
        ]
      };
    }
  },

  {
    name: "ygo_create_custom_card",
    description: "Register a newly revealed or fan-made card: assign a temporary ID (990000000+), generate a ProjectIgnis Lua script and render an SVG mockup.",
    parameters: z.object({
      name: z.string().describe("Card name"),
      type: z.string().describe("Card type (e.g. Effect Monster, Spell Card, Trap Card, Link Monster)"),
      attribute: z.string().optional().describe("Attribute (LIGHT, DARK, FIRE, ...)"),
      race: z.string().optional().describe("Race (Spellcaster, Dragon, ...)"),
      level: z.number().optional().describe("Level / Rank / Link Rating"),
      atk: z.number().optional().describe("ATK"),
      def: z.number().optional().describe("DEF"),
      desc: z.string().describe("Card effect text"),
      origin: z.enum(["unreleased_official", "custom_fanmade"]).default("unreleased_official").describe("Card source"),
      sourceUrl: z.string().optional().describe("Link to the reveal article (YGOrganization...)")
    }),
    handler: async (args: any) => {
      const record = registerCustomCard({
        name: args.name,
        cardData: {
          name: args.name,
          type: args.type,
          attribute: args.attribute,
          race: args.race,
          level: args.level,
          atk: args.atk,
          def: args.def,
          desc: args.desc
        },
        origin: args.origin,
        sourceUrl: args.sourceUrl
      });
      return {
        success: true,
        record,
        message: `Custom card created with temporary ID ${record.tempId}. Lua file: ${record.luaPath}`
      };
    }
  },

  {
    name: "ygo_migrate_temp_card",
    description: "Replace a temporary ID with the official Konami passcode once it is announced, rewriting the registry, the script and every saved .ydk.",
    parameters: z.object({
      tempId: z.number().describe("Previous temporary ID (990000000+ range)"),
      officialId: z.number().describe("Official 8-digit Konami passcode"),
      ydkFilesToUpdate: z.array(z.string()).optional().describe("List of .ydk file paths to update automatically")
    }),
    handler: async (args: any) => {
      return migrateTempId(args.tempId, args.officialId, args.ydkFilesToUpdate);
    }
  },

  {
    name: "ygo_check_prices",
    description: "Multi-market price lookup: TCGPlayer (US TCG), Yuyu-tei (JP OCG) and TCGCorner (AE Asian-English). Yuyu-tei is queried with the resolved Japanese card name; when nothing matches, the quote is a search link with price 0 — never a guessed number. This returns one aggregate per card: for per-rarity or per-language printings use ygo_card_printing_prices.",
    parameters: z.object({
      cardName: z.string().describe("Card name in English"),
      passcode: z.number().optional().describe("Card passcode, if known")
    }),
    handler: async (args: any) => {
      return await getMultiMarketPrices(args.cardName, args.passcode);
    }
  },

  {
    name: "ygo_market_query",
    description: `USE THIS for market questions that are NOT about one named card: "which card is the most expensive", "what is rising", "what is hot under $5", "why did this card's price move". It ranks and filters the entire card pool by price, demand and measured movement, then correlates the result with YGOrganization news, banlist status, release windows and the live meta. For "expensive but actually sellable", use sortBy: "liquidity_adjusted" (price × demand on log scales) instead of raw price. Ranking is US-based (TCGPlayer/Cardmarket via YGOPRODeck) because Yuyu-tei and TCGCorner have no bulk price feed; set includeMarkets to attach their live quotes for the top results (explain does it by default). Use ygo_check_prices only for a single card's shop-by-shop quotes. Never answer "most expensive / rising" from memory: call this and quote priceBasis, confidence and the data caveats. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      intent: z
        .enum(["top_price", "movers", "explain", "search"])
        .optional()
        .default("top_price")
        .describe(
          "top_price = rank by price (most expensive first); movers = measured price change from daily snapshots; explain = why a card's price is where it is (news/banlist/release/meta); search = filter + rank"
        ),
      query: z.string().optional().describe("Free-text name/archetype/type keyword, e.g. an archetype name"),
      card: z.string().optional().describe("Card name to explain (intent=explain)"),
      archetype: z.string().optional().describe("Archetype filter"),
      type: z.string().optional().describe("Card type filter: Effect Monster, Spell Card, Link Monster, ..."),
      race: z.string().optional().describe("Race filter: Spellcaster, Dragon, Cyberse, ..."),
      attribute: z.string().optional().describe("Attribute filter: LIGHT, DARK, FIRE, ..."),
      levelMin: z.number().optional().describe("Minimum Level/Rank"),
      levelMax: z.number().optional().describe("Maximum Level/Rank"),
      atkMin: z.number().optional().describe("Minimum ATK"),
      atkMax: z.number().optional().describe("Maximum ATK"),
      minPrice: z.number().optional().describe("Minimum USD price"),
      maxPrice: z.number().optional().describe("Maximum USD price"),
      banlist: z
        .enum(["Forbidden", "Limited", "Semi-Limited", "Unlimited"])
        .optional()
        .describe("TCG banlist status filter"),
      releasedWithinDays: z.number().optional().describe("Only cards released in the last N days (e.g. 90)"),
      minWeeklyViews: z
        .number()
        .optional()
        .describe(
          "Liquidity floor: keep only cards with at least N weekly views. Use this to drop collector-only cards nobody actually buys (e.g. minWeeklyViews: 1000)."
        ),
      priceBasis: z
        .enum(["market", "top_printing", "floor"])
        .optional()
        .default("market")
        .describe(
          "market = typical cheapest copy (default); top_printing = collector printing; floor = cheapest printing"
        ),
      sortBy: z
        .enum(["price_desc", "price_asc", "demand", "liquidity_adjusted", "release_desc", "name_asc"])
        .optional()
        .describe("Ranking for intent=search. Defaults to price_desc."),
      windowDays: z.number().optional().default(30).describe("Window for intent=movers (7/30/90)"),
      limit: z.number().optional().default(10).describe("Max results (1-50)"),
      includeNews: z.boolean().optional().default(false).describe("Attach matching news articles to the answer"),
      includeMarkets: z
        .boolean()
        .optional()
        .describe(
          "Attach live Yuyu-tei (JPY) and TCGCorner (HKD) quotes. Ranking always uses TCGPlayer/Cardmarket; enrichment covers the top 3 results (explain: the card itself). Defaults to true for intent=explain."
        )
    }),
    handler: async (args: any) => {
      const result = await runMarketQuery({
        intent: args.intent,
        query: args.query,
        card: args.card,
        archetype: args.archetype,
        type: args.type,
        race: args.race,
        attribute: args.attribute,
        levelMin: args.levelMin,
        levelMax: args.levelMax,
        atkMin: args.atkMin,
        atkMax: args.atkMax,
        minPrice: args.minPrice,
        maxPrice: args.maxPrice,
        banlist: args.banlist,
        releasedWithinDays: args.releasedWithinDays,
        minWeeklyViews: args.minWeeklyViews,
        priceBasis: args.priceBasis,
        sortBy: args.sortBy,
        windowDays: args.windowDays,
        limit: args.limit,
        includeNews: args.includeNews,
        includeMarkets: args.includeMarkets
      });

      return {
        ...result,
        next:
          args.intent === "explain"
            ? {
                tool: "ygo_market_query",
                args: { intent: "movers", windowDays: 30 },
                why: "Check whether the card is part of a measured market move."
              }
            : {
                tool: "ygo_market_query",
                args: { intent: "explain", card: "<top result name>" },
                why: "Explain the driver behind the top result (news, banlist, release, demand)."
              }
      };
    }
  },

  {
    name: "ygo_card_printing_prices",
    description: `USE THIS for any question about "which printing is cheaper", "how much is the Secret Rare", "KR version price", or comparing rarities of the same card. Returns a per-printing table (set code, set name, rarity, language) where each row has a price ONLY if a source actually lists that printing; otherwise price is null. Covers EN (TCGplayer per-product), JP (Yuyu-tei) and AE (TCGCorner); KR, DE/FR/IT/SP/PT and SC/TC have no public per-printing feed and are returned as price:null with a note. Never infer a price from rarity — call this instead. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      cardName: z.string().describe("Card name in English"),
      maxSets: z.number().optional().default(8).describe("How many EN sets to inspect (1-20); each set costs 2 upstream requests"),
      includeLive: z.boolean().optional().default(true).describe("Fetch live JP/AE listings and TCGplayer per-printing prices")
    }),
    handler: async (args: any) => {
      return getPrintingPrices(args.cardName, {
        maxSets: args.maxSets,
        includeLive: args.includeLive
      });
    }
  },

  {
    name: "ygo_get_news",
    description: "Fetch new card reveals, banlist news and tournament coverage from the YGOrganization RSS feed.",
    parameters: z.object({
      limit: z.number().optional().default(10).describe("Number of articles to fetch")
    }),
    handler: async (args: any) => {
      const articles = await getLatestYgoNews(args.limit);
      return {
        count: articles.length,
        articles: articles.map((a) => ({
          ...a,
          next: a.isCardReveal
            ? {
                tool: "ygo_ensure_script",
                args: { topic: "from-news", url: a.link },
                why: "Read the article, extract the card and generate a temporary script."
              }
            : undefined
        })),
        freshness: {
          isLiveFetch: articles.length > 0,
          source: "ygorganization_rss",
          sourceUrl: "https://ygorganization.com/feed/",
          fetchedAt: new Date().toISOString(),
          note: articles.length === 0
            ? "The RSS feed did not respond or has no new posts; no fake fallback news is returned."
            : "Live RSS parse."
        }
      };
    }
  },

  {
    name: "ygo_get_rulebook",
    description: "Official Konami rulebook (PDF from yugioh-card.com/en/rulebook/): verbatim text with printed page citations. Topics: status, official, search, section, page. The timing/damage_step/segoc/mechanics topics are curated summaries, not official text.",
    parameters: z.object({
      topic: z.enum(["status", "official", "search", "section", "page", "timing", "damage_step", "segoc", "mechanics"])
        .describe("status = loaded rulebook state; official/search = verbatim text with page numbers; section = full section; page = full page; timing/damage_step/segoc/mechanics = curated summaries"),
      query: z.string().optional().describe("Question or keyword (for topic official/search/column)"),
      page: z.number().optional().describe("Printed page number to read in full (for topic page)"),
      term: z.string().optional().describe("Specific term (for topic mechanics)"),
      refresh: z.boolean().optional().default(false).describe("Re-download the latest PDF from Konami before answering")
    }),
    handler: async (args: any) => {
      if (args.topic === "timing") return { source: "curated_summary", guide: getFastEffectTimingGuide() };
      if (args.topic === "damage_step") return { source: "curated_summary", guide: getDamageStepGuide() };
      if (args.topic === "segoc") return { source: "curated_summary", guide: getSegocGuide() };
      if (args.topic === "mechanics") {
        return { source: "curated_summary", guide: explainMechanic(args.term || "cost vs effect") };
      }

      if (args.topic === "status") {
        if (args.refresh) {
          const sync = await syncOfficialRulebook({ force: true });
          return { status: getRulebookStatus(), sync };
        }
        const cached = getRulebookStatus();
        if (!cached.loaded) {
          const sync = await syncOfficialRulebook({});
          return { status: getRulebookStatus(), sync };
        }
        return { status: cached };
      }

      // Official-text topics: make sure the PDF index exists before answering.
      await ensureRulebook({ refresh: Boolean(args.refresh) });

      if (args.topic === "page") {
        if (typeof args.page !== "number") {
          return { available: false, reason: "Pass 'page' (printed page number) for topic=\"page\"." };
        }
        const result = getRulebookText(args.page);
        if (!result.available) return result;
        return {
          available: true,
          source: "official_konami_rulebook",
          citation: `Official Rulebook v10, p.${result.page!.page}`,
          section: result.section,
          page: result.page!.page,
          text: result.page!.text
        };
      }

      if (args.topic === "section") {
        const title = args.query || args.term;
        if (!title) {
          return { source: "official_konami_rulebook", ...getRulebookSections() };
        }
        const result = getRulebookSectionPage(title);
        if (!result.available) return result;
        return {
          available: true,
          source: "official_konami_rulebook",
          section: result.section,
          citation: `Official Rulebook v10, ${result.section!.title} (p.${result.section!.startPage}-${result.section!.endPage})`,
          text: result.text
        };
      }

      const query = args.query || args.term;
      if (!query) {
        return {
          source: "official_konami_rulebook",
          ...getRulebookSections(),
          hint: "Pass 'query' to search verbatim text, 'page' to read one page, or 'query' + topic=\"section\" to read a whole section."
        };
      }

      if (args.topic === "search") {
        return { source: "official_konami_rulebook", ...searchRulebook(query, 6) };
      }

      const excerpt = getOfficialRulebookExcerpt(query, 4);
      return {
        source: "official_konami_rulebook",
        ...excerpt,
        note: "These are verbatim quotes from the official PDF. Do not infer beyond these passages."
      };
    }
  },

  {
    name: "ygo_get_policy",
    description: "Official Konami judge corpus: Tournament Policy (KDE-US), Tournament Infractions & Penalties, Speed Duel/Remote Duel addenda, Fast Effect Timing, Advanced Rules, PSCT series, Judge Program and Judge FAQ. Verbatim text with document, version and page citations.",
    parameters: z.object({
      topic: z.enum(["status", "list", "search", "section", "page"])
        .describe("status = corpus state; list = document list; search = verbatim text with citations; section = a full section; page = a full page"),
      query: z.string().optional().describe("Question/keyword (search) or section title (section)"),
      document: z.string().optional().describe("Document ID: tournament-policy, penalties, speed-duel-addendum, remote-duel-addendum, remote-duel-guide, fast-effect-timing, advanced-rules, rules-update-2021, judge-program, judge-faq"),
      page: z.number().optional().describe("Page number (topic=page)"),
      refresh: z.boolean().optional().default(false).describe("Re-sync the latest documents from Konami")
    }),
    handler: async (args: any) => {
      if (args.topic === "status") {
        if (args.refresh) {
          const sync = await syncJudgeCorpus({ force: true });
          return { status: getJudgeCorpusStatus(), sync };
        }
        const status = getJudgeCorpusStatus();
        if (!status.loaded) {
          const sync = await syncJudgeCorpus({});
          return { status: getJudgeCorpusStatus(), sync };
        }
        return { status };
      }

      if (args.topic === "list") {
        const docs = listJudgeDocuments();
        if (docs.every((d) => !d.available)) await syncJudgeCorpus({});
        return { source: "official_konami_documents", documents: listJudgeDocuments() };
      }

      if (args.topic === "page") {
        if (!args.document) {
          return { available: false, reason: "Pass 'document' for topic=\"page\"." };
        }
        if (typeof args.page !== "number") {
          return { available: false, reason: "Pass 'page' (page number) for topic=\"page\"." };
        }
        await ensureJudgeCorpus({ refresh: Boolean(args.refresh) });
        const result = getJudgeDocPage(args.document, args.page);
        if (!result.available) return result;
        return {
          available: true,
          source: "official_konami_documents",
          citation: citationFor(args.document, result.page),
          document: result.document,
          version: result.version,
          page: result.page,
          text: result.text
        };
      }

      if (args.topic === "section") {
        if (!args.document) {
          return { available: false, reason: "Pass 'document' for topic=\"section\"." };
        }
        if (!args.query && !args.term) {
          return { available: false, reason: "Pass 'query' (section title) for topic=\"section\"." };
        }
        await ensureJudgeCorpus({ refresh: Boolean(args.refresh) });
        const result = getJudgeDocSection(args.document, (args.query || args.term) as string);
        if (!result.available) return result;
        return {
          available: true,
          source: "official_konami_documents",
          citation: citationFor(args.document, undefined, result.section),
          document: result.document,
          version: result.version,
          section: result.section,
          text: result.text
        };
      }

      // topic === "search" (default path)
      const query = args.query || args.term;
      if (!query) {
        const docs = listJudgeDocuments();
        if (docs.every((d) => !d.available)) await syncJudgeCorpus({});
        return {
          source: "official_konami_documents",
          documents: listJudgeDocuments(),
          hint: "Pass 'query' to search verbatim text, 'document' to limit to one document, 'page'/'section' to read in full."
        };
      }

      await ensureJudgeCorpus({ refresh: Boolean(args.refresh) });
      const result = searchJudgeDocs(query, { document: args.document, limit: 6 });
      return {
        source: "official_konami_documents",
        ...result,
        note: "Verbatim quotes from Konami's official documents. Do not infer beyond these passages."
      };
    }
  },

  {
    name: "ygo_wiki",
    description: "Yugipedia lookup: cards (names in 12 languages, passcode, Yu-Gi-Oh! Card Database ID, archetype, which tabs exist), tabs (Gallery / Rulings / Errata / Artworks / Tips / Trivia / Appearances / Names / Lores), pages (sets, products, archetypes) and search. Resolves by name, passcode or database ID.",
    parameters: z.object({
      topic: z.enum(["card", "tab", "page", "search", "status"])
        .describe("card = card info; tab = Gallery/Rulings/... subpage; page = set/product/archetype; search = find a page; status = cache"),
      input: z.string().optional().describe("Card name / passcode / database ID / page title (e.g. 46986414, 22132, or a page title)"),
      tab: z.enum(["gallery", "rulings", "errata", "artworks", "tips", "trivia", "appearances", "names", "lores"])
        .optional().describe("Subpage to read (topic=tab)"),
      section: z.string().optional().describe("Section title within the page (e.g. 'Other languages', 'Playing style')"),
      query: z.string().optional().describe("Search keyword (topic=search)"),
      imagesOnly: z.boolean().optional().default(false).describe("Return only the image list (useful for gallery/artworks)"),
      refresh: z.boolean().optional().default(false).describe("Bypass the 7-day cache and reload")
    }),
    handler: async (args: any) => {
      if (args.topic === "status") return { ...getWikiStatus(), source: "yugipedia" };

      if (args.topic === "search") {
        const query = args.query || args.input;
        if (!query) return { available: false, reason: "Pass 'query' or 'input' for topic=\"search\"." };
        const results = await searchWiki(query, 10);
        return {
          source: "yugipedia",
          available: results.length > 0,
          query,
          results,
          license: YUGIPEDIA_LICENSE,
          reason: results.length === 0 ? "No results on Yugipedia." : undefined
        };
      }

      if (!args.input) {
        return { available: false, reason: "Pass 'input' (card name, passcode, database ID or page title)." };
      }

      if (args.topic === "tab") {
        if (!args.tab) {
          return { available: false, reason: "Pass 'tab' for topic=\"tab\"." };
        }
        return {
          source: "yugipedia",
          ...(await getWikiCardTab(args.input, args.tab, { refresh: Boolean(args.refresh), imagesOnly: Boolean(args.imagesOnly) }))
        };
      }

      if (args.topic === "page") {
        return {
          source: "yugipedia",
          ...(await getWikiPage(args.input, { refresh: Boolean(args.refresh), section: args.section, images: Boolean(args.imagesOnly) }))
        };
      }

      return {
        source: "yugipedia",
        ...(await getWikiCard(args.input, { refresh: Boolean(args.refresh), section: args.section }))
      };
    }
  },

  {
    name: "ygo_judge_scenario",
    description: "Run a REAL duel scenario on ocgcore-wasm, then check the judge's expectations against the engine and conclude. Returns verdict (CONFIRMED/REFUTED/INCONCLUSIVE), the actual chain link by link, the action transcript, engine evidence per expectation, final field/LP, and rulebook/policy citations. Presets cover the common negate and protection cases.",
    parameters: z.object({
      preset: z.enum(["negate-protected", "negate-unprotected", "hopt-after-negate", "draw-blocked"])
        .optional().describe("Run a built-in preset scenario"),
      scenario: z.string().optional().describe("JSON of a custom ScenarioSpec: { name, description, handA, handB, deckA, deckB, extraA, extraB, decisions, expect }"),
      citations: z.boolean().optional().default(true).describe("Attach relevant rulebook/policy citations"),
      deck: z.string().optional().describe("Player A deck as ydke:// link, .ydk content/path or a text card list (used when the scenario omits deckA)"),
      opponentDeck: z.string().optional().describe("Player B deck as ydke:// link, .ydk content/path or a text card list (used when the scenario omits deckB)"),
      board: z.string().optional().describe("Board notation instead of a JSON scenario, e.g. 'A hand: Card A' + 'A: activate \"Card A\"' + 'expect: summoned \"Card A\"'"),
      maxSteps: z.number().optional().default(200).describe("Maximum engine steps")
    }),
    handler: async (args: any) => {
      let spec: ScenarioSpec;
      if (args.board) {
        const parsed = parseBoard(args.board);
        if (!parsed.available || !parsed.spec) {
          return { available: false, reason: "Board notation could not be parsed.", errors: parsed.errors, warnings: parsed.warnings };
        }
        spec = parsed.spec;
      } else if (args.preset) {
        spec = { ...SCENARIO_PRESETS[args.preset] };
      } else if (args.scenario) {
        try {
          spec = typeof args.scenario === "string" ? JSON.parse(args.scenario) : args.scenario;
        } catch (error) {
          return { available: false, reason: `Invalid scenario JSON: ${(error as Error).message}` };
        }
      } else {
        return {
          available: false,
          reason: "Pass 'preset' or 'scenario'.",
          presets: listScenarioPresets()
        };
      }

      // Resolve card names to passcodes and fill decks from deck text when needed.
      const resolveList = async (list: any) => (Array.isArray(list) ? await resolveCardRefs(list) : list);
      spec.handA = await resolveList(spec.handA) as number[];
      spec.handB = await resolveList(spec.handB) as number[];
      spec.deckA = await resolveList(spec.deckA) as number[];
      spec.deckB = await resolveList(spec.deckB) as number[];
      spec.extraA = await resolveList(spec.extraA) as number[];
      spec.extraB = await resolveList(spec.extraB) as number[];
      // Decisions can also reference cards by name.
      const decisions: any[] = [];
      for (const d of spec.decisions || []) {
        const card = d.card !== undefined ? (await resolveCardRefs([d.card as any]))[0] ?? d.card : undefined;
        const cards = Array.isArray(d.cards) ? await resolveCardRefs(d.cards as any[]) : d.cards;
        decisions.push({ ...d, card, cards });
      }
      spec.decisions = decisions;

      if ((!spec.deckA || spec.deckA.length === 0) && args.deck) {
        const parsed = await deckArraysFromInput(args.deck);
        spec.deckA = parsed.main;
        if (!spec.extraA || spec.extraA.length === 0) spec.extraA = parsed.extra;
      }
      if ((!spec.deckB || spec.deckB.length === 0) && args.opponentDeck) {
        const parsed = await deckArraysFromInput(args.opponentDeck);
        spec.deckB = parsed.main;
        if (!spec.extraB || spec.extraB.length === 0) spec.extraB = parsed.extra;
      }

      // Expectations can reference cards by name as well.
      for (const expectation of spec.expect || []) {
        if (typeof (expectation as any).card === "string") {
          const [resolved] = await resolveCardRefs([(expectation as any).card]);
          if (resolved) (expectation as any).card = resolved;
        }
      }

      const result = await runScenario({ ...spec, maxSteps: args.maxSteps ?? spec.maxSteps });

      let citations: any = undefined;
      if (args.citations !== false) {
        const queries: string[] = [];
        if (spec.expect.some((e) => e.kind === "negated" || e.kind === "activated" || e.kind === "size")) {
          queries.push("negate the effect once per turn");
        }
        if (spec.expect.some((e) => e.kind === "summoned" || e.kind === "notSummoned")) {
          queries.push("fusion summon materials");
        }

        const seen = new Set<string>();
        const rules: any[] = [];
        const push = (citation: string, snippet: string, source: string) => {
          if (seen.has(citation)) return;
          seen.add(citation);
          rules.push({ source, citation, snippet: snippet.slice(0, 240) });
        };

        for (const query of queries) {
          for (const hit of searchRulebook(query, 1).hits) {
            push(`Official Rulebook v10, p.${hit.page} — ${hit.section}`, hit.snippet, "official_rulebook");
          }
          // PSCT Part 3 is the article that actually defines activation vs effect.
          for (const hit of searchJudgeDocs(query, { limit: 1, document: "psct-3" }).hits) {
            const where = hit.page ? `p.${hit.page}` : hit.section;
            push(`${hit.document}${hit.version ? ` v${hit.version}` : ""}, ${where}`, hit.snippet, "official_konami_documents");
          }
        }
        citations = rules.slice(0, 3);
      }

      return {
        available: true,
        ...result,
        citations
      };
    }
  },

  {
    name: "ygo_ensure_script",
    description: "Manage Lua scripts for cards that have no official one. `from-news` reads a reveal article (e.g. YGOrganization), extracts the card name, artwork URLs, text and stats, assigns a temporary ID and generates the script; `resolve` generates from the cards.cdb text when the card is already in the database. Every generated script is verified by loading it into ocgcore and is automatically replaced by the official ProjectIgnis script as soon as one exists. Returns provenance (manual/custom/official/generated), confidence, recognised patterns, engine errors and the replacedGenerated flag.",
    parameters: z.object({
      topic: z.enum(["resolve", "from-news", "upgrade", "inventory", "list"])
        .describe("resolve = fetch/generate a script for one card; from-news = read a reveal article, extract the card and generate its script; upgrade = sweep every generated script and replace it if an official one exists; inventory = counts; list = generated scripts"),
      passcode: z.number().optional().describe("Card passcode (required for topic=resolve)"),
      url: z.string().optional().describe("Article URL for topic=from-news (e.g. a YGOrganization reveal post)"),
      cardName: z.string().optional().describe("Override the card name extracted from the article"),
      tempId: z.number().optional().describe("Temporary ID to assign (defaults to the next free 990000000+ value)"),
      allowGenerate: z.boolean().optional().default(true).describe("Allow generating a script when no official one exists"),
      refreshOfficial: z.boolean().optional().default(false).describe("Bypass the cache and check ProjectIgnis now"),
      skipVerify: z.boolean().optional().default(false).describe("Skip engine verification (faster, but not guaranteed to run)")
    }),
    handler: async (args: any) => {
      if (args.topic === "inventory") {
        return { source: "card-script-resolver", ...scriptInventory() };
      }

      if (args.topic === "list") {
        return { source: "card-script-resolver", generated: listGeneratedScripts() };
      }

      if (args.topic === "upgrade") {
        return { source: "card-script-resolver", ...(await upgradeGeneratedScripts()) };
      }

      if (args.topic === "from-news") {
        if (!args.url) {
          return { available: false, reason: "Pass 'url' (the reveal article) for topic=\"from-news\"." };
        }
        const created = await createScriptFromNews(args.url, {
          cardName: args.cardName,
          tempId: args.tempId,
          skipVerify: Boolean(args.skipVerify)
        });
        return {
          source: "card-script-resolver",
          ...created,
          warning: created.available
            ? "Generated from the news article, NOT an official script. Do not use it for tournament rulings; it is replaced automatically once the official script exists."
            : undefined
        };
      }

      if (typeof args.passcode !== "number") {
        return { available: false, reason: "Pass 'passcode' for topic=\"resolve\"." };
      }

      const resolved = await resolveCardScript(args.passcode, {
        allowGenerate: args.allowGenerate !== false,
        refreshOfficial: Boolean(args.refreshOfficial),
        skipVerify: Boolean(args.skipVerify)
      });

      return {
        source: "card-script-resolver",
        ...resolved,
        warning:
          resolved.provenance === "generated"
            ? "This script was generated by the MCP from card text and is NOT official. Do not use it for tournament rulings. It will be replaced automatically when the official script appears."
            : undefined
      };
    }
  },

  {
    name: "ygo_verify_ruling",
    description: `USE THIS before asserting any ruling you cannot point at engine evidence for. Verify a ruling CLAIM against the engine. Give a sentence ('Card A negates Card B') and the tool picks a matching scenario (or runs the one you pass), executes it on ocgcore and returns SUPPORTED / CONTRADICTED / INCONCLUSIVE with the observation that decided it. This is how a judge conclusion becomes checkable. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      claim: z.string().describe("The ruling claim to verify, e.g. 'Card A negates Card B'"),
      scenario: z.string().optional().describe("Optional ScenarioSpec JSON to run instead of an auto-selected preset"),
      scenarioId: z.string().optional().describe("Optional preset id (see ygo_judge_scenario)")
    }),
    handler: async (args: any) => {
      if (!args.claim) return { outcome: "INCONCLUSIVE", reason: "Pass a 'claim' to verify." };
      let spec: ScenarioSpec | undefined;
      if (args.scenario) {
        try {
          spec = typeof args.scenario === "string" ? JSON.parse(args.scenario) : args.scenario;
        } catch (error) {
          return { outcome: "INCONCLUSIVE", reason: `Invalid scenario JSON: ${(error as Error).message}` };
        }
      } else if (args.scenarioId) {
        spec = SCENARIO_PRESETS[args.scenarioId];
        if (!spec) return { outcome: "INCONCLUSIVE", reason: `Unknown scenario id '${args.scenarioId}'.`, presets: listScenarioPresets() };
      }
      return verifyRulingClaim({ claim: args.claim, scenario: spec, scenarioId: args.scenarioId });
    }
  },

  {
    name: "ygo_check_locks",
    description: "Detect summon/activation/material locks in the cards of a deck and flag contradictions. Reads the Lua scripts and reports which card locks you into (or out of) which Summon type, plus conflicts such as a Special Summon lock next to an Extra Deck lock.",
    parameters: z.object({
      input: z.string().optional().describe("Deck as ydke:// link, .ydk content/path or a text card list"),
      passcodes: z.array(z.union([z.number(), z.string()])).optional().describe("Card list instead of a deck"),
      maxCards: z.number().optional().default(20).describe("Maximum cards to inspect")
    }),
    handler: async (args: any) => {
      let codes: number[] = [];
      if (args.input) {
        const parsed = await deckArraysFromInput(args.input);
        codes = [...parsed.main, ...parsed.extra, ...parsed.side];
      } else if (Array.isArray(args.passcodes)) {
        codes = await resolveCardRefs(args.passcodes);
      }
      if (codes.length === 0) return { available: false, reason: "Provide 'input' (deck) or 'passcodes'." };

      const unique = [...new Set(codes)].slice(0, Math.max(1, Math.min(args.maxCards ?? 20, 60)));
      const report = await auditDeckLocks(unique, async (passcode) => {
        const script = await resolveCardScript(passcode, { allowGenerate: false });
        const card = await readCardData(passcode);
        return {
          available: script.available,
          text: script.text,
          cardName: script.cardName ?? card?.name,
          cardText: card?.desc
        };
      });
      return { source: "lock-detector", ...report };
    }
  },

  {
    name: "ygo_consistency_lab",
    description: "Measure what a deck's opening hands actually do. Deals seeded hands through the real ocgcore engine with a goldfish responder and reports two distinct numbers: anyActionRate (at least one legal action — a very low bar) and engineBoardRate (reached the Extra Deck or kept a monster on the field). Also returns summon/Extra Deck rates, average board size and the most common openers. A measurement, not a win-rate prediction.",
    parameters: z.object({
      input: z.string().optional().describe("Deck as ydke:// link, .ydk content/path or a text card list"),
      main: z.array(z.union([z.number(), z.string()])).optional().describe("Main Deck passcodes/names instead of a deck"),
      extra: z.array(z.union([z.number(), z.string()])).optional().describe("Extra Deck passcodes/names"),
      trials: z
        .number()
        .optional()
        .default(15)
        .describe("Opening hands to test (1-200). Above 200 the tool refuses rather than silently clamping."),
      seed: z.number().optional().default(12345).describe("Deterministic seed"),
      maxSteps: z.number().optional().default(40).describe("Engine steps per trial (raise it to see longer combo lines)"),
      opponentMain: z
        .array(z.union([z.number(), z.string()]))
        .optional()
        .describe("Opponent Main Deck passcodes/names (defaults to a mirror of your deck; the goldfish opponent never draws)")
    }),
    handler: async (args: any) => {
      let main: number[] = [];
      let extra: number[] = [];
      if (args.input) {
        const parsed = await deckArraysFromInput(args.input);
        main = parsed.main;
        extra = parsed.extra;
      }
      if (Array.isArray(args.main)) main = await resolveCardRefs(args.main);
      if (Array.isArray(args.extra)) extra = await resolveCardRefs(args.extra);
      if (main.length === 0) return { available: false, reason: "Provide 'input' or a 'main' array." };

      return {
        source: "deck-consistency-lab",
        ...(await measureConsistency({
          main,
          extra,
          opponentMain: Array.isArray(args.opponentMain) ? await resolveCardRefs(args.opponentMain) : undefined,
          trials: args.trials,
          seed: args.seed,
          maxSteps: args.maxSteps
        }))
      };
    }
  },

  {
    name: "ygo_matchup_planner",
    description: "Turn the live tier list into a field plan: expected frequency by tops, the top decks to prepare for, and a role-based 15-card side skeleton from the format's staple pool. Counter choices are labelled as role heuristics, not proven counters.",
    parameters: z.object({
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).default("TCG").describe("Format"),
      deckName: z.string().optional().describe("Your deck, for context"),
      sideSize: z.number().optional().default(15).describe("Side Deck size (1-15)")
    }),
    handler: async (args: any) => {
      return { source: "matchup-planner", ...(await buildMatchupPlan({ format: args.format || "TCG", deckName: args.deckName, sideSize: args.sideSize })) };
    }
  },

  {
    name: "ygo_deck_cost",
    description: "Price a whole deck across TCGPlayer / Yuyu-tei / TCGCorner, show the cheapest market per card and the potential saving versus the most expensive market. Prices a bounded number of unique cards and marks the result partial rather than inventing numbers (no FX or shipping applied).",
    parameters: z.object({
      input: z.string().optional().describe("Deck as ydke:// link, .ydk content/path or a text card list"),
      cards: z.array(z.object({ name: z.string(), passcode: z.number().optional(), copies: z.number().optional() }))
        .optional().describe("Explicit card list with copy counts"),
      maxCards: z.number().optional().default(15).describe("Maximum unique cards to price (1-30)"),
      timeBudgetMs: z.number().optional().default(45000).describe("Stop early after this many milliseconds")
    }),
    handler: async (args: any) => {
      let cards: Array<{ name: string; passcode?: number; copies: number }> = [];
      if (args.input) cards = await deckCardsFromInput(args.input);
      else if (Array.isArray(args.cards)) cards = args.cards.map((c: any) => ({ name: c.name, passcode: c.passcode, copies: c.copies ?? 1 }));
      if (cards.length === 0) return { available: false, reason: "Provide 'input' (deck) or a 'cards' array." };

      return {
        source: "deck-cost",
        ...(await computeDeckCost({ cards, maxCards: args.maxCards, timeBudgetMs: args.timeBudgetMs }))
      };
    }
  },

  {
    name: "ygo_golden_suite",
    description: "Run the golden regression suite: every stored scenario is replayed on ocgcore and compared with its expected outcome. Use after a ProjectIgnis script update or an engine bump to see exactly which behaviour changed.",
    parameters: z.object({
      only: z.array(z.string()).optional().describe("Run only these case ids"),
      file: z.string().optional().describe("Alternative golden file path")
    }),
    handler: async (args: any) => {
      const cases = loadGoldenCases(args.file);
      if (cases.length === 0) {
        return { available: false, reason: "No golden cases found at data/golden/scenarios.json." };
      }
      return { source: "golden-regression", ...(await runGoldenSuite({ file: args.file, only: args.only })) };
    }
  },

  {
    name: "ygo_ai_benchmark",
    description: "Benchmark the heuristic duel AI against the engine's passive default responder over N seeded games, alternating the starting side. Returns win rates, average game length and LP remaining. The AI is a policy, not a trained model — treat the number as a sanity check.",
    parameters: z.object({
      deckA: z.array(z.union([z.number(), z.string()])).describe("Main Deck A (passcodes or names)"),
      deckB: z.array(z.union([z.number(), z.string()])).describe("Main Deck B (passcodes or names)"),
      extraA: z.array(z.union([z.number(), z.string()])).optional(),
      extraB: z.array(z.union([z.number(), z.string()])).optional(),
      games: z.number().optional().default(10).describe("Games to play (1-50)"),
      seed: z.number().optional().default(1).describe("Seed"),
      aiSide: z.enum(["A", "B", "alternate"]).optional().default("alternate").describe("Which side uses the AI"),
      maxSteps: z.number().optional().default(120).describe("Engine steps per game"),
      startingLP: z.number().optional().default(8000).describe("Starting LP (2000 finishes benchmarks faster)"),
      exploration: z.number().optional().default(0.1).describe("Policy randomness (0-1)")
    }),
    handler: async (args: any) => {
      const deckA = await resolveCardRefs(args.deckA);
      const deckB = await resolveCardRefs(args.deckB);
      if (deckA.length === 0 || deckB.length === 0) {
        return { available: false, reason: "Both decks are required (passcodes or resolvable names)." };
      }
      return {
        source: "ai-benchmark",
        ...(await runAiBenchmark({
          deckA,
          deckB,
          extraA: await resolveCardRefs(args.extraA),
          extraB: await resolveCardRefs(args.extraB),
          games: args.games,
          seed: args.seed,
          maxSteps: args.maxSteps,
          startingLP: args.startingLP,
          aiSide: args.aiSide,
          policy: { exploration: args.exploration }
        }))
      };
    }
  },

  {
    name: "ygo_export_selfplay",
    description: "Play policy-vs-policy games on the real engine and export every decision as JSONL (request type, legal option codes, chosen action, result). This is the training-data generator for behavioural cloning / reinforcement learning.",
    parameters: z.object({
      deckA: z.array(z.union([z.number(), z.string()])).describe("Main Deck A"),
      deckB: z.array(z.union([z.number(), z.string()])).describe("Main Deck B"),
      extraA: z.array(z.union([z.number(), z.string()])).optional(),
      extraB: z.array(z.union([z.number(), z.string()])).optional(),
      games: z.number().optional().default(5).describe("Games (1-50)"),
      seed: z.number().optional().default(1).describe("Seed"),
      maxSteps: z.number().optional().default(120).describe("Engine steps per game"),
      outPath: z.string().optional().describe("Output .jsonl path (defaults to data/ai/)")
    }),
    handler: async (args: any) => {
      const deckA = await resolveCardRefs(args.deckA);
      const deckB = await resolveCardRefs(args.deckB);
      if (deckA.length === 0 || deckB.length === 0) {
        return { available: false, reason: "Both decks are required." };
      }
      return {
        source: "selfplay-export",
        ...(await exportSelfPlay({
          deckA,
          deckB,
          extraA: await resolveCardRefs(args.extraA),
          extraB: await resolveCardRefs(args.extraB),
          games: args.games,
          seed: args.seed,
          maxSteps: args.maxSteps,
          outPath: args.outPath
        }))
      };
    }
  },

  {
    name: "ygo_sync_meta",
    description: "Sync live meta data (staples, TCG/OCG banlists, usage metrics) from the YGOPRODeck API.",
    parameters: z.object({
      forceRefresh: z.boolean().optional().describe("Force re-fetching from remote API even if local cache is fresh")
    }),
    handler: async (args: any) => {
      const syncResult = await DynamicMetaManager.getInstance().syncMeta(args.forceRefresh);
      const metaStatus = DynamicMetaManager.getInstance().getMetaStatus();
      return {
        ...syncResult,
        dataSource: syncResult.success ? "live" : "fallback",
        metaStatus
      };
    }
  },

  {
    name: "ygo_generate_batch_art_prompt",
    description: "Build one grid image prompt (2x2, 3x3) covering all custom cards, saving tokens and image-model calls.",
    parameters: z.object({
      cards: z.array(z.object({
        id: z.number().optional().describe("Passcode or temporary ID"),
        name: z.string().describe("Card name"),
        artDescription: z.string().optional().describe("Artwork description for the character/monster"),
        type: z.string().optional().describe("Card type"),
        attribute: z.string().optional().describe("Attribute")
      })).describe("Cards that need artwork"),
      style: z.string().optional().describe("Art style (default: anime Yu-Gi-Oh official card art)")
    }),
    handler: async (args: any) => {
      const result = generateBatchGridPrompt(args);
      return {
        prompt: result.prompt,
        negativePrompt: result.negativePrompt,
        dimensions: {
          rows: result.rows,
          cols: result.cols,
          grid: `${result.rows}x${result.cols}`
        },
        manifest: result.manifest
      };
    }
  },

  {
    name: "ygo_slice_batch_art",
    description: "Slice the grid image into individual square artworks and embed each one into its matching SVG card.",
    parameters: z.object({
      gridImagePath: z.string().describe("Path to the generated grid image"),
      manifest: z.any().describe("GridManifest data produced by ygo_generate_batch_art_prompt"),
      outputDir: z.string().optional().describe("Output directory for sliced art")
    }),
    handler: async (args: any) => {
      const result = await sliceAndAssignArtworks(args.gridImagePath, args.manifest, args.outputDir);
      return {
        success: result.success,
        slicedImages: result.slicedImages,
        slicedPngPaths: result.slicedImages.map(img => img.artPath),
        svgCards: result.svgCards
      };
    }
  },

  {
    name: "ygo_generate_tournament_decklist_pdf",
    description: "Turn a deck (YDK, YDKE, .ydk file or text list) into an official Konami KDE Deck Registration Sheet PDF with the full category tables. Handles Unicode names (Vietnamese, Japanese, etc.) correctly.",
    parameters: z.object({
      input: z.string().describe("Raw .ydk text, path to a .ydk file, a ydke:// link, or a line-by-line card list"),
      deckName: z.string().optional().describe("Deck name"),
      duelistName: z.string().optional().describe("Duelist full name (auto-split into first/middle and last)"),
      firstName: z.string().optional().describe("First and middle name(s) exactly as they should appear; overrides the auto-split of duelistName"),
      lastName: z.string().optional().describe("Family/last name exactly as it should appear; overrides the auto-split of duelistName"),
      country: z.string().optional().describe("Country of residency (default: Vietnam)"),
      cardGameId: z.string().optional().describe("Konami Card Game ID / COSSY ID (10 digits)"),
      eventName: z.string().optional().describe("Event name (e.g. YCS, National Championship, Regional)"),
      eventDate: z.string().optional().describe("Event date (YYYY-MM-DD)"),
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).optional().default("TCG").describe("Event format"),
      outputPath: z.string().optional().describe("Optional output path for the PDF")
    }),
    handler: async (args: any) => {
      return await exportTournamentDecklistPdf(args);
    }
  },

  {
    name: "ygo_render_deck_image",
    description: `USE THIS after building or editing a deck when the user wants to see it. Render the deck (Main, Extra, Side) as a PNG in Konami Neuron / tournament decklist layout: 10 cards per row, Monster -> Spell -> Trap, banned cards flagged. The picture is attached to this tool's result as an image block and the absolute outputPath is returned — present it to the user and, if the host has a file-preview or open-file capability, open that path in a tab. Do not describe the image from memory; the rendered file is the source.`,
    parameters: z.object({
      input: z.string().describe("Raw .ydk text, path to a .ydk file, a ydke:// link, or a line-by-line card list"),
      title: z.string().optional().describe("Deck title shown on the banner"),
      lang: z.enum(["jp", "en"]).optional().default("jp").describe("Heading language: 'jp' or 'en'"),
      outputPath: z.string().optional().describe("Optional output path for the PNG")
    }),
    handler: async (args: any) => {
      const result = await renderDeckGridPng(args);
      // The absolute path travels twice on purpose: in the JSON (for the model and the CLI)
      // and as an inline image block (for the user's eyes).
      return attachMedia(result, [{ type: "image", path: result.outputPath, mimeType: "image/png" }]);
    }
  },

  {
    name: "ygo_get_monthly_meta",
    description: `USE THIS for any "what is the meta / tier list / share %" question. Live tier list straight from the YugiohMeta API (/api/v1/deck-types/rankings) for TCG and OCG, with share %, total tops, player counts, live staples and freshness evidence. AE/Genesys/Master Duel have no live source. Do not quote a tier list from memory. ${TOOL_FIRST_MARK}`,
    parameters: z.object({
      month: z.number().min(1).max(12).optional().default(11).describe("Month to check (1-12; defaults to the current month)"),
      year: z.number().optional().default(2026).describe("Year to check (defaults to 2026)"),
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).optional().default("TCG").describe("Format"),
      forceRefresh: z.boolean().optional().default(false).describe("Force a refresh from the tournament source")
    }),
    handler: async (args: any) => {
      return await MonthlyMetaTracker.getInstance().getMonthlyMetaReport(args);
    }
  },

  {
    name: "ygo_compare_monthly_meta",
    description: "Compare meta movement between two months (e.g. 2026-10 vs 2026-11): rising stars, falling decks and banlist impact.",
    parameters: z.object({
      monthA: z.string().describe("First month (YYYY-MM, e.g. 2026-10)"),
      monthB: z.string().describe("Second month (YYYY-MM, e.g. 2026-11)"),
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).optional().default("TCG").describe("Format")
    }),
    handler: async (args: any) => {
      return await MonthlyMetaTracker.getInstance().compareMonthlyMeta(args);
    }
  },

  {
    name: "ygo_get_daily_meta",
    description: "Check the meta and banlist day by day (YYYY-MM-DD): emergency banlist notices, errata and tournament news from that day.",
    parameters: z.object({
      date: z.string().optional().describe("Date to check (YYYY-MM-DD, e.g. 2026-11-03; defaults to today)"),
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).optional().default("TCG").describe("Format"),
      forceRefresh: z.boolean().optional().default(false).describe("Force a refresh from the tournament source")
    }),
    handler: async (args: any) => {
      return await DailyMetaWatcher.getInstance().getDailyMetaReport(args);
    }
  },

  {
    name: "ygo_get_card_price_trends",
    description: "Full card detail: stats, text, printings, aggregated multi-market prices (TCGPlayer, Yuyu-tei OCG, Cardmarket AE) and Yugipedia links. Per-printing prices are only present when the source reports set_price; a 0 means 'no price for that printing', not 'free'. For any ranking or 'most expensive / rising' question use ygo_market_query instead.",
    parameters: z.object({
      cardNameOrId: z.string().describe("Card name (English) or 8-digit passcode")
    }),
    handler: async (args: any) => {
      const query = !isNaN(Number(args.cardNameOrId)) ? Number(args.cardNameOrId) : args.cardNameOrId;
      const report = await getCardPriceTrendsAndDetails(query);
      if (!report) {
        return { found: false, message: `No card information found for: ${args.cardNameOrId}` };
      }
      return { found: true, report };
    }
  },

  {
    name: "ygo_get_trending_cards",
    description: "High-demand meta staples with live prices (TCGPlayer/Yuyu-tei/TCGCorner) and live weekly views (YGOPRODeck). Trends derive from live weekly views; tournament share is an editorial estimate. No hardcoded data.",
    parameters: z.object({
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).optional().default("TCG").describe("Format"),
      limit: z.number().optional().default(8).describe("Number of hot cards to return")
    }),
    handler: async (args: any) => {
      return await getTrendingHotCards(args.format, args.limit);
    }
  },

  {
    name: "ygo_create_archetype_docx",
    description: "Create the Master Specification DOCX (Archetype Design Bible) as a Single Source of Truth, with the six-column spec table (ID, Name/Type, Stats, Text, ...).",
    parameters: z.object({
      archetypeName: z.string().describe("Archetype name (e.g. 'Chronofreeze', 'Phantasmagoria')"),
      setcode: z.string().describe("Identifying Setcode (e.g. '0x99f', '0x88e')"),
      lore: z.string().describe("Archetype lore and setting"),
      playstyle: z.string().describe("Strategy, gameplay mechanics and core combos"),
      targetSimulator: z.enum(["omega", "edopro", "generic"]).default("omega").describe("Target simulator (omega: 8-digit ID, max 134M int32; edopro: 8-9 digits)"),
      author: z.string().optional().describe("Designer name"),
      cards: z.array(z.object({
        id: z.number().describe("Card ID (Omega requires 8 digits, e.g. 77000101)"),
        name: z.string().describe("Card name"),
        type: z.string().describe("Type (Effect Monster, Quick-Play Spell Card, Continuous Trap Card, XYZ Monster, Link Monster, ...)"),
        attribute: z.string().optional().describe("Attribute: LIGHT, DARK, WATER, FIRE, EARTH, WIND, DIVINE"),
        race: z.string().optional().describe("Race: Warrior, Spellcaster, Dragon, Machine, Cyberse, ..."),
        level: z.number().optional().describe("Level / Rank / Link Rating"),
        atk: z.number().optional().describe("ATK"),
        def: z.number().optional().describe("DEF"),
        scale: z.number().optional().describe("Pendulum Scale, if any"),
        desc: z.string().describe("Official card effect text"),
        strings: z.array(z.string()).optional().describe("Array of str1..str16 choice strings for aux.Stringid"),
        visualPrompt: z.string().optional().describe("Artwork description for AI image generation (Canva Dream Lab, Midjourney)"),
        linkmarkers: z.number().optional().describe("Link marker bitmask for Link Monsters (Top=1, Bottom=2, Left=4, Right=8, TopLeft=16, TopRight=32, BottomLeft=64, BottomRight=128). E.g. Link-2 Bottom-Left+Bottom-Right = 192."),
        lua: z.string().optional().describe("Full ocgcore Lua script for this card. When provided it is used verbatim instead of generating a skeleton; use it when the effect must actually execute.")
      })).describe("Cards in the archetype"),
      outputPath: z.string().optional().describe("Optional output path for the .docx file")
    }),
    handler: async (args: any) => {
      return await createArchetypeDocx(args, args.outputPath);
    }
  },

  {
    name: "ygo_read_and_validate_docx",
    description: "Parse and validate the Master Specification DOCX: data integrity, duplicate IDs, Omega int32 ID range, Setcode and the str1..str16 choice strings.",
    parameters: z.object({
      docxPath: z.string().describe("Path to the .docx file to validate"),
      targetSimulator: z.enum(["omega", "edopro", "generic"]).optional().describe("Target simulator to validate against")
    }),
    handler: async (args: any) => {
      return await readAndValidateDocx(args.docxPath, args.targetSimulator);
    }
  },

  {
    name: "ygo_export_database_and_scripts",
    description: "Compile the Master DOCX into a SQLite database (.cdb for EDOPro or Databases/gm.db for YGO Omega) and generate every Lua script c<id>.lua for the chosen profile.",
    parameters: z.object({
      docxPath: z.string().describe("Path to the Master .docx file"),
      outputDbPath: z.string().optional().describe("Output database path (.cdb or gm.db)"),
      outputScriptsDir: z.string().optional().describe("Directory for the c<id>.lua script files"),
      simulatorProfile: z.enum(["omega", "edopro", "generic"]).optional().describe("Target simulator profile")
    }),
    handler: async (args: any) => {
      const guard = guardOutputPath(args.outputDbPath || args.outputScriptsDir || "data/archetype_studio", { allowGameRoots: true });
      if (!guard.ok) return { available: false, reason: guard.reason };
      return await exportDatabaseAndScripts(args.docxPath, args.outputDbPath, args.outputScriptsDir, args.simulatorProfile);
    }
  },

  {
    name: "ygo_generate_art_prompts",
    description: "Extract every artwork description from the Master DOCX into ART_PROMPTS.md, with per-card prompts and Master Grid prompts (2x2, 3x3, 4x4).",
    parameters: z.object({
      docxPath: z.string().describe("Path to the Master .docx file"),
      outputMdPath: z.string().optional().describe("Output path for the prompt markdown file"),
      gridLayout: z.enum(["2x2", "3x3", "4x4"]).optional().default("3x3").describe("Master Grid prompt matrix")
    }),
    handler: async (args: any) => {
      return await generateArtPrompts(args.docxPath, args.outputMdPath, args.gridLayout);
    }
  },

  {
    name: "ygo_slice_art_grid",
    description: "Detect the grid, remove gutters and slice an AI contact sheet into square <id>.jpg card arts (1024x1024, JPEG quality 95) directly into the game's Arts/ folder.",
    parameters: z.object({
      imagePath: z.string().describe("Path to the grid image"),
      docxPath: z.string().optional().describe("Master DOCX path to derive the card ID list automatically"),
      cardIds: z.array(z.number()).optional().describe("Manual card ID array when no docx is supplied"),
      outputArtsDir: z.string().optional().describe("Output directory for sliced art (e.g. YGO Omega 'Arts/' or EDOPro 'pics/')"),
      rows: z.number().optional().default(3).describe("Grid rows (default 3)"),
      cols: z.number().optional().default(3).describe("Grid columns (default 3)")
    }),
    handler: async (args: any) => {
      const idSource = args.docxPath || args.cardIds || [];
      const guard = guardOutputPath(args.outputArtsDir || "data/sliced_artworks", { allowGameRoots: true });
      if (!guard.ok) return { available: false, reason: guard.reason };
      return await sliceArtGrid(args.imagePath, idSource, args.outputArtsDir, args.rows, args.cols);
    }
  },

  {
    name: "ygo_build_full_pipeline",
    description: "Run the whole archetype pipeline in one call: read DOCX -> validate -> compile SQLite DB -> generate Lua scripts -> export ART_PROMPTS.md -> (optional) slice the grid straight into the game folder.",
    parameters: z.object({
      docxPath: z.string().describe("Master DOCX path"),
      gameRootDir: z.string().describe("Simulator root folder (containing Omega's Databases/, Scripts/, Arts/ or EDOPro's expansions/)"),
      simulatorProfile: z.enum(["omega", "edopro", "generic"]).default("omega").describe("Target simulator profile"),
      gridImagePath: z.string().optional().describe("Grid image path, if already generated, to slice art into the game folder")
    }),
    handler: async (args: any) => {
      const guard = guardOutputPath(args.gameRootDir, { allowGameRoots: true });
      if (!guard.ok) return { available: false, reason: guard.reason };
      return await buildFullPipeline(args.docxPath, args.gameRootDir, args.simulatorProfile, args.gridImagePath);
    }
  },

  {
    name: "ygo_simulate_duel_scenario",
    description: "Analyse a duel scenario in text form: chain order, legality of each activation, cost/target/timing checks, Lua script cross-reference and a judge-style verdict. Heuristic only — use ygo_judge_scenario or ygo_run_duel for real engine execution.",
    parameters: z.object({
      scenario: z.string().describe("Duel scenario description (e.g. 'Player A activates Card A, Player B chains Card B discarding it, Player A chains Card C targeting Card B in the GY...')"),
      format: z.enum(["TCG", "OCG", "AE", "Genesys", "Master Duel"]).optional().default("TCG").describe("Format"),
      initialState: z.string().optional().describe("Initial board state or hand/Graveyard, if any"),
      deckA: z.array(z.number()).optional().describe("Player A Main Deck (passcodes). With deckA+deckB the real ocgcore-wasm engine runs."),
      deckB: z.array(z.number()).optional().describe("Main Deck Player B (passcodes)"),
      handA: z.array(z.number()).optional().describe("Hand Player A (passcodes)"),
      handB: z.array(z.number()).optional().describe("Hand Player B (passcodes)"),
      extraA: z.array(z.number()).optional().describe("Extra Deck Player A (passcodes)"),
      extraB: z.array(z.number()).optional().describe("Extra Deck Player B (passcodes)"),
      maxSteps: z.number().optional().default(120).describe("Maximum engine steps"),
      startingLP: z.number().optional().default(8000).describe("Starting LP")
    }),
    handler: async (args: any) => {
      return await simulateDuelScenario({
        scenario: args.scenario,
        format: args.format,
        initialState: args.initialState,
        deckA: args.deckA,
        deckB: args.deckB,
        handA: args.handA,
        handB: args.handB,
        extraA: args.extraA,
        extraB: args.extraB,
        maxSteps: args.maxSteps,
        startingLP: args.startingLP
      });
    }
  },

  {
    name: "ygo_run_duel",
    description: "Run a REAL duel with ocgcore-wasm (ProjectIgnis EDOPro core compiled to WebAssembly): the engine executes the Lua card scripts, handles chain/cost/target/timing and returns the message timeline (draw, summon, chain, LP update, win).",
    parameters: z.object({
      deckA: z.array(z.union([z.number(), z.string()])).optional().describe("Main Deck Player A (passcodes or card names)"),
      deckB: z.array(z.union([z.number(), z.string()])).optional().describe("Main Deck Player B (passcodes or card names)"),
      deck: z.string().optional().describe("Player A deck as ydke:// link, .ydk content/path or a text card list"),
      opponentDeck: z.string().optional().describe("Player B deck as ydke:// link, .ydk content/path or a text card list"),
      handA: z.array(z.union([z.number(), z.string()])).optional().describe("Hand Player A"),
      handB: z.array(z.union([z.number(), z.string()])).optional().describe("Hand Player B"),
      extraA: z.array(z.union([z.number(), z.string()])).optional().describe("Extra Deck Player A"),
      extraB: z.array(z.union([z.number(), z.string()])).optional().describe("Extra Deck Player B"),
      startingLP: z.number().optional().default(8000).describe("Starting LP"),
      maxSteps: z.number().optional().default(120).describe("Maximum engine steps"),
      ai: z.enum(["none", "greedy"]).optional().default("none").describe("Use the heuristic AI for both sides instead of the passive default responder"),
      exploration: z.number().optional().default(0.1).describe("AI randomness (0-1)"),
      seed: z.array(z.number()).length(4).optional().describe("4-number seed (default 1,2,3,4)")
    }),
    handler: async (args: any) => {
      const seed = Array.isArray(args.seed) && args.seed.length === 4
        ? args.seed.map((n: number) => BigInt(n)) as [bigint, bigint, bigint, bigint]
        : [1n, 2n, 3n, 4n] as [bigint, bigint, bigint, bigint];
      const policy = args.ai === "greedy"
        ? createPolicy({ seed: Number(seed[0]), exploration: args.exploration })
        : null;

      let deckA = await resolveCardRefs(args.deckA);
      let deckB = await resolveCardRefs(args.deckB);
      let extraA = await resolveCardRefs(args.extraA);
      let extraB = await resolveCardRefs(args.extraB);

      // Accept arrays in `deck` / `opponentDeck` too, so callers cannot silently
      // pass a list where a string was documented.
      if (deckA.length === 0 && Array.isArray(args.deck)) deckA = await resolveCardRefs(args.deck);
      if (deckB.length === 0 && Array.isArray(args.opponentDeck)) deckB = await resolveCardRefs(args.opponentDeck);

      if (deckA.length === 0 && typeof args.deck === "string") {
        const parsed = await deckArraysFromInput(args.deck);
        deckA = parsed.main;
        if (extraA.length === 0) extraA = parsed.extra;
      }
      if (deckB.length === 0 && typeof args.opponentDeck === "string") {
        const parsed = await deckArraysFromInput(args.opponentDeck);
        deckB = parsed.main;
        if (extraB.length === 0) extraB = parsed.extra;
      }

      if (deckA.length === 0 || deckB.length === 0) {
        return {
          available: false,
          reason: "Provide both decks, either as passcode/name arrays (deckA, deckB) or as deck text (deck, opponentDeck)."
        };
      }

      const result = await runOcgCoreDuel({
        deckA,
        deckB,
        handA: await resolveCardRefs(args.handA),
        handB: await resolveCardRefs(args.handB),
        extraA,
        extraB,
        startingLP: args.startingLP,
        maxSteps: args.maxSteps,
        seed,
        responder: policy ? (message) => policy.respond(message) : undefined
      });
      if (!policy) return result;
      return { ...result, ai: { mode: "greedy", stats: policy.stats } };
    }
  }
];
