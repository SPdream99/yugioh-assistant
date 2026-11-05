import { TOOLS } from "../tools/index.js";

export interface ParamDoc {
  path: string;
  type: string;
  required: boolean;
  description: string;
  fallback?: string;
}

export interface ToolDoc {
  name: string;
  description: string;
  summaryEn: string;
  category: string;
  parameters: ParamDoc[];
}

interface Category {
  id: string;
  title: string;
  titleVi: string;
  blurb: string;
  tools: string[];
}

/**
 * Groupings are editorial, not inferred: they decide the order a human reads the
 * tool list in. `validateCatalog()` fails loudly when a tool is added without a
 * home, which keeps the documentation honest.
 */
export const CATEGORIES: Category[] = [
  {
    id: "deck",
    title: "Deck intelligence",
    titleVi: "Deck analysis",
    blurb: "Parse, validate, build and tune 40–60 card lists against a live banlist.",
    tools: [
      "ygo_parse_deck",
      "ygo_check_legality",
      "ygo_export_deck",
      "ygo_build_meta_deck",
      "ygo_optimize_deck",
      "ygo_find_synergy_and_combos",
      "ygo_find_community_decks",
      "ygo_find_combos",
      "ygo_find_counters",
      "ygo_compare_decks",
      "ygo_consistency_lab",
      "ygo_matchup_planner",
      "ygo_deck_cost"
    ]
  },
  {
    id: "cards",
    title: "Card database",
    titleVi: "Card database",
    blurb: "Search the live card pool by stats, type, race, attribute or archetype.",
    tools: ["ygo_get_card", "ygo_card_dossier", "ygo_search_cards"]
  },
  {
    id: "rulings",
    title: "Rulings and simulation",
    titleVi: "Rulings and simulation",
    blurb: "Read the actual ocgcore Lua script instead of guessing from card text.",
    tools: [
      "ygo_judge_card",
      "ygo_analyze_lua",
      "ygo_script_insights",
      "ygo_judge_interaction",
      "ygo_get_rulebook",
      "ygo_get_policy",
      "ygo_wiki",
      "ygo_judge_scenario",
      "ygo_ensure_script",
      "ygo_verify_ruling",
      "ygo_check_locks",
      "ygo_golden_suite",
      "ygo_simulate_duel_scenario",
      "ygo_run_duel",
      "ygo_ai_benchmark",
      "ygo_export_selfplay"
    ]
  },
  {
    id: "meta",
    title: "Meta and banlists",
    titleVi: "Meta and banlists",
    blurb: "Monthly tier data, month-over-month deltas and daily tournament shifts.",
    tools: [
      "ygo_get_monthly_meta",
      "ygo_compare_monthly_meta",
      "ygo_get_daily_meta",
      "ygo_sync_meta"
    ]
  },
  {
    id: "market",
    title: "Market and news",
    titleVi: "Prices and news",
    blurb: "Three markets, one query — rank the whole pool, measure movement, and explain it with news.",
    tools: [
      "ygo_market_query",
      "ygo_check_prices",
      "ygo_card_printing_prices",
      "ygo_get_card_price_trends",
      "ygo_get_trending_cards",
      "ygo_get_news"
    ]
  },
  {
    id: "export",
    title: "Tournament paperwork",
    titleVi: "Tournament paperwork",
    blurb: "Konami-legal decklists and Neuron-style deck images.",
    tools: ["ygo_generate_tournament_decklist_pdf", "ygo_render_deck_image"]
  },
  {
    id: "studio",
    title: "Custom cards and archetype studio",
    titleVi: "Custom cards and archetype studio",
    blurb: "Temp IDs, generated Lua, grid artwork, spec documents and database exports.",
    tools: [
      "ygo_create_custom_card",
      "ygo_migrate_temp_card",
      "ygo_generate_batch_art_prompt",
      "ygo_slice_batch_art",
      "ygo_create_archetype_docx",
      "ygo_read_and_validate_docx",
      "ygo_export_database_and_scripts",
      "ygo_generate_art_prompts",
      "ygo_slice_art_grid",
      "ygo_build_full_pipeline"
    ]
  }
];

