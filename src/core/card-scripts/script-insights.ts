/**
 * Deeper analysis layer on top of the Lua AST parser.
 *
 * `analyzeLuaCard` answers "what is in this script". This module answers the
 * questions a judge or a script author actually asks:
 *   - What kind of effect is each one, and does it have a complete
 *     condition / cost / target / operation pipeline?
 *   - What does it cost, does it target, how long does it last?
 *   - Which libraries must be loaded for it to run?
 *   - What is suspicious in it (risks with severity)?
 *   - Across a whole corpus, which idioms and which mistakes keep recurring?
 *
 * Everything here is derived from the AST and the source text; nothing is
 * guessed from the card name.
 */

import { analyzeLuaCard } from "./lua-ast.js";
import type { LuaCardAnalysis, ParsedEffect } from "../../types/lua.js";

export type EffectKind = "ignition" | "trigger" | "quick" | "continuous" | "flip" | "summon" | "static" | "activate" | "unknown";

export interface EffectInsight {
  index: number;
  kind: EffectKind;
  triggerEvent?: string;
  quartet: { condition: boolean; cost: boolean; target: boolean; operation: boolean };
  costKinds: string[];
  targets: boolean;
  reset?: string;
  countLimit: "hard" | "soft" | "duel" | "none";
  spellSpeed?: number;
  categories: string[];
  notes: string[];
}

export interface ScriptRisk {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  line?: number;
}

export interface ScriptInsight {
  passcode: number;
  parsed: boolean;
  parseError?: string;
  effects: EffectInsight[];
  dependencies: {
    libraries: string[];
    globals: string[];
    missingLoadScript: string[];
  };
  risks: ScriptRisk[];
  complexity: {
    lines: number;
    functions: number;
    effects: number;
    branches: number;
    apiCalls: number;
  };
  summary: string;
}

const COST_PATTERNS: Array<[RegExp, string]> = [
  [/discard/i, "discard"],
  [/tribute|release/i, "tribute"],
  [/pay\s*lp|paylpcost/i, "pay LP"],
  [/banish|remove/i, "banish"],
  [/sendto(grave|gy)/i, "send to GY"],
  [/detach/i, "detach material"],
  [/reveal/i, "reveal"],
  [/destroy/i, "destroy own card"],
  [/equip/i, "equip"],
  [/return/i, "return to hand/deck"]
];

const GLOBAL_LIBRARIES: Record<string, string> = {
  Fusion: "proc_fusion.lua",
  Synchro: "proc_synchro.lua",
  Xyz: "proc_xyz.lua",
  Link: "proc_link.lua",
  Pendulum: "proc_pendulum.lua",
  Ritual: "proc_ritual.lua"
};

function classifyKind(effect: ParsedEffect): EffectKind {
  const types = effect.effectType || [];
  const factory = effect.factory || "";
  const code = effect.code || "";

  if (/SummonEff|AddProcedure/i.test(factory)) return "summon";
  if (types.some((t) => t.includes("EFFECT_TYPE_QUICK")) || types.some((t) => t.includes("QUICK_O"))) return "quick";
  if (types.some((t) => t.includes("EFFECT_TYPE_TRIGGER_F")) || types.some((t) => t.includes("EFFECT_TYPE_FLIP"))) return "flip";
  if (types.some((t) => t.includes("EFFECT_TYPE_TRIGGER"))) return "trigger";
  if (types.some((t) => t.includes("EFFECT_TYPE_IGNITION"))) return "ignition";
  if (types.some((t) => t.includes("EFFECT_TYPE_ACTIVATE"))) return "activate";
  if (types.some((t) => t.includes("EFFECT_TYPE_CONTINUOUS"))) return "continuous";
  // Static abilities (summon conditions, immunity, material checks) are field/single
  // effects keyed by an EFFECT_* code rather than an EVENT_*.
  if (code.startsWith("EFFECT_") && types.some((t) => t.includes("EFFECT_TYPE_SINGLE") || t.includes("EFFECT_TYPE_FIELD"))) {
    return "static";
  }
  return "unknown";
}

