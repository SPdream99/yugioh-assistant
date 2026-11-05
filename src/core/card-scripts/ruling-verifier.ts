/**
 * Claim verification.
 *
 * A judge's conclusion is only useful if it can be checked. This module takes a
 * claim ("Called by the Grave negates Ash Blossom"), runs a real scenario on
 * ocgcore, and reports whether the engine agrees — SUPPORTED, CONTRADICTED or
 * INCONCLUSIVE — with the observation that decided it.
 */

import { CardDatabase } from "../card-database/ygoprodeck.js";
import { runScenario, type ScenarioSpec } from "./scenario-runner.js";
import { loadGoldenCases } from "./golden-regression.js";

export type ClaimOutcome = "SUPPORTED" | "CONTRADICTED" | "INCONCLUSIVE";

export interface ClaimVerification {
  claim: string;
  outcome: ClaimOutcome;
  confidence: "high" | "medium" | "low";
  reason: string;
  scenario?: string;
  observations: Record<string, unknown>;
  evidence: string[];
}

type Verb = "negate" | "summon" | "banish" | "destroy" | "draw" | "search" | "activate";

const VERB_PATTERNS: Array<[Verb, RegExp]> = [
  ["negate", /\bnegat|vô hiệu|chặn|block/i],
  ["summon", /\bsummon|triệu hồi/i],
  ["banish", /\bbanish|remov(e|ed) from play|loại bỏ/i],
  ["destroy", /\bdestroy|tiêu diệt/i],
  ["draw", /\bdraw|rút bài/i],
  ["search", /\bsearch|add .* to (your )?hand|tìm bài/i],
  ["activate", /\bactivat|kích hoạt/i]
];

const NEGATIVE = /\b(cannot|can ?not|can't|does ?not|isn't|not |no |không|không thể|chẳng)\b/i;

function detectVerbs(claim: string): Verb[] {
  return VERB_PATTERNS.filter(([, re]) => re.test(claim)).map(([verb]) => verb);
}

async function detectCards(claim: string): Promise<number[]> {
  const db = CardDatabase.getInstance();
  const codes = new Set<number>();

  // Explicit passcodes.
  for (const match of claim.matchAll(/\b(\d{6,9})\b/g)) codes.add(Number(match[1]));

  // Quoted names are the most reliable signal.
  const quoted = [...claim.matchAll(/["“”']([^"“”']{3,60})["“”']/g)].map((m) => m[1]);
  for (const name of quoted) {
    try {
      const card = await db.fetchCardOnline(name);
      if (card) codes.add(card.id);
    } catch {
      // ignore
    }
  }

  // Known card names mentioned without quotes (partial names included).
  const aliases: Array<[RegExp, string]> = [
    [/called by( the grave)?/i, "Called by the Grave"],
    [/ash blossom/i, "Ash Blossom & Joyous Spring"],
    [/branded fusion/i, "Branded Fusion"],
    [/pot of greed/i, "Pot of Greed"],
    [/baronne/i, "Baronne de Fleur"],
    [/albion/i, "Albion the Branded Dragon"]
  ];
  for (const [pattern, known] of aliases) {
    if (!pattern.test(claim)) continue;
    try {
      const card = await db.fetchCardOnline(known);
      if (card) codes.add(card.id);
    } catch {
      // ignore
    }
  }

  return [...codes];
}

interface Observations {
  negatedCodes: number[];
  resolvedCodes: number[];
  summonedCodes: number[];
  banishedCodes: number[];
  destroyedCodes: number[];
  draws: number;
  activatedCodes: number[];
  /** Cards whose effect was neutralised, from CHAIN_NEGATED or a met expectation. */
  neutralizedCodes: number[];
}

