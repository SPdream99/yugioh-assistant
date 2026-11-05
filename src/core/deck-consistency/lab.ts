/**
 * Deck consistency lab.
 *
 * "Is this deck playable?" is not a question about staples; it is a question
 * about what the opening hand can actually put on the board. This module deals
 * seeded opening hands and runs each one through the real ocgcore engine with a
 * goldfish responder.
 *
 * Two different numbers are reported, because they answer two different
 * questions and used to be conflated:
 *
 *   anyActionRate  — the hand had at least one legal action the goldfish could
 *                    click. This is a *very* low bar: a hand of three set-able
 *                    traps passes it. It is a fail-fast "does the deck function
 *                    at all" check, not a combo metric.
 *   engineBoardRate— the hand actually reached a real board: it Special
 *                    Summoned from the Extra Deck, or it ended with a monster
 *                    on the field. This is the number to quote when someone
 *                    asks "how often does this deck do something meaningful".
 *
 * It is still a measurement, not a prediction: traps, interaction and optimal
 * lines are not modelled. Report it as a lower bound.
 */

import { OcgLocation } from "ocgcore-wasm";
import { runOcgCoreDuel } from "../card-scripts/ocgcore-runtime.js";

/** Hard ceiling: each trial starts a real WebAssembly duel. */
export const MAX_TRIALS = 200;

export interface ConsistencyOptions {
  /** Main Deck passcodes, exactly as they would be dealt. */
  main: number[];
  extra?: number[];
  /** Opponent Main Deck. Defaults to a mirror of `main`. */
  opponentMain?: number[];
  /** Number of opening hands to test (default 15, max 200). */
  trials?: number;
  seed?: number;
  /** Engine steps per trial (default 40). Raise it to see longer combo lines. */
  maxSteps?: number;
}

export interface ConsistencyTrialResult {
  hand: number[];
  summons: number;
  activations: number;
  extraDeckSummons: number;
  fieldMonsters: number;
  /** At least one legal action was taken. */
  anyAction: boolean;
  /** Reached a real board (Extra Deck summon, or a monster left on field). */
  engineBoard: boolean;
}

export interface ConsistencyReport {
  available: boolean;
  /** Trials actually run. */
  trials: number;
  /** Trials requested by the caller (may differ only when refused). */
  requestedTrials: number;

  /** Percentage of hands with at least one legal action (the old "playable"). */
  anyActionRate: number;
  /** Percentage of hands that summoned anything. */
  summonRate: number;
  /** Percentage of hands that Special Summoned from the Extra Deck. */
  extraDeckRate: number;
  /** Percentage of hands that reached a real board (Extra Deck summon or field monster). */
  engineBoardRate: number;

  avgSummons: number;
  avgActivations: number;
  avgExtraDeckSummons: number;
  avgFieldMonsters: number;

  /** @deprecated Use `anyActionRate`; kept so existing callers keep working. */
  playableHands: number;
  /** @deprecated Use `anyActionRate`. */
  playableRate: number;
  /** @deprecated 100 - anyActionRate. */
  brickRate: number;