function countLimitKind(effect: ParsedEffect): EffectInsight["countLimit"] {
  if (effect.isOncePerDuel) return "duel";
  if (effect.isHOPT) return "hard";
  if (effect.isSOPT) return "soft";
  return "none";
}

function detectCostKinds(effect: ParsedEffect): string[] {
  const text = `${effect.costDescription || ""} ${effect.rawSnippet || ""}`;
  const kinds = new Set<string>();
  for (const [pattern, label] of COST_PATTERNS) {
    if (pattern.test(text)) kinds.add(label);
  }
  return [...kinds];
}

function analyzeEffect(effect: ParsedEffect): EffectInsight {
  const notes: string[] = [];
  const costKinds = detectCostKinds(effect);
  const kind = classifyKind(effect);

  if (effect.isTargeting && !(effect.flags || []).some((f) => f.includes("CARD_TARGET"))) {
    notes.push("Targets, but EFFECT_FLAG_CARD_TARGET is missing — the client will not show target selection.");
  }
  if (!effect.isTargeting && effect.targetDescription) {
    notes.push("Has a target function but does not target (chk-only validity check).");
  }
  if (!effect.operationDescription && !/Duel\.[A-Z]/.test(effect.rawSnippet || "")) {
    notes.push("No operation body detected — the effect would register but do nothing.");
  }
  if (effect.costDescription && /return true/.test(effect.costDescription) && !/chk==0/.test(effect.costDescription.replace(/\s+/g, ""))) {
    notes.push("Cost function may always return true; verify the chk==0 branch.");
  }
  if (kind === "trigger" && effect.hintTiming) {
    notes.push(`Timing hint: ${effect.hintTiming}`);
  }

  return {
    index: effect.index,
    kind,
    triggerEvent: effect.code,
    quartet: {
      condition: Boolean(effect.conditionDescription),
      cost: Boolean(effect.costDescription),
      target: Boolean(effect.targetDescription),
      operation: Boolean(effect.operationDescription)
    },
    costKinds,
    targets: Boolean(effect.isTargeting),
    reset: effect.reset,
    countLimit: countLimitKind(effect),
    spellSpeed: effect.spellSpeed,
    categories: effect.categories || [],
    notes
  };
}

function detectGlobals(lua: string): string[] {
  const found = new Set<string>();
  for (const name of Object.keys(GLOBAL_LIBRARIES)) {
    if (new RegExp(`\\b${name}\\.`).test(lua)) found.add(name);
  }
  return [...found];
}