const SUMMARY_EN: Record<string, string> = {
  ygo_parse_deck: "Parse a `.ydk` file, a `ydke://` link or raw YDK text into a validated deck.",
  ygo_export_deck: "Convert a deck to YDK text, a `ydke://` link, or both.",
  ygo_get_card: "Look a card up by name or passcode, with Yugipedia cross-references.",
  ygo_card_dossier: "One call for everything about a card: database, wiki, script provenance, rulings.",
  ygo_search_cards: "Filter the card pool by ATK, DEF, type, race, attribute, level or archetype.",
  ygo_find_synergy_and_combos: "Match cards to a stat filter and trace searchers already in your deck.",
  ygo_find_community_decks: "Live community, tournament and Konami recipe decks with page links and ydke.",
  ygo_find_combos: "Structured published combos (starting cards + steps) by archetype or card.",
  ygo_find_counters: "Published counter cards, chokepoints and explanations for a deck type.",
  ygo_compare_decks: "Compare two lists section by section: shared core, only-A, only-B, copy differences.",
  ygo_judge_card: "Read the ocgcore Lua script and report HOPT, costs, targeting and timing.",
  ygo_script_insights: "Deep script analysis: effect kinds, cost/target/operation pipeline, risks and corpus-wide patterns.",
  ygo_judge_interaction: "Adjudicate how two named cards interact, citing the rulebook.",
  ygo_build_meta_deck: "Build a legal 40–60 card list for TCG, OCG, AE, Genesys or Master Duel.",
  ygo_optimize_deck: "Grade staple and hand-trap ratios, then suggest swaps for the format.",
  ygo_create_custom_card: "Register an unreleased or fan-made card: temp ID, Lua script and SVG mockup.",
  ygo_migrate_temp_card: "Move a temp ID to its official passcode across registry, Lua and saved YDK files.",
  ygo_check_prices: "TCGPlayer, Yuyu-tei and TCGCorner prices side by side.",
  ygo_card_printing_prices: "Per-printing prices by set code, rarity and language — null when no source lists that printing.",
  ygo_market_query: "Rank the whole pool by price, demand or measured movement, then explain why with news and banlist evidence.",
  ygo_get_news: "Latest reveals and banlist news from the YGOrganization feed.",
  ygo_get_rulebook: "Official Konami rulebook: verbatim text with real page citations, plus curated timing guides.",
  ygo_get_policy: "Official judge corpus: Tournament Policy, Penalties, Fast Effect Timing, Judge FAQ, with page citations.",
  ygo_wiki: "Yugipedia: cards, sets, products, archetypes, plus Gallery/Rulings/Errata/Tips/Trivia/Appearances tabs.",
  ygo_judge_scenario: "Run a real duel scenario on ocgcore-wasm and check the judge's expectation against engine evidence.",
  ygo_ensure_script: "Generate a temporary Lua script for cards without one, verify it in the engine, and auto-replace it when the official script appears.",
  ygo_verify_ruling: "Check a ruling claim against the engine and return SUPPORTED / CONTRADICTED.",
  ygo_check_locks: "Detect summon, activation and material locks across a deck and flag conflicts.",
  ygo_golden_suite: "Replay the golden scenario suite and report which behaviour changed.",
  ygo_consistency_lab: "Measure playable hands, brick rate and average actions on the real engine.",
  ygo_matchup_planner: "Turn the live tier list into a field plan and a role-based side deck.",
  ygo_deck_cost: "Price a deck across markets and show the cheapest combination.",
  ygo_ai_benchmark: "Pit the heuristic duel AI against the passive baseline over seeded games.",
  ygo_export_selfplay: "Export policy-vs-policy decisions as JSONL training data.",
  ygo_check_legality: "Check size, banlist and zone legality for a deck in one format.",
  ygo_sync_meta: "Refresh staples and banlists from live APIs for every supported format.",
  ygo_generate_batch_art_prompt: "Compose a single grid prompt that covers many card artworks.",
  ygo_slice_batch_art: "Slice a grid image into square artworks and embed them into the card SVGs.",
  ygo_generate_tournament_decklist_pdf: "Fill Konami's official KDE decklist form directly.",
  ygo_render_deck_image: "Render the deck as a 10-per-row Konami Neuron PNG.",
  ygo_get_monthly_meta: "Monthly tier list, play rates and staple trends per format.",
  ygo_compare_monthly_meta: "Diff two months of meta data: rising decks, falling decks, banlist impact.",
  ygo_get_daily_meta: "Daily results, emergency banlist flags and micro-meta shifts.",
  ygo_get_card_price_trends: "Price history and spread for a single card.",
  ygo_get_trending_cards: "What the market is buying right now.",
  ygo_create_archetype_docx: "Produce a structured archetype specification document.",
  ygo_read_and_validate_docx: "Read an archetype spec back and validate its structure.",
  ygo_export_database_and_scripts: "Export the archetype to SQLite plus ocgcore Lua scripts.",
  ygo_generate_art_prompts: "Generate per-card art prompts from a spec.",
  ygo_slice_art_grid: "Slice an art grid into card-ready image files.",
  ygo_build_full_pipeline: "Run spec, scripts, art and export end to end.",
  ygo_simulate_duel_scenario: "Walk a board state through a chain and report every legal window."
};