function observe(result: Awaited<ReturnType<typeof runScenario>>): Observations {
  const obs: Observations = {
    negatedCodes: [],
    resolvedCodes: [],
    summonedCodes: [],
    banishedCodes: [],
    destroyedCodes: [],
    draws: 0,
    activatedCodes: [],
    neutralizedCodes: []
  };

  for (const link of result.chain) {
    if (link.negated) obs.negatedCodes.push(link.code);
    if (link.solved) obs.resolvedCodes.push(link.code);
  }

  for (const message of result.timeline) {
    if (/SPSUMMONING|SUMMONING/.test(message)) {
      const match = message.match(/(\d{4,9})/);
      if (match) obs.summonedCodes.push(Number(match[1]));
    }
    if (/BANISHED/.test(message)) {
      const match = message.match(/(\d{4,9})/);
      if (match) obs.banishedCodes.push(Number(match[1]));
    }
    if (/DESTROY/.test(message)) {
      const match = message.match(/(\d{4,9})/);
      if (match) obs.destroyedCodes.push(Number(match[1]));
    }
    if (/^T\d+: DRAW/.test(message)) {
      const drawn = message.match(/drew\s+(.*)$/);
      obs.draws += drawn ? drawn[1].split(",").length : 0;
    }
    if (/CHAINING/.test(message)) {
      const match = message.match(/(\d{4,9})/);
      if (match) obs.activatedCodes.push(Number(match[1]));
    }
  }

  // The engine does not emit CHAIN_NEGATED for effect negation, so a met
  // expectation ("X is negated", "X is banished", "X is NOT Summoned") is the
  // reliable signal that an effect was neutralised.
  for (const expectation of result.expectations || []) {
    if (!expectation.met) continue;
    if (!/negat|banish|not summoned/i.test(expectation.expectation)) continue;
    for (const match of expectation.expectation.matchAll(/(\d{4,9})/g)) {
      obs.neutralizedCodes.push(Number(match[1]));
    }
  }
  for (const code of obs.negatedCodes) obs.neutralizedCodes.push(code);

  return obs;
}

function evaluateClaim(claim: string, cards: number[], obs: Observations): { outcome: ClaimOutcome; reason: string; evidence: string[]; matched: boolean } {
  const verbs = detectVerbs(claim);
  const negative = NEGATIVE.test(claim);
  const evidence: string[] = [];
  let matched = false;
  let observed = false;

  for (const verb of verbs) {
    let hitCards: number[] = [];
    let happened = false;

    switch (verb) {
      case "negate":
        hitCards = cards.filter((c) => obs.neutralizedCodes.includes(c));
        happened = hitCards.length > 0 || obs.neutralizedCodes.length > 0;
        evidence.push(`Neutralised: ${obs.neutralizedCodes.join(", ") || "none"}`);
        break;
      case "summon":
        hitCards = cards.filter((c) => obs.summonedCodes.includes(c));
        happened = hitCards.length > 0 || obs.summonedCodes.length > 0;
        evidence.push(`Summons: ${obs.summonedCodes.join(", ") || "none"}`);
        break;
      case "banish":
        hitCards = cards.filter((c) => obs.banishedCodes.includes(c));
        happened = hitCards.length > 0 || obs.banishedCodes.length > 0;
        evidence.push(`Banished: ${obs.banishedCodes.join(", ") || "none"}`);
        break;
      case "destroy":
        hitCards = cards.filter((c) => obs.destroyedCodes.includes(c));
        happened = hitCards.length > 0 || obs.destroyedCodes.length > 0;
        evidence.push(`Destroyed: ${obs.destroyedCodes.join(", ") || "none"}`);
        break;
      case "draw": {
        const amountMatch = claim.match(/\b(?:draw|draws|drew)\s+(\d+|one|two|three|four|five)\b/i);
        const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
        const wanted = amountMatch
          ? (/^\d+$/.test(amountMatch[1]) ? Number(amountMatch[1]) : words[amountMatch[1].toLowerCase()])
          : undefined;
        happened = obs.draws > 0;
        evidence.push(`Cards drawn: ${obs.draws}${wanted !== undefined ? ` (claim says ${wanted})` : ""}`);
        if (wanted !== undefined) {
          const agrees = obs.draws === wanted;
          return {
            outcome: agrees ? "SUPPORTED" : "CONTRADICTED",
            reason: `The engine drew ${obs.draws} card(s); the claim says ${wanted}.`,
            evidence,
            matched: true
          };
        }
        break;
      }
      case "search":
        evidence.push("Search effects are not observable from the message stream.");
        continue;
      case "activate":
        hitCards = cards.filter((c) => obs.activatedCodes.includes(c));
        happened = hitCards.length > 0 || obs.activatedCodes.length > 0;
        evidence.push(`Activated: ${obs.activatedCodes.join(", ") || "none"}`);
        break;
    }

    // Claims that do not name a card are judged on whether *anything* of that
    // kind happened. A partially-named card still counts if the scenario shows
    // the verb occurring.
    const relevant = cards.length === 0 || hitCards.length > 0 || verb === "draw" || happened;
    if (!relevant) continue;

    observed = true;
    const agrees = negative ? !happened : happened;
    const verbPhrase = `The engine ${happened ? "did" : "did not"} ${verb}${negative ? " (the claim says it cannot)" : ""}`;
    if (agrees) {
      matched = true;
      return { outcome: "SUPPORTED", reason: `${verbPhrase}, which matches the claim.`, evidence, matched };
    }
    return { outcome: "CONTRADICTED", reason: `${verbPhrase}, which contradicts the claim.`, evidence, matched: true };
  }

  if (!observed) {
    return {
      outcome: "INCONCLUSIVE",
      reason: "The scenario ran, but nothing in the engine output matched the verbs or cards named in the claim.",
      evidence,
      matched: false
    };
  }
  return { outcome: "INCONCLUSIVE", reason: "No decisive observation.", evidence, matched: false };
}

