/**
 * Lock and restriction detection.
 *
 * Deck builders routinely assemble lines that contradict each other: a card
 * that locks you into Fusion Summons, another that forbids Special Summoning,
 * a third that cannot be used as material. The engine knows these rules only at
 * runtime; this module reads them out of the Lua script so a deck can be checked
 * before it is built.
 *
 * Real scripts rarely write `SetTarget(s.namedFunction)` with a simple
 * `IsType(TYPE_SYNCHRO)` check. They use inline anonymous functions,
 * `IsSynchroMonster()`-style predicates, `IsOriginalType`, and helper calls such
 * as `aux.addContinuousLizardCheck`. All of those are handled here, and the card
 * database text is the last-resort fallback so the answer is never just
 * "restricts actions".
 */

export interface ScriptLock {
  kind: "summon-lock" | "activation-lock" | "material-lock" | "extra-deck-lock" | "attack-lock";
  scope: "self" | "opponent" | "both" | "unknown";
  detail: string;
  line?: number;
}

const CODE_KINDS: Array<[RegExp, ScriptLock["kind"]]> = [
  [/EFFECT_CANNOT_SPECIAL_SUMMON/, "summon-lock"],
  [/EFFECT_CANNOT_SUMMON/, "summon-lock"],
  [/EFFECT_LIMIT_SPECIAL_SUMMON/, "summon-lock"],
  [/EFFECT_CANNOT_ACTIVATE/, "activation-lock"],
  [/EFFECT_CANNOT_BE_MATERIAL|EFFECT_CANNOT_BE_(FUSION|SYNCHRO|XYZ|LINK)_MATERIAL/, "material-lock"],
  [/EFFECT_CANNOT_ATTACK|EFFECT_CANNOT_ATTACK_ANNOUNCE/, "attack-lock"]
];

function scopeFrom(text: string): ScriptLock["scope"] {
  const match = text.match(/SetTargetRange\(\s*(\d)\s*,\s*(\d)\s*\)/);
  if (!match) return "unknown";
  const self = match[1] === "1";
  const opp = match[2] === "1";
  if (self && opp) return "both";
  if (self) return "self";
  if (opp) return "opponent";
  return "unknown";
}

/**
 * Extract a Lua function body starting at the first `function` at/after
 * `fromIndex`, matching `function`/`if`/`for`/`while`/`repeat` against
 * `end`/`until`. `do` is not counted because it belongs to a `for`/`while`
 * that is already counted.
 */
function extractFunctionBody(source: string, fromIndex: number): string {
  const fnIndex = source.indexOf("function", fromIndex);
  if (fnIndex < 0) return "";

  const tokenRe = /\b(function|if|for|while|repeat|end|until)\b/g;
  tokenRe.lastIndex = fnIndex + "function".length;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(source))) {
    const kw = match[1];
    if (kw === "function" || kw === "if" || kw === "for" || kw === "while" || kw === "repeat") {
      depth += 1;
    } else if (kw === "end" || kw === "until") {
      depth -= 1;
      if (depth === 0) return source.slice(fnIndex, match.index + kw.length);
    }
  }
  return source.slice(fnIndex, fnIndex + 1200);
}

interface TypeFamily {
  label: string;
  /** Regex fragment matching the Lua predicate. */
  predicate: string;
}

const TYPE_FAMILIES: TypeFamily[] = [
  { label: "Fusion", predicate: "IsType\\(TYPE_FUSION\\)|IsOriginalType\\(TYPE_FUSION\\)|IsFusionMonster\\(\\)|IsSummonType\\(SUMMON_TYPE_FUSION\\)" },
  { label: "Synchro", predicate: "IsType\\(TYPE_SYNCHRO\\)|IsOriginalType\\(TYPE_SYNCHRO\\)|IsSynchroMonster\\(\\)|IsSummonType\\(SUMMON_TYPE_SYNCHRO\\)" },
  { label: "Xyz", predicate: "IsType\\(TYPE_XYZ\\)|IsOriginalType\\(TYPE_XYZ\\)|IsXyzMonster\\(\\)|IsSummonType\\(SUMMON_TYPE_XYZ\\)" },
  { label: "Link", predicate: "IsType\\(TYPE_LINK\\)|IsOriginalType\\(TYPE_LINK\\)|IsLinkMonster\\(\\)|IsSummonType\\(SUMMON_TYPE_LINK\\)" },
  { label: "Ritual", predicate: "IsType\\(TYPE_RITUAL\\)|IsOriginalType\\(TYPE_RITUAL\\)|IsRitualMonster\\(\\)|IsSummonType\\(SUMMON_TYPE_RITUAL\\)" },
  { label: "Effect", predicate: "IsType\\(TYPE_EFFECT\\)|IsOriginalType\\(TYPE_EFFECT\\)|IsEffectMonster\\(\\)" }
];

/** Reads the restriction implied by a limit function body. */
function detailFrom(text: string): string {
  if (!text) return "";

  for (const family of TYPE_FAMILIES) {
    const positive = new RegExp(`(?:${family.predicate})`);
    const negated = new RegExp(`not[\\s\\S]{0,60}?(?:${family.predicate})`);
    if (!positive.test(text)) continue;

    if (negated.test(text)) {
      // "not c:IsSynchroMonster()" inside a cannot-summon check means only
      // Synchro Monsters are allowed.
      return `${family.label} Monsters only`;
    }
    return `${family.label} Monsters are restricted`;
  }

  const setcode = text.match(/IsSetCard\(\s*([^)\s]{1,40})\s*\)/);
  if (setcode) return `cards of set ${setcode[1].trim()} only`;

  const attribute = text.match(/IsAttribute\(\s*ATTRIBUTE_([A-Z]+)\s*\)/);
  if (attribute) return `${attribute[1]} monsters only`;

  const race = text.match(/IsRace\(\s*RACE_([A-Z_]+)\s*\)/);
  if (race) return `${race[1]} monsters only`;

  return "";
}