  openerFrequency: Array<{ code: number; count: number }>;
  sample: ConsistencyTrialResult[];
  reason?: string;
  notes: string[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(input: T[], random: () => number): T[] {
  const array = [...input];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const percent = (numerator: number, denominator: number) =>
  Math.round((numerator / Math.max(denominator, 1)) * 1000) / 10;

export async function measureConsistency(options: ConsistencyOptions): Promise<ConsistencyReport> {
  const main = (options.main || []).filter((c) => Number.isFinite(c) && c > 0);
  const notes = [
    "`anyActionRate` only means the hand had a legal action; it is not a combo rate.",
    "`engineBoardRate` means the hand Special Summoned from the Extra Deck or ended with a monster on the field.",
    "Goldfish measurement: no opponent interaction, first legal action each window — a lower bound, not a win rate."
  ];

  const requestedTrials = options.trials ?? 15;

  if (main.length < 5) {
    return {
      available: false,
      trials: 0,
      requestedTrials,
      anyActionRate: 0,
      summonRate: 0,
      extraDeckRate: 0,
      engineBoardRate: 0,
      avgSummons: 0,
      avgActivations: 0,
      avgExtraDeckSummons: 0,
      avgFieldMonsters: 0,
      playableHands: 0,
      playableRate: 0,
      brickRate: 0,
      openerFrequency: [],
      sample: [],
      reason: "A Main Deck of at least 5 cards is required.",
      notes
    };
  }

  // Refuse an oversized request instead of silently clamping it.
  if (requestedTrials > MAX_TRIALS) {
    return {
      available: false,
      trials: 0,
      requestedTrials,
      anyActionRate: 0,
      summonRate: 0,
      extraDeckRate: 0,
      engineBoardRate: 0,
      avgSummons: 0,
      avgActivations: 0,
      avgExtraDeckSummons: 0,
      avgFieldMonsters: 0,
      playableHands: 0,
      playableRate: 0,
      brickRate: 0,
      openerFrequency: [],
      sample: [],
      reason: `Requested ${requestedTrials} trials, but each trial starts a real engine duel and the cap is ${MAX_TRIALS}. Ask for ${MAX_TRIALS} or fewer, or run several batches with different seeds.`,
      notes
    };
  }

  const trials = Math.max(1, requestedTrials);
  const random = mulberry32(options.seed ?? 12345);
  const opponentMain = (options.opponentMain || main).filter((c) => Number.isFinite(c) && c > 0);
  const openerCounts = new Map<number, number>();

  let anyActionHands = 0;
  let summonHands = 0;
  let extraDeckHands = 0;
  let engineBoardHands = 0;
  let summonTotal = 0;
  let activationTotal = 0;
  let extraDeckTotal = 0;
  let fieldMonsterTotal = 0;
  const sample: ConsistencyTrialResult[] = [];

  for (let trial = 0; trial < trials; trial++) {
    const shuffled = shuffle(main, random);
    const hand = shuffled.slice(0, 5);
    const deck = shuffled.slice(5);

    for (const code of hand) openerCounts.set(code, (openerCounts.get(code) || 0) + 1);

    const result = await runOcgCoreDuel({
      deckA: deck,
      deckB: opponentMain,
      handA: hand,
      extraA: options.extra,
      startingDrawCount: 0,
      drawCountPerTurn: 0,
      maxSteps: options.maxSteps ?? 40,
      seed: [BigInt(trial + 1), 2n, 3n, 5n]
    });

    let summons = 0;
    let activations = 0;
    let extraDeckSummons = 0;
    let fieldIn = 0;
    let fieldOut = 0;

    for (const message of result.messages) {
      const raw: any = message.raw;
      if (message.typeName === "SUMMONING" || message.typeName === "SPSUMMONING") {
        summons += 1;
        if (message.typeName === "SPSUMMONING" && raw?.location === OcgLocation.EXTRA && (raw?.controller ?? 0) === 0) {
          extraDeckSummons += 1;
        }
      }
      if (message.typeName === "CHAINING") activations += 1;
      if (message.typeName === "MOVE") {
        if (raw?.to?.location === OcgLocation.MZONE && (raw?.to?.controller ?? 0) === 0) fieldIn += 1;
        if (raw?.from?.location === OcgLocation.MZONE && (raw?.from?.controller ?? 0) === 0) fieldOut += 1;
      }
    }

    const fieldMonsters = Math.max(0, fieldIn - fieldOut);
    const anyAction = summons > 0 || activations > 0;
    const engineBoard = extraDeckSummons > 0 || fieldMonsters > 0;

    if (anyAction) anyActionHands += 1;
    if (summons > 0) summonHands += 1;
    if (extraDeckSummons > 0) extraDeckHands += 1;
    if (engineBoard) engineBoardHands += 1;
    summonTotal += summons;
    activationTotal += activations;
    extraDeckTotal += extraDeckSummons;
    fieldMonsterTotal += fieldMonsters;

    if (sample.length < 5) {
      sample.push({ hand, summons, activations, extraDeckSummons, fieldMonsters, anyAction, engineBoard });
    }
  }

  return {
    available: true,
    trials,
    requestedTrials,
    anyActionRate: percent(anyActionHands, trials),
    summonRate: percent(summonHands, trials),
    extraDeckRate: percent(extraDeckHands, trials),
    engineBoardRate: percent(engineBoardHands, trials),
    avgSummons: Math.round((summonTotal / trials) * 10) / 10,
    avgActivations: Math.round((activationTotal / trials) * 10) / 10,
    avgExtraDeckSummons: Math.round((extraDeckTotal / trials) * 10) / 10,
    avgFieldMonsters: Math.round((fieldMonsterTotal / trials) * 10) / 10,
    playableHands: anyActionHands,
    playableRate: percent(anyActionHands, trials),
    brickRate: percent(trials - anyActionHands, trials),
    openerFrequency: [...openerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, count]) => ({ code, count })),
    sample,
    notes
  };
}