function riskScan(lua: string, analysis: LuaCardAnalysis): ScriptRisk[] {
  const risks: ScriptRisk[] = [];
  const lower = lua.toLowerCase();

  if (!/function\s+s\.initial_effect|c\.initial_effect|initial_effect\s*=/.test(lua)) {
    risks.push({ severity: "error", code: "missing-initial-effect", message: "No initial_effect function; the card will register no effects." });
  }
  if (/LOCATION_GY\b/.test(lua)) {
    risks.push({ severity: "error", code: "invalid-location-gy", message: "LOCATION_GY does not exist; use LOCATION_GRAVE." });
  }
  if (/LOCATION_BANISHED\b/.test(lua)) {
    risks.push({ severity: "error", code: "invalid-location-banished", message: "LOCATION_BANISHED does not exist; use LOCATION_REMOVED." });
  }
  if (/aux\.Add\w*Procedure/.test(lua)) {
    risks.push({ severity: "error", code: "aux-add-procedure", message: "aux.Add*Procedure is not in standard utility.lua; use Link/Xyz/Synchro/Fusion.AddProcedure." });
  }
  if (/\bTODO\b|skeleton|not implemented/i.test(lua)) {
    risks.push({ severity: "warning", code: "skeleton", message: "Script still contains TODO/skeleton markers; the effect does nothing." });
  }

  const globals = detectGlobals(lua);
  const missing = globals.filter((g) => !new RegExp(`Duel\\.LoadScript\\s*\\(\\s*["']${GLOBAL_LIBRARIES[g]}`).test(lua));
  for (const g of missing) {
    risks.push({
      severity: "info",
      code: "missing-load-script",
      message: `Uses ${g}.* without Duel.LoadScript("${GLOBAL_LIBRARIES[g]}"). EDOPro preloads these libraries; YGO Omega does not, so add the LoadScript there.`
    });
  }

  const selectsTarget = /Duel\.SelectTarget/.test(lua);
  const hasCardTargetFlag = /EFFECT_FLAG_CARD_TARGET/.test(lua);
  if (selectsTarget && !hasCardTargetFlag) {
    risks.push({
      severity: "warning",
      code: "selecttarget-without-flag",
      message: "Duel.SelectTarget is used but no effect declares EFFECT_FLAG_CARD_TARGET."
    });
  }

  // Only activated effects need an operation. Continuous/static effects legitimately
  // use SetTarget as a filter (e.g. a field effect that only applies to certain monsters).
  const targetWithoutOp = (analysis.effects || []).filter((e) => {
    const raw = e.rawSnippet || "";
    const kind = classifyKind(e);
    const isActivated = ["activate", "ignition", "trigger", "quick", "flip"].includes(kind);
    return isActivated && /SetTarget\s*\(/.test(raw) && !/SetOperation\s*\(/.test(raw);
  });
  if (targetWithoutOp.length > 0) {
    risks.push({
      severity: "warning",
      code: "target-without-operation",
      message: `${targetWithoutOp.length} activated effect(s) call SetTarget but never SetOperation; the target is chosen and nothing happens.`
    });
  }

  if (/SetCountLimit\s*\(\s*1\s*,\s*id\s*,\s*EFFECT_COUNT_CODE_OATH/.test(lua)) {
    risks.push({
      severity: "info",
      code: "oath-count-limit",
      message: "EFFECT_COUNT_CODE_OATH can be unstable on YGO Omega; plain SetCountLimit(1, id) is safer there."
    });
  }

  if (/hardcoded|https?:\/\//.test(lower)) {
    // External URLs inside a card script are almost always a mistake.
    if (/https?:\/\//.test(lua)) {
      risks.push({ severity: "info", code: "external-url", message: "The script contains an external URL; card scripts should be self-contained." });
    }
  }

  return risks;
}

export function analyzeScriptDeep(lua: string, passcode: number): ScriptInsight {
  const analysis = analyzeLuaCard(lua, passcode);
  const effects = (analysis.effects || []).map(analyzeEffect);

  const globals = detectGlobals(lua);
  const libraries = [...new Set([
    ...globals.map((g) => GLOBAL_LIBRARIES[g]),
    ...(analysis.simulatorProfile?.loadedLibraries || [])
  ])].filter(Boolean);
  const missingLoadScript = globals.filter((g) => !new RegExp(`Duel\\.LoadScript\\s*\\(\\s*["']${GLOBAL_LIBRARIES[g]}`).test(lua));

  const risks = riskScan(lua, analysis);
  const branches = (lua.match(/\b(if|elseif|while|for|repeat)\b/g) || []).length;

  const complexity = {
    lines: lua.split("\n").length,
    functions: analysis.stats?.functionCount ?? (analysis.functions || []).length,
    effects: effects.length,
    branches,
    apiCalls: analysis.stats?.apiCallCount ?? (analysis.apiCalls || []).length
  };

  const summary = buildSummary(passcode, analysis, effects, risks);

  return {
    passcode,
    parsed: analysis.parsed,
    parseError: analysis.parseError,
    effects,
    dependencies: { libraries, globals, missingLoadScript },
    risks,
    complexity,
    summary
  };
}

function buildSummary(passcode: number, analysis: LuaCardAnalysis, effects: EffectInsight[], risks: ScriptRisk[]): string {
  if (!analysis.parsed) {
    return `Card ${passcode}: Lua parse failed (${analysis.parseError || "syntax error"}).`;
  }

  const kinds = effects.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] || 0) + 1;
    return acc;
  }, {});
  const kindText = Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ") || "no registered effects";
  const hopt = effects.filter((e) => e.countLimit === "hard").length;
  const errors = risks.filter((r) => r.severity === "error").length;
  const warnings = risks.filter((r) => r.severity === "warning").length;

  return [
    `Card ${passcode}: ${kindText}.`,
    hopt ? `${hopt} hard once-per-turn effect(s).` : "",
    errors + warnings ? `${errors} error(s), ${warnings} warning(s).` : "No structural risks found."
  ].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Corpus analysis