/** Last-resort fallback: read the restriction from the card database text. */
function detailFromCardText(text: string): string {
  if (!text) return "";
  const body = text.replace(/\s+/g, " ");

  if (/cannot Special Summon/i.test(body)) {
    const except = body.match(/except ([A-Za-z][A-Za-z /-]{1,40}?) Monsters?/i);
    if (except) return `${except[1].trim()} Monsters only`;
    return "Special Summoning is forbidden";
  }
  if (/cannot activate (?:the )?(?:effects?|cards?)/i.test(body) || /cannot activate/i.test(body)) {
    return "activation is forbidden";
  }
  if (/cannot be used as (?:a )?(?:Fusion|Synchro|Xyz|Link) Material/i.test(body)) {
    return "cannot be used as material";
  }
  if (/cannot attack/i.test(body)) return "cannot attack";
  return "";
}

/** Collect every restriction function body referenced in a code window. */
function restrictionBodies(lua: string, window: string): string[] {
  const bodies: string[] = [];

  // 1. Anonymous inline functions (SetTarget(function(e,c) ... end),
  //    aux.addContinuousLizardCheck(c, LOCATION_MZONE, function(e,c) ... end)).
  let cursor = 0;
  while (cursor < window.length) {
    const next = window.indexOf("function", cursor);
    if (next < 0) break;
    const body = extractFunctionBody(window, next);
    if (body) bodies.push(body);
    cursor = next + "function".length;
  }

  // 2. Named functions referenced as SetTarget(s.foo) / SetTarget(foo).
  for (const match of window.matchAll(/SetTarget\(\s*([A-Za-z_][\w.]*)\s*\)/g)) {
    const name = match[1];
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const defIndex = lua.search(new RegExp(`function\\s+${escaped}\\s*\\(`));
    if (defIndex >= 0) {
      const body = extractFunctionBody(lua, defIndex);
      if (body) bodies.push(body);
    }
  }

  return bodies;
}

export function detectLocks(lua: string, cardText?: string): ScriptLock[] {
  const locks: ScriptLock[] = [];
  const lines = lua.split("\n");

  // Work on effect-sized windows so SetTargetRange and SetCode stay together.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const codeMatch = CODE_KINDS.find(([re]) => re.test(line));
    if (!codeMatch) continue;

    const window = lines.slice(Math.max(0, i - 8), Math.min(lines.length, i + 20)).join("\n");
    const kind = codeMatch[1];
    const scope = scopeFrom(window);

    let detail = "";
    for (const body of restrictionBodies(lua, window)) {
      const found = detailFrom(body);
      if (found && !/ are restricted$/.test(found)) {
        detail = found;
        break;
      }
      if (found && !detail) detail = found;
    }
    if (!detail) detail = detailFrom(window);
    if (!detail) detail = detailFromCardText(cardText || "");

    // A summon lock that only allows one card type is really an Extra Deck lock.
    let resolvedKind = kind;
    if (kind === "summon-lock" && /only$/.test(detail)) resolvedKind = "extra-deck-lock";

    if (!detail) detail = kind === "material-lock" ? "cannot be used as material" : "restricts actions";

    locks.push({ kind: resolvedKind, scope, detail, line: i + 1 });
  }

  // De-duplicate identical findings.
  const seen = new Set<string>();
  return locks.filter((lock) => {
    const key = `${lock.kind}|${lock.scope}|${lock.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface DeckLockReport {
  available: boolean;
  cardsChecked: number;
  locksFound: number;
  byCard: Array<{ passcode: number; cardName?: string; locks: ScriptLock[] }>;
  conflicts: string[];
  reason?: string;
}

/** Aggregates locks across a deck and points out contradictions. */
export async function auditDeckLocks(
  passcodes: number[],
  resolver: (passcode: number) => Promise<{ available: boolean; text?: string; cardName?: string; cardText?: string }>
): Promise<DeckLockReport> {
  const unique = [...new Set(passcodes)].filter((c) => c > 0);
  const byCard: DeckLockReport["byCard"] = [];
  let locksFound = 0;

  for (const passcode of unique) {
    const script = await resolver(passcode);
    if (!script.available || !script.text) continue;
    const locks = detectLocks(script.text, script.cardText);
    if (locks.length === 0) continue;
    locksFound += locks.length;
    byCard.push({ passcode, cardName: script.cardName, locks });
  }

  const conflicts: string[] = [];
  const summonLocks = byCard.filter((c) => c.locks.some((l) => l.kind === "summon-lock"));
  const extraLocks = byCard.filter((c) => c.locks.some((l) => l.kind === "extra-deck-lock"));

  if (summonLocks.length > 0 && extraLocks.length > 0) {
    conflicts.push(
      `Cards that forbid Special Summoning (${summonLocks.map((c) => c.cardName || c.passcode).join(", ")}) conflict with Extra Deck locks (${extraLocks.map((c) => c.cardName || c.passcode).join(", ")}).`
    );
  }
  const types = new Set(extraLocks.flatMap((c) => c.locks.filter((l) => l.kind === "extra-deck-lock").map((l) => l.detail)));
  if (types.size > 1) {
    conflicts.push(`Mutually exclusive Extra Deck locks: ${[...types].join(" vs ")}.`);
  }

  return {
    available: unique.length > 0,
    cardsChecked: unique.length,
    locksFound,
    byCard,
    conflicts,
    reason: unique.length === 0 ? "No cards to check." : undefined
  };
}
