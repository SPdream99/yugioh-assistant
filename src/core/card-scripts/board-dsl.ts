/**
 * Board notation for scenarios.
 *
 * Writing a ScenarioSpec by hand means passcodes, arrays and decision objects.
 * This parser turns a short block into one:
 *
 *   A hand: Branded Fusion, Called by the Grave
 *   B hand: Ash Blossom
 *   A deck: Fallen of Albaz, Effect Veiler
 *   A extra: Albion the Branded Dragon
 *   A: activate "Branded Fusion"
 *   B: chain "Ash Blossom"
 *   A: chain "Called by the Grave"
 *   A: pick "Albion the Branded Dragon"
 *   expect: chainLink "Called by the Grave" 3
 *   expect: banished "Ash Blossom"
 *   expect: summoned "Albion the Branded Dragon"
 *
 * Card names are resolved to passcodes by the caller, so the notation stays
 * readable. Anything the parser does not understand is reported, not ignored.
 */

import type { ScenarioDecision, ScenarioSpec, Expectation } from "./scenario-runner.js";

export interface BoardParseResult {
  available: boolean;
  spec?: ScenarioSpec;
  errors: string[];
  warnings: string[];
  lines: number;
}

const SEPARATOR = /[,;]/;

function splitCards(value: string): string[] {
  return value
    .split(SEPARATOR)
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function unquote(value: string): string {
  return value.trim().replace(/^["“”']|["“”']$/g, "").trim();
}

/**
 * Idle-window verbs. `synchro`/`xyz`/`link`/`fusion`/`ritual` all resolve to the
 * engine's Special Summon list, which is exactly where ocgcore exposes those
 * summons. Multi-word verbs are matched longest-first below.
 */
const IDLE_VERBS: Array<[string, ScenarioDecision["action"]]> = [
  ["activate", "activate"],
  ["special summon", "spsummon"],
  ["spsummon", "spsummon"],
  ["synchro summon", "spsummon"],
  ["synchro", "spsummon"],
  ["xyz summon", "spsummon"],
  ["xyz", "spsummon"],
  ["link summon", "spsummon"],
  ["link", "spsummon"],
  ["fusion summon", "spsummon"],
  ["fusion", "spsummon"],
  ["ritual summon", "spsummon"],
  ["ritual", "spsummon"],
  ["normal summon", "summon"],
  ["summon", "summon"],
  ["set spell", "set_spell"],
  ["set monster", "set_monster"],
  ["set", "set_monster"],
  ["battle phase", "to_bp"],
  ["to battle", "to_bp"],
  ["end phase", "to_ep"],
  ["end", "to_ep"]
];

const UTILITY_VERBS = ["pass turn", "pass", "pick", "chain", "accept", "decline", "attack with", "attack"];

const ALL_VERBS = [...UTILITY_VERBS, ...IDLE_VERBS.map(([verb]) => verb)].sort((a, b) => b.length - a.length);

function matchVerb(body: string): { verb: string; rest: string } | null {
  const lower = body.toLowerCase();
  for (const verb of ALL_VERBS) {
    if (lower === verb) return { verb, rest: "" };
    if (lower.startsWith(`${verb} `)) return { verb, rest: body.slice(verb.length).trim() };
  }
  return null;
}

const EXPECT_MAP: Record<string, Expectation["kind"]> = {
  chainlink: "chainLink",
  "chain link": "chainLink",
  chainsolved: "chainSolved",
  negated: "negated",
  summoned: "summoned",
  notsummoned: "notSummoned",
  tograve: "toGrave",
  banished: "banished",
  activated: "activated",
  size: "size",
  lp: "lp"
};

export function parseBoard(text: string, name = "Board notation scenario"): BoardParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = (text || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  const spec: ScenarioSpec = {
    name,
    handA: [] as any,
    handB: [] as any,
    deckA: [] as any,
    deckB: [] as any,
    extraA: [] as any,
    extraB: [] as any,
    decisions: [],
    expect: []
  };

  for (const line of lines) {
    // Setup lines: "A hand: X, Y"
    const setup = line.match(/^([AB])\s+(hand|deck|extra|side)\s*:\s*(.+)$/i);
    if (setup) {
      const side = setup[1].toUpperCase() === "A" ? "A" : "B";
      const zone = setup[2].toLowerCase();
      const cards = splitCards(setup[3]);
      if (zone === "hand") (spec as any)[`hand${side}`] = cards;
      else if (zone === "deck") (spec as any)[`deck${side}`] = cards;
      else if (zone === "extra") (spec as any)[`extra${side}`] = cards;
      else warnings.push(`Side Deck is not used by the simulator: "${line}"`);
      continue;
    }

    // Expectations: "expect: summoned \"Card\""
    const expectMatch = line.match(/^expect\s*:\s*([a-zA-Z ]+?)\s+(.+)$/i);
    if (expectMatch) {
      const kind = EXPECT_MAP[expectMatch[1].trim().toLowerCase().replace(/\s+/g, "")];
      if (!kind) {
        errors.push(`Unknown expectation "${expectMatch[1]}"`);
        continue;
      }
      const rest = expectMatch[2].trim();
      const numeric = rest.match(/(\d+)\s*$/);
      const target = numeric ? rest.slice(0, numeric.index).trim() : rest;

      switch (kind) {
        case "chainLink": {
          const m = rest.match(/^(.*?)\s+(\d+)\s*$/);
          if (m) spec.expect.push({ kind, card: unquote(m[1]) as any, link: Number(m[2]) });
          else errors.push(`chainLink needs a card and a link number: "${line}"`);
          break;
        }
        case "activated": {
          const m = rest.match(/^(.*?)\s+(\d+)\s*$/);
          spec.expect.push(m ? { kind, card: unquote(m[1]) as any, times: Number(m[2]) } : { kind, card: unquote(rest) as any });
          break;
        }
        case "size": {
          // expect: size 1 hand 2
          const m = rest.match(/^(\d+)\s+(hand|grave|banished|deck|extra)\s*([AB])$/i);
          if (!m) { errors.push(`size needs: expect: size <n> <zone> <A|B>`); break; }
          spec.expect.push({ kind, player: m[3].toUpperCase() === "A" ? 0 : 1, zone: m[2].toLowerCase() as any, equals: Number(m[1]) });
          break;
        }
        default:
          spec.expect.push({ kind: kind as any, card: unquote(target) as any });
      }
      continue;
    }

    // Auto-accept directive for optional effects / yes-no prompts.
    const autoMatch = line.match(/^auto\s+(accept|decline)$/i);
    if (autoMatch) {
      spec.autoAcceptOptional = autoMatch[1].toLowerCase() === "accept";
      continue;
    }

    // Actions: "A: activate \"Card\""
    const action = line.match(/^([AB])\s*:\s*(.+)$/);
    if (action) {
      const player = action[1].toUpperCase() === "A" ? 0 : 1;
      const body = action[2].trim();
      const matched = matchVerb(body);
      if (!matched) {
        errors.push(`Cannot read action: "${line}". Use a verb such as activate, summon, synchro, xyz, link, fusion, ritual, set, chain, pick, attack, accept, decline, pass, end.`);
        continue;
      }
      const verb = matched.verb;
      const card = unquote(matched.rest);

      if (verb === "pass turn") {
        spec.decisions.push({ on: "idle", player, action: "to_ep", label: `P${player + 1} ends the phase` });
        continue;
      }
      if (verb === "pass") {
        spec.decisions.push({ on: "chain", player, pass: true, label: `P${player + 1} passes` });
        continue;
      }
      if (verb === "pick") {
        spec.decisions.push({ on: "card", player, cards: [card] as any, label: `P${player + 1} picks ${card}` });
        continue;
      }
      if (verb === "chain") {
        spec.decisions.push({ on: "chain", player, card: card as any, label: `P${player + 1} chains ${card}` });
        continue;
      }
      if (verb === "accept" || verb === "decline") {
        const yes = verb === "accept";
        spec.decisions.push({
          on: "yes",
          player,
          yes,
          label: `P${player + 1} ${verb}s${card ? ` ${card}` : " the optional effect"}`
        });
        continue;
      }
      if (verb === "attack" || verb === "attack with") {
        spec.decisions.push({ on: "battle", player, card: card as any, label: `P${player + 1} attacks${card ? ` with ${card}` : ""}` });
        continue;
      }
      const idle = IDLE_VERBS.find(([v]) => v === verb);
      if (!idle) {
        errors.push(`Unknown action "${verb}" in: "${line}"`);
        continue;
      }
      spec.decisions.push({
        on: "idle",
        player,
        action: idle[1],
        card: card as any,
        label: `P${player + 1} ${verb} ${card}`.trim()
      });
      continue;
    }

    errors.push(`Unrecognised line: "${line}"`);
  }

  const hasActivate = spec.decisions.some((d) => d.on === "idle" && d.action === "activate");
  const hasYes = spec.decisions.some((d) => d.on === "yes");
  if (hasActivate && !hasYes && spec.autoAcceptOptional !== true) {
    warnings.push(
      "Optional effects are declined unless scripted. Add `A: accept` (or the `auto accept` directive) when the line depends on one."
    );
  }

  const available = errors.length === 0 && (spec.decisions.length > 0 || spec.expect.length > 0);
  if (!available && errors.length === 0) {
    errors.push("The board has no actions or expectations, so there is nothing to run.");
  }

  return { available, spec, errors, warnings, lines: lines.length };
}

function nonEmpty(value: string | undefined): string {
  return (value || "").trim();
}