// ---------------------------------------------------------------------------

export interface CorpusInsight {
  scripts: number;
  parsed: number;
  failed: number;
  averageEffects: number;
  averageLines: number;
  effectKinds: Array<{ kind: string; count: number }>;
  triggers: Array<{ event: string; count: number }>;
  categories: Array<{ category: string; count: number }>;
  countLimits: { hard: number; soft: number; duel: number; none: number };
  risks: Array<{ code: string; severity: string; count: number }>;
  topApis: Array<{ api: string; count: number }>;
  worstScripts: Array<{ passcode: number; issues: number; summary: string }>;
}

export function analyzeScriptCorpus(entries: Array<{ passcode: number; lua: string }>): CorpusInsight {
  const kindCounts = new Map<string, number>();
  const triggerCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const riskCounts = new Map<string, { severity: string; count: number }>();
  const apiCounts = new Map<string, number>();
  const countLimits = { hard: 0, soft: 0, duel: 0, none: 0 };

  let parsed = 0;
  let effectsTotal = 0;
  let linesTotal = 0;
  const worst: Array<{ passcode: number; issues: number; summary: string }> = [];

  for (const entry of entries) {
    const insight = analyzeScriptDeep(entry.lua, entry.passcode);
    if (insight.parsed) parsed += 1;
    effectsTotal += insight.effects.length;
    linesTotal += insight.complexity.lines;

    for (const effect of insight.effects) {
      kindCounts.set(effect.kind, (kindCounts.get(effect.kind) || 0) + 1);
      if (effect.triggerEvent) {
        const key = effect.triggerEvent.replace(/"/g, "");
        triggerCounts.set(key, (triggerCounts.get(key) || 0) + 1);
      }
      for (const category of effect.categories) {
        categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      }
      countLimits[effect.countLimit] += 1;
    }

    for (const risk of insight.risks) {
      const existing = riskCounts.get(risk.code) || { severity: risk.severity, count: 0 };
      existing.count += 1;
      riskCounts.set(risk.code, existing);
    }

    for (const call of analyzeLuaCard(entry.lua, entry.passcode).apiCalls || []) {
      // Normalise receivers away: "e1:SetType" and "Duel.SelectTarget" become the method name.
      const raw = call.name || "unknown";
      const api = raw.includes(":") || raw.includes(".") ? raw.split(/[:.]/).pop() || raw : raw;
      apiCounts.set(api, (apiCounts.get(api) || 0) + 1);
    }

    const issues = insight.risks.filter((r) => r.severity !== "info").length;
    if (issues > 0) worst.push({ passcode: entry.passcode, issues, summary: insight.summary });
  }

  const toSorted = (map: Map<string, number>, limit = 20) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => ({ key, count }));

  return {
    scripts: entries.length,
    parsed,
    failed: entries.length - parsed,
    averageEffects: entries.length ? Math.round((effectsTotal / entries.length) * 10) / 10 : 0,
    averageLines: entries.length ? Math.round(linesTotal / entries.length) : 0,
    effectKinds: toSorted(kindCounts).map(({ key, count }) => ({ kind: key, count })),
    triggers: toSorted(triggerCounts).map(({ key, count }) => ({ event: key, count })),
    categories: toSorted(categoryCounts, 12).map(({ key, count }) => ({ category: key, count })),
    countLimits,
    risks: [...riskCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([code, meta]) => ({ code, severity: meta.severity, count: meta.count })),
    topApis: toSorted(apiCounts, 15).map(({ key, count }) => ({ api: key, count })),
    worstScripts: worst.sort((a, b) => b.issues - a.issues).slice(0, 10)
  };
}
