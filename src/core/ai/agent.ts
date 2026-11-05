/**
 * AI harness: benchmarking and self-play data export.
 *
 * The engine is deterministic given a seed and a decision sequence, so a match
 * between two policies is reproducible. The benchmark alternates the starting
 * player to remove the first-turn bias from the sample.
 */

import fs from "node:fs";
import path from "node:path";
import { runOcgCoreDuel, defaultResponder } from "../card-scripts/ocgcore-runtime.js";
import { createPolicy, type PolicyOptions } from "./policy.js";
import type { OcgMessage } from "ocgcore-wasm";

export interface AiBenchmarkOptions {
  deckA: number[];
  deckB: number[];
  extraA?: number[];
  extraB?: number[];
  games?: number;
  seed?: number;
  maxSteps?: number;
  /** Starting LP (default 8000; lower values make benchmarks finish faster). */
  startingLP?: number;
  /** Which side plays the policy: "A", "B", or "alternate" (default). */
  aiSide?: "A" | "B" | "alternate";
  policy?: PolicyOptions;
}

export interface AiBenchmarkResult {
  available: boolean;
  games: number;
  aiWins: number;
  baselineWins: number;
  draws: number;
  aiWinRate: number;
  avgSteps: number;
  avgLpRemaining: number;
  sample: Array<{ game: number; aiSide: "A" | "B"; winner?: number; steps: number; lp: [number, number] }>;
  reason?: string;
  notes: string[];
}

function otherSide(side: "A" | "B"): "A" | "B" {
  return side === "A" ? "B" : "A";
}

export async function runAiBenchmark(options: AiBenchmarkOptions): Promise<AiBenchmarkResult> {
  const notes = [
    "The baseline is the engine's default responder (first legal action, pass chains).",
    "The AI is a heuristic policy, not a trained model; use the win rate as a sanity check, not a strength claim.",
    "Games alternate the starting side so first-turn advantage is split evenly."
  ];

  const games = Math.max(1, Math.min(options.games ?? 10, 50));
  const deckA = (options.deckA || []).filter((c) => c > 0);
  const deckB = (options.deckB || []).filter((c) => c > 0);
  if (deckA.length === 0 || deckB.length === 0) {
    return {
      available: false,
      games: 0,
      aiWins: 0,
      baselineWins: 0,
      draws: 0,
      aiWinRate: 0,
      avgSteps: 0,
      avgLpRemaining: 0,
      sample: [],
      reason: "Both decks are required.",
      notes
    };
  }

  const sample: AiBenchmarkResult["sample"] = [];
  let aiWins = 0;
  let baselineWins = 0;
  let draws = 0;
  let totalSteps = 0;
  let totalLp = 0;

  for (let game = 0; game < games; game++) {
    const aiSide: "A" | "B" = options.aiSide === "A" || options.aiSide === "B"
      ? options.aiSide
      : (game % 2 === 0 ? "A" : "B");

    const policy = createPolicy({ ...options.policy, seed: (options.seed ?? 1) + game * 37 });

    const result = await runOcgCoreDuel({
      deckA,
      deckB,
      extraA: options.extraA,
      extraB: options.extraB,
      startingDrawCount: 5,
      drawCountPerTurn: 1,
      startingLP: options.startingLP ?? 8000,
      maxSteps: options.maxSteps ?? 120,
      seed: [BigInt((options.seed ?? 1) + game), 2n, 3n, 5n],
      responder: (message: OcgMessage) => {
        const player = (message as any).player;
        const isAi = (player === 0 && aiSide === "A") || (player === 1 && aiSide === "B");
        if (isAi) return policy.respond(message);
        return defaultResponder(message);
      }
    });

    const lp: [number, number] = [options.startingLP ?? 8000, options.startingLP ?? 8000];
    for (const message of result.messages) {
      const raw = message.raw as any;
      const player = Number(raw?.player);
      if (player !== 0 && player !== 1) continue;
      if (message.type === 91 /* DAMAGE */ || message.type === 100 /* PAY_LPCOST */) {
        lp[player] -= Number(raw.amount) || 0;
      } else if (message.type === 92 /* RECOVER */) {
        lp[player] += Number(raw.amount) || 0;
      }
    }

    const aiPlayer = aiSide === "A" ? 0 : 1;
    if (result.winner === undefined) draws += 1;
    else if (result.winner === aiPlayer) aiWins += 1;
    else baselineWins += 1;

    totalSteps += result.steps;
    totalLp += lp[aiPlayer];

    sample.push({ game: game + 1, aiSide, winner: result.winner, steps: result.steps, lp });
  }

  const decided = aiWins + baselineWins;
  return {
    available: true,
    games,
    aiWins,
    baselineWins,
    draws,
    aiWinRate: decided > 0 ? Math.round((aiWins / decided) * 1000) / 10 : 0,
    avgSteps: Math.round(totalSteps / games),
    avgLpRemaining: Math.round(totalLp / games),
    sample,
    notes
  };
}