/** Picks a golden scenario that mentions the cards in the claim. */
function findRelevantScenario(cards: number[]): { id: string; scenario: ScenarioSpec } | null {
  if (cards.length === 0) return null;
  const cases = loadGoldenCases();
  const scored = cases
    .map((c) => {
      const codes = new Set<number>([
        ...(c.scenario.handA || []),
        ...(c.scenario.handB || []),
        ...(c.scenario.deckA || []).slice(0, 12),
        ...(c.scenario.deckB || []).slice(0, 12),
        ...(c.scenario.extraA || []),
        ...(c.scenario.extraB || []),
        ...(c.scenario.decisions || []).map((d) => Number(d.card)).filter(Boolean)
      ]);
      const hits = cards.filter((code) => codes.has(code)).length;
      return { id: c.id, scenario: c.scenario, hits };
    })
    .filter((c) => c.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored[0] || null;
}

export async function verifyRulingClaim(input: {
  claim: string;
  scenario?: ScenarioSpec;
  scenarioId?: string;
}): Promise<ClaimVerification> {
  const cards = await detectCards(input.claim);

  let spec = input.scenario;
  let label = input.scenarioId;

  if (!spec) {
    const golden = findRelevantScenario(cards);
    if (golden) {
      spec = golden.scenario;
      label = golden.id;
    }
  }

  if (!spec) {
    return {
      claim: input.claim,
      outcome: "INCONCLUSIVE",
      confidence: "low",
      reason:
        "No matching scenario is known for the cards in this claim. Pass a 'scenario' (or generate one with ygo_judge_scenario) so the engine can check it.",
      observations: { cards },
      evidence: []
    };
  }

  const result = await runScenario(spec);
  const obs = observe(result);
  const verdict = evaluateClaim(input.claim, cards, obs);

  return {
    claim: input.claim,
    outcome: verdict.outcome,
    confidence: verdict.matched ? "medium" : "low",
    reason: `${verdict.reason} Scenario: ${label || "custom"}.`,
    scenario: label,
    observations: { ...obs, cards },
    evidence: [...verdict.evidence, ...result.expectations.map((e) => `${e.met ? "✓" : "✗"} ${e.expectation} — ${e.evidence}`)]
  };
}