function unwrap(schema: any): any {
  let current = schema;
  while (current && current._def) {
    const type = current._def.type ?? current._def.typeName;
    if (type === "optional" || type === "ZodOptional" || type === "nullable" || type === "ZodNullable") {
      current = current._def.innerType;
      continue;
    }
    if (type === "default" || type === "ZodDefault") {
      current = current._def.innerType;
      continue;
    }
    if (type === "effects" || type === "ZodEffects") {
      current = current._def.schema;
      continue;
    }
    break;
  }
  return current;
}

function enumValues(def: any): string[] {
  const source = def.entries ?? def.values ?? def.options;
  if (Array.isArray(source)) return source;
  if (source && typeof source === "object") return Object.values(source) as string[];
  return [];
}

function typeName(schema: any): string {
  const def = schema?._def;
  if (!def) return "any";
  const type = def.type ?? def.typeName;
  switch (type) {
    case "string":
    case "ZodString":
      return "string";
    case "number":
    case "ZodNumber":
      return "number";
    case "boolean":
    case "ZodBoolean":
      return "boolean";
    case "enum":
    case "ZodEnum":
      return enumValues(def).map((value) => `"${value}"`).join(" | ");
    case "array":
    case "ZodArray":
      return `${typeName(def.element ?? def.type)}[]`;
    case "object":
    case "ZodObject":
      return "object";
    case "record":
    case "ZodRecord":
      return "object";
    case "union":
    case "ZodUnion":
      return (def.options as any[]).map(typeName).join(" | ");
    case "literal":
    case "ZodLiteral":
      return JSON.stringify(def.value ?? def.values?.[0] ?? "");
    default:
      return "any";
  }
}

function isRequired(schema: any): boolean {
  const type = schema?._def?.type ?? schema?._def?.typeName;
  if (type === "optional" || type === "ZodOptional" || type === "default" || type === "ZodDefault") return false;
  return true;
}

function fallbackOf(schema: any): string | undefined {
  const type = schema?._def?.type ?? schema?._def?.typeName;
  if (type !== "default" && type !== "ZodDefault") return undefined;
  try {
    const defaultValue = typeof schema._def.defaultValue === "function"
      ? schema._def.defaultValue()
      : schema._def.defaultValue;
    return JSON.stringify(defaultValue);
  } catch {
    return undefined;
  }
}

function describe(schema: any): string {
  const inner = unwrap(schema);
  return schema?.description ?? inner?.description ?? "";
}