// ---------------------------------------------------------------------------
// Self-play export
// ---------------------------------------------------------------------------

export interface SelfPlayOptions {
  deckA: number[];
  deckB: number[];
  extraA?: number[];
  extraB?: number[];
  games?: number;
  seed?: number;
  maxSteps?: number;
  startingLP?: number;
  policy?: PolicyOptions;
  outPath?: string;
}

export interface SelfPlayResult {
  available: boolean;
  games: number;
  decisions: number;
  outputPath?: string;
  bytes?: number;
  reason?: string;
  notes: string[];
}

/**
 * Plays policy-vs-policy games and writes one JSONL record per decision.
 * The record is the minimum needed for imitation learning: the request type,
 * the legal options, and the action the policy took.
 */
export async function exportSelfPlay(options: SelfPlayOptions): Promise<SelfPlayResult> {
  const games = Math.max(1, Math.min(options.games ?? 5, 50));
  const deckA = (options.deckA || []).filter((c) => c > 0);
  const deckB = (options.deckB || []).filter((c) => c > 0);
  const notes = [
    "Each line is one decision: request type, legal option codes, chosen index.",
    "Use it for behavioural cloning first, then reinforcement learning with the engine as the environment."
  ];

  if (deckA.length === 0 || deckB.length === 0) {
    return { available: false, games: 0, decisions: 0, reason: "Both decks are required.", notes };
  }

  const outPath = path.resolve(options.outPath || path.join(process.cwd(), "data", "ai", `selfplay_${Date.now()}.jsonl`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let decisions = 0;
  const lines: string[] = [];

  for (let game = 0; game < games; game++) {
    const policyA = createPolicy({ ...options.policy, seed: (options.seed ?? 1) + game * 11 });
    const policyB = createPolicy({ ...options.policy, seed: (options.seed ?? 1000) + game * 13 });

    const result = await runOcgCoreDuel({
      deckA,
      deckB,
      extraA: options.extraA,
      extraB: options.extraB,
      startingDrawCount: 5,
      drawCountPerTurn: 1,
      startingLP: options.startingLP ?? 8000,
      maxSteps: options.maxSteps ?? 120,
      seed: [BigInt((options.seed ?? 1) + game), 7n, 11n, 13n],
      responder: (message: OcgMessage) => {
        const player = (message as any).player === 1 ? 1 : 0;
        const policy = player === 0 ? policyA : policyB;
        const response = policy.respond(message);
        const options = (message as any).selects || (message as any).activates || (message as any).summons || (message as any).special_summons || [];
        lines.push(JSON.stringify({
          game: game + 1,
          player,
          type: (message as any).type,
          optionCount: Array.isArray(options) ? options.length : 0,
          options: Array.isArray(options) ? options.map((o: any) => Number(o?.code) || 0).slice(0, 20) : [],
          chosen: response?.index ?? response?.indicies ?? null,
          response: response?.type ?? null
        }));
        decisions += 1;
        return response;
      }
    });

    lines.push(JSON.stringify({
      game: game + 1,
      result: { winner: result.winner ?? null, steps: result.steps }
    }));
  }

  const payload = `${lines.join("\n")}\n`;
  fs.writeFileSync(outPath, payload, "utf-8");

  return {
    available: true,
    games,
    decisions,
    outputPath: outPath,
    bytes: Buffer.byteLength(payload),
    notes
  };
}

export { otherSide };