function collectParams(schema: any, prefix = ""): ParamDoc[] {
  const shape = unwrap(schema)?.shape;
  if (!shape) return [];
  const params: ParamDoc[] = [];
  for (const [key, value] of Object.entries<any>(shape)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const documentation: ParamDoc = {
      path,
      type: typeName(unwrap(value)),
      required: isRequired(value),
      description: describe(value),
      fallback: fallbackOf(value)
    };
    params.push(documentation);
    if (unwrap(value)?._def?.typeName === "ZodObject") {
      params.push(...collectParams(value, path));
    }
  }
  return params;
}

export function buildCatalog(): ToolDoc[] {
  const categoryOf = new Map<string, string>();
  for (const category of CATEGORIES) {
    for (const tool of category.tools) categoryOf.set(tool, category.id);
  }

  return TOOLS.map((tool) => {
    const name = tool.name;
    return {
      name,
      description: tool.description,
      summaryEn: SUMMARY_EN[name] ?? tool.description,
      category: categoryOf.get(name) ?? "other",
      parameters: collectParams(tool.parameters)
    };
  });
}

export function uncategorizedTools(): string[] {
  return buildCatalog()
    .filter((tool) => tool.category === "other")
    .map((tool) => tool.name);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Compact, README-ready tool table. */
export function renderToolsMarkdown(language: "en" | "vi" = "en"): string {
  const catalog = buildCatalog();
  const byCategory = new Map<string, ToolDoc[]>();
  for (const tool of catalog) {
    const list = byCategory.get(tool.category) ?? [];
    list.push(tool);
    byCategory.set(tool.category, list);
  }

  const blocks: string[] = [];
  for (const category of CATEGORIES) {
    const tools = byCategory.get(category.id);
    if (!tools || tools.length === 0) continue;
    const title = language === "vi" ? category.titleVi : category.title;
    const blurb = language === "vi" ? "" : category.blurb;
    const rows = tools
      .map((tool) => {
        // Tool names and summaries stay in English in both languages: they are
        // copied verbatim from the MCP schema, and a translated summary would
        // drift from what the model actually sees.
        const summary = tool.summaryEn;
        return `| \`${tool.name}\` | ${escapeCell(summary)} |`;
      })
      .join("\n");
    blocks.push(
      `**${title}**${blurb ? ` — ${blurb}` : ""}\n\n` +
        `${language === "vi" ? "| Tool | Chức năng |" : "| Tool | What it does |"}\n| --- | --- |\n${rows}`
    );
  }
  return blocks.join("\n\n");
}

/** Full reference with every parameter, for docs/TOOLS.md. */
export function renderToolsReference(language: "en" | "vi" = "en"): string {
  const catalog = buildCatalog();
  const lines: string[] = [];

  for (const category of CATEGORIES) {
    const tools = catalog.filter((tool) => tool.category === category.id);
    if (tools.length === 0) continue;
    lines.push(`## ${language === "vi" ? category.titleVi : category.title}`, "");
    if (language === "en") lines.push(category.blurb, "");

    for (const tool of tools) {
      lines.push(`### \`${tool.name}\``, "");
      lines.push(tool.summaryEn, "");
      if (tool.description && tool.description !== tool.summaryEn) {
        lines.push(`<sub>${escapeCell(tool.description)}</sub>`, "");
      }
      if (tool.parameters.length > 0) {
        lines.push("| Parameter | Type | Required | Description |", "| --- | --- | --- | --- |");
        for (const param of tool.parameters) {
          const fallback = param.fallback ? ` (default \`${param.fallback}\`)` : "";
          const description = escapeCell(`${param.description}${fallback}`.trim());
          lines.push(
            `| \`${param.path}\` | \`${param.type}\` | ${param.required ? "yes" : "no"} | ${description} |`
          );
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

export function renderToolsJson(): string {
  return JSON.stringify(
    buildCatalog().map((tool) => ({
      name: tool.name,
      description: tool.description,
      summary: tool.summaryEn,
      category: tool.category,
      parameters: tool.parameters
    })),
    null,
    2
  );
}

export function toolCount(): number {
  return TOOLS.length;
}
