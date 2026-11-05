/**
 * Scripted duel scenarios executed by the real EDOPro core (ocgcore-wasm).
 *
 * The point is not to "simulate" a chain in prose: it is to make the engine
 * resolve it and then report what actually happened. A scenario declares:
 *   - the exact hands / decks / Extra Decks,
 *   - the scripted decisions each player makes (activate this card, chain that
 *     card, pick these materials),
 *   - what the judge expects to happen.
 *
 * After the engine finishes, every expectation is checked against the engine's
 * own messages, so the verdict is evidence, not opinion.
 */

import { runOcgCoreDuel, type OcgDuelResult, type RuntimeMessage } from "./ocgcore-runtime.js";
import { OcgMessageType, OcgResponseType, SelectBattleCMDAction, SelectIdleCMDAction, OcgPosition, OcgLocation } from "ocgcore-wasm";
import type { OcgMessage, OcgResponse } from "ocgcore-wasm";

export type DecisionKind = "idle" | "chain" | "card" | "effectyn" | "yesno" | "yes" | "option" | "position" | "tribute" | "battle";

export interface ScenarioDecision {
  /** Which request this answers. */
  on: DecisionKind;
  /** 0 = Player A, 1 = Player B. Omit to answer the first matching request from either side. */
  player?: 0 | 1;
  /** For `idle`: what to do. */
  action?: "activate" | "summon" | "spsummon" | "set_monster" | "set_spell" | "to_bp" | "to_ep";
  /** Card to pick (passcode). Used by idle/chain/card. */
  card?: number;
  /** For `chain`: pass instead of chaining. */
  pass?: boolean;
  /** For `card`: passcodes to select (in order). */
  cards?: number[];
  /** For `card`: how many to select. Defaults to the request's minimum. */
  count?: number;
  /** For yes/no prompts. */
  yes?: boolean;
  /** For option prompts. */
  index?: number;
  /** Human label shown in the transcript. */
  label?: string;
}

export type Expectation =
  | { kind: "chainLink"; card: number; link: number; label?: string }
  | { kind: "chainSolved"; card: number; label?: string }
  | { kind: "negated"; card: number; label?: string }
  | { kind: "summoned"; card: number; label?: string }
  | { kind: "notSummoned"; card: number; label?: string }
  | { kind: "toGrave"; card: number; label?: string }
  | { kind: "banished"; card: number; label?: string }
  | { kind: "activated"; card: number; times?: number; label?: string }
  | { kind: "lp"; player: 0 | 1; atMost?: number; atLeast?: number; label?: string }
  | {
      kind: "size";
      player: 0 | 1;
      zone: "hand" | "grave" | "banished" | "deck" | "extra";
      equals?: number;
      atLeast?: number;
      atMost?: number;
      label?: string;
    };

export interface ScenarioSpec {
  name: string;
  description?: string;
  handA: number[];
  handB: number[];
  deckA?: number[];
  deckB?: number[];
  extraA?: number[];
  extraB?: number[];
  startingLP?: number;
  maxSteps?: number;
  /** Accept optional effects and yes/no prompts that are not scripted (default false). */
  autoAcceptOptional?: boolean;
  decisions: ScenarioDecision[];
  expect: Expectation[];
}

export interface ExpectationResult {
  expectation: string;
  met: boolean;
  evidence: string;
}

export interface ScenarioChainLink {
  link: number;
  code: number;
  controller: number;
  description?: string;
  step: number;
  negated?: boolean;
  solved?: boolean;
}

export interface ScenarioResult {
  runtime: "ocgcore-wasm";
  name: string;
  description?: string;
  legal: boolean;
  verdict: "CONFIRMED" | "REFUTED" | "INCONCLUSIVE";
  conclusion: string;
  chain: ScenarioChainLink[];
  timeline: string[];
  transcript: string[];
  expectations: ExpectationResult[];
  field: {
    lp: [number, number];
    playerA: {
      monsters: number;
      monsterPositions: number[];
      spells: number;
      hand: number;
      deck: number;
      grave: number;
      banished: number;
      extra: number;
    };
    playerB: {
      monsters: number;
      monsterPositions: number[];
      spells: number;
      hand: number;
      deck: number;
      grave: number;
      banished: number;
      extra: number;
    };
  };
  engineErrors: string[];
  steps: number;
  luaScripts: string[];
}

const LOCATION_NAMES: Record<number, string> = {
  1: "DECK",
  2: "HAND",
  4: "MZONE",
  8: "SZONE",
  16: "GRAVE",
  32: "BANISHED",
  64: "EXTRA",
  128: "OVERLAY"
};

const CARD_NAMES: Record<number, string> = {
  14558127: "Ash Blossom & Joyous Spring",
  24224830: "Called by the Grave",
  44362883: "Branded Fusion",
  44146295: "Mirrorjade the Iceblade Dragon",
  87746184: "Albion the Branded Dragon",
  68468459: "Fallen of Albaz",
  97268402: "Effect Veiler",
  84211599: "Pot of Prosperity",
  55144522: "Pot of Greed",
  89631139: "Blue-Eyes White Dragon",
  46986420: "Dark Magician"
};

export function cardLabel(code: number): string {
  return CARD_NAMES[code] ? `${CARD_NAMES[code]} (${code})` : String(code);
}

/** Message types that are actual decisions (everything else is a notification). */
const REQUEST_TYPES = new Set<number>([
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_BATTLECMD,
  OcgMessageType.SELECT_EFFECTYN,
  OcgMessageType.SELECT_YESNO,
  OcgMessageType.SELECT_OPTION,
  OcgMessageType.SELECT_CARD,
  OcgMessageType.SELECT_CHAIN,
  OcgMessageType.SELECT_POSITION,
  OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_TRIBUTE,
  OcgMessageType.SELECT_UNSELECT_CARD,
  OcgMessageType.SORT_CARD,
  OcgMessageType.SELECT_SUM,
  OcgMessageType.SELECT_COUNTER,
  OcgMessageType.SELECT_DISFIELD
]);

function isRequest(message: OcgMessage): boolean {
  return REQUEST_TYPES.has(message.type);
}

interface ScriptState {
  decisions: ScenarioDecision[];
  used: Set<number>;
  transcript: string[];
  messages: RuntimeMessage[];
  /** decision index → how many of its cards have already been handed to the engine */
  cardProgress: Map<number, number>;
}

function takeDecision(state: ScriptState, kind: DecisionKind, player: number): { decision: ScenarioDecision; index: number } | null {
  for (let i = 0; i < state.decisions.length; i++) {
    if (state.used.has(i)) continue;
    const d = state.decisions[i];
    if (d.on !== kind) continue;
    if (typeof d.player === "number" && d.player !== player) continue;
    state.used.add(i);
    return { decision: d, index: i };
  }
  return null;
}

/**
 * Picks the next decision of this kind whose card actually appears in the
 * request, so a decision is never wasted on an unrelated prompt.
 */
function takeMatchingDecision(
  state: ScriptState,
  kind: DecisionKind,
  player: number,
  selects: any[] | undefined
): { decision: ScenarioDecision; index: number } | null {
  for (let i = 0; i < state.decisions.length; i++) {
    if (state.used.has(i)) continue;
    const d = state.decisions[i];
    if (d.on !== kind) continue;
    if (typeof d.player === "number" && d.player !== player) continue;

    const wanted = d.cards?.length ? d.cards : d.card ? [d.card] : [];
    if (wanted.length > 0 && !wanted.some((code) => findCardIndex(selects, code) >= 0)) continue;

    state.used.add(i);
    return { decision: d, index: i };
  }
  return null;
}

function findCardIndex(list: any[] | undefined, code: number | undefined): number {
  if (!Array.isArray(list) || !code) return -1;
  return list.findIndex((entry) => Number(entry?.code) === code);
}

/**
 * Builds an ocgcore responder from the scenario's scripted decisions.
 * Anything not scripted falls back to the safe legal default (pass / end phase).
 */
function makeScriptedResponder(spec: ScenarioSpec) {
  const state: ScriptState = { decisions: spec.decisions, used: new Set(), transcript: [], messages: [], cardProgress: new Map() };

  const respond = (message: OcgMessage): OcgResponse | null => {
    const msg = message as any;
    const player = typeof msg.player === "number" ? msg.player : 0;

    switch (message.type) {
      case OcgMessageType.SELECT_IDLECMD: {
        const scripted = takeDecision(state, "idle", player);
        if (scripted) {
          const { decision } = scripted;
          const pick = decision.action || "activate";

          if (pick === "activate") {
            const index = findCardIndex(msg.activates, decision.card);
            if (index >= 0) {
              state.transcript.push(`P${player + 1}: activate ${cardLabel(decision.card!)} → CL1`);
              return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index };
            }
          }
          if (pick === "summon") {
            const index = findCardIndex(msg.summons, decision.card);
            if (index >= 0) {
              state.transcript.push(`P${player + 1}: Normal Summon ${cardLabel(decision.card!)}`);
              return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index };
            }
          }
          if (pick === "spsummon") {
            const index = findCardIndex(msg.special_summons, decision.card);
            if (index >= 0) {
              state.transcript.push(`P${player + 1}: Special Summon ${cardLabel(decision.card!)}`);
              return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index };
            }
          }
          if (pick === "set_monster") {
            const index = findCardIndex(msg.monster_sets, decision.card);
            if (index >= 0) {
              return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index };
            }
          }
          if (pick === "set_spell") {
            const index = findCardIndex(msg.spell_sets, decision.card);
            if (index >= 0) {
              return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPELL_SET, index };
            }
          }
          if (pick === "to_bp" && msg.to_bp) {
            return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
          }
          state.transcript.push(`P${player + 1}: (scripted action unavailable: ${pick} ${decision.card ?? ""})`);
        }
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
      }

      case OcgMessageType.SELECT_CHAIN: {
        const scripted = takeMatchingDecision(state, "chain", player, msg.selects);
        if (scripted) {
          const { decision } = scripted;
          if (decision.pass || !decision.card) {
            state.transcript.push(`P${player + 1}: pass (no chain)`);
            return { type: OcgResponseType.SELECT_CHAIN, index: null };
          }
          const index = findCardIndex(msg.selects, decision.card);
          if (index >= 0) {
            const entry = msg.selects[index];
            const nextLink = (state.messages.filter((m) => m.typeName === "CHAINING").length || 0) + 1;
            state.transcript.push(`P${player + 1}: chain ${cardLabel(decision.card)} → CL${nextLink}`);
            return { type: OcgResponseType.SELECT_CHAIN, index };
          }
          state.transcript.push(`P${player + 1}: (chain not available: ${cardLabel(decision.card)})`);
        }
        return { type: OcgResponseType.SELECT_CHAIN, index: null };
      }

      case OcgMessageType.SELECT_CARD: {
        const min = Math.max(Number(msg.min) || 1, 1);
        const selects = (msg.selects || []) as any[];

        // Prefer a card decision that still has unused cards present in this prompt.
        let chosen: { index: number; codes: number[] } | null = null;
        for (let i = 0; i < state.decisions.length; i++) {
          if (state.used.has(i)) continue;
          const d = state.decisions[i];
          if (d.on !== "card") continue;
          if (typeof d.player === "number" && d.player !== player) continue;

          const wanted = d.cards?.length ? d.cards : d.card ? [d.card] : [];
          const progress = state.cardProgress.get(i) || 0;
          const remaining = wanted.slice(progress).filter((code) => findCardIndex(selects, code) >= 0);
          if (remaining.length === 0) continue;

          const indices = remaining.slice(0, Math.max(min, 1)).map((code) => findCardIndex(selects, code));
          state.cardProgress.set(i, progress + indices.length);
          if (progress + indices.length >= wanted.length) state.used.add(i);

          chosen = { index: i, codes: indices };
          break;
        }

        if (chosen) {
          const d = state.decisions[chosen.index];
          const labels = chosen.codes.map((idx) => selects[idx]?.code).filter(Boolean);
          state.transcript.push(`P${player + 1}: select ${labels.map((c: any) => cardLabel(Number(c))).join(", ")}`);
          return { type: OcgResponseType.SELECT_CARD, indicies: chosen.codes } as any;
        }

        if (msg.can_cancel && (Number(msg.min) || 0) === 0) {
          return { type: OcgResponseType.SELECT_CARD, indicies: null } as any;
        }
        const all = Array.from({ length: Math.min(min, selects.length) }, (_, i) => i);
        return { type: OcgResponseType.SELECT_CARD, indicies: all } as any;
      }

      case OcgMessageType.SELECT_EFFECTYN: {
        const scripted = takeDecision(state, "effectyn", player) ?? takeDecision(state, "yes", player);
        const yes = scripted ? Boolean(scripted.decision.yes) : spec.autoAcceptOptional === true;
        state.transcript.push(`P${player + 1}: ${yes ? "activate" : "decline"} optional effect`);
        return { type: OcgResponseType.SELECT_EFFECTYN, yes };
      }

      case OcgMessageType.SELECT_YESNO: {
        const scripted = takeDecision(state, "yesno", player) ?? takeDecision(state, "yes", player);
        const yes = scripted ? Boolean(scripted.decision.yes) : spec.autoAcceptOptional === true;
        state.transcript.push(`P${player + 1}: ${yes ? "yes" : "no"} to prompt`);
        return { type: OcgResponseType.SELECT_YESNO, yes };
      }

      case OcgMessageType.SELECT_OPTION: {
        const scripted = takeDecision(state, "option", player);
        return { type: OcgResponseType.SELECT_OPTION, index: scripted?.decision.index ?? 0 };
      }

      case OcgMessageType.SELECT_POSITION: {
        const scripted = takeDecision(state, "position", player);
        const positions = Number(msg.positions) || 0;
        const wanted = scripted?.decision.index;
        if (typeof wanted === "number") return { type: OcgResponseType.SELECT_POSITION, position: wanted as any };
        if (positions & OcgPosition.FACEUP_ATTACK) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_ATTACK };
        if (positions & OcgPosition.FACEUP_DEFENSE) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_DEFENSE };
        return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEDOWN_DEFENSE };
      }

      case OcgMessageType.SELECT_PLACE:
      case OcgMessageType.SELECT_DISFIELD:
        // Let the runtime pick the place (it rotates candidates on RETRY).
        return null;

      case OcgMessageType.SELECT_TRIBUTE: {
        const scripted = takeDecision(state, "tribute", player);
        if (scripted) {
          const wanted = scripted.decision.cards || (scripted.decision.card ? [scripted.decision.card] : []);
          const indices = wanted.map((code) => findCardIndex(msg.selects, code)).filter((i) => i >= 0);
          if (indices.length) {
            return { type: OcgResponseType.SELECT_TRIBUTE, indicies: indices } as any;
          }
        }
        const count = Math.max(Number(msg.min) || 1, 1);
        const all = Array.from({ length: Math.min(count, (msg.selects || []).length) }, (_, i) => i);
        return { type: OcgResponseType.SELECT_TRIBUTE, indicies: all } as any;
      }

      case OcgMessageType.SELECT_BATTLECMD: {
        const scripted = takeDecision(state, "battle", player);
        const attacks: any[] = msg.attacks || [];
        if (scripted && attacks.length > 0) {
          const index = scripted.decision.card ? findCardIndex(attacks, scripted.decision.card) : 0;
          if (index >= 0) {
            state.transcript.push(`P${player + 1}: attack${scripted.decision.card ? ` with ${cardLabel(scripted.decision.card)}` : ""}`);
            return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index };
          }
        }
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
      }

      case OcgMessageType.SELECT_UNSELECT_CARD: {
        const selected = (msg.unselect_cards || []).length;
        const min = Number(msg.min) || 0;
        if (msg.can_finish && selected >= min) {
          return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null } as any;
        }
        const selectable = (msg.select_cards || []).length;
        if (selectable > 0) {
          return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 } as any;
        }
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null } as any;
      }

      case OcgMessageType.SORT_CARD:
        return { type: OcgResponseType.SORT_CARD, order: null } as any;

      default:
        return null;
    }
  };

  return { respond, state };
}

// ---------------------------------------------------------------------------
// Post-run analysis
// ---------------------------------------------------------------------------

function buildChain(result: OcgDuelResult): ScenarioChainLink[] {
  const links: ScenarioChainLink[] = [];
  const byLink = new Map<number, ScenarioChainLink>();

  for (const message of result.messages) {
    const raw = message.raw as any;
    if (message.type === OcgMessageType.CHAINING) {
      const link: ScenarioChainLink = {
        link: Number(raw.chain_size) || links.length + 1,
        code: Number(raw.code) || 0,
        controller: Number(raw.controller) || 0,
        description: raw.description !== undefined ? String(raw.description) : undefined,
        step: message.step
      };
      links.push(link);
      byLink.set(link.link, link);
    }
    if (message.type === OcgMessageType.CHAIN_SOLVED) {
      const link = byLink.get(Number(raw.chain_size));
      if (link) link.solved = true;
    }
    if (message.type === OcgMessageType.CHAIN_NEGATED) {
      const link = byLink.get(Number(raw.chain_size));
      if (link) link.negated = true;
    }
  }
  return links;
}

function evaluateExpectation(
  expectation: Expectation,
  result: OcgDuelResult,
  chain: ScenarioChainLink[],
  finalLp: [number, number],
  sizes: Array<{ hand: number; grave: number; banished: number; deck: number; extra: number }>
): ExpectationResult {
  const describe = (e: Expectation): string => {
    if (e.label) return e.label;
    switch (e.kind) {
      case "chainLink": return `${cardLabel(e.card)} is Chain Link ${e.link}`;
      case "chainSolved": return `${cardLabel(e.card)} resolves`;
      case "negated": return `${cardLabel(e.card)} is negated`;
      case "summoned": return `${cardLabel(e.card)} is Summoned`;
      case "notSummoned": return `${cardLabel(e.card)} is NOT Summoned`;
      case "toGrave": return `${cardLabel(e.card)} goes to the GY`;
      case "banished": return `${cardLabel(e.card)} is banished`;
      case "activated": return `${cardLabel(e.card)} is activated ${e.times ?? 1} time(s)`;
      case "lp": return `Player ${e.player === 0 ? "A" : "B"} LP within the required range`;
      case "size": return `${e.zone} of Player ${e.player === 0 ? "A" : "B"} = ${e.equals ?? `${e.atLeast ?? ""}-${e.atMost ?? ""}`}`;
    }
  };

  const moves = result.messages.filter((m) => m.type === OcgMessageType.MOVE);
  const summed = result.messages.filter((m) => m.type === OcgMessageType.SUMMONING || m.type === OcgMessageType.SPSUMMONING);
  const activated = result.messages.filter((m) => m.type === OcgMessageType.CHAINING);

  switch (expectation.kind) {
    case "chainLink": {
      const hit = chain.find((l) => l.code === expectation.card && l.link === expectation.link);
      const actual = chain.find((l) => l.code === expectation.card);
      return {
        expectation: describe(expectation),
        met: Boolean(hit),
        evidence: hit
          ? `Engine: CHAINING at step ${hit.step}, chain_size=${hit.link}, code=${hit.code}`
          : actual
            ? `Engine: ${cardLabel(expectation.card)} was CL${actual.link}, not CL${expectation.link}`
            : `Engine: no CHAINING for ${cardLabel(expectation.card)}`
      };
    }
    case "chainSolved": {
      const hit = chain.find((l) => l.code === expectation.card && l.solved && !l.negated);
      return {
        expectation: describe(expectation),
        met: Boolean(hit),
        evidence: hit ? `Engine: CHAIN_SOLVED chain_link=${hit.link} (code ${hit.code})` : `Engine: no CHAIN_SOLVED for ${cardLabel(expectation.card)}`
      };
    }
    case "negated": {
      const hit = chain.find((l) => l.code === expectation.card && l.negated);
      return {
        expectation: describe(expectation),
        met: Boolean(hit),
        evidence: hit ? `Engine: CHAIN_NEGATED chain_link=${hit.link} (code ${hit.code})` : `Engine: no CHAIN_NEGATED for ${cardLabel(expectation.card)}`
      };
    }
    case "summoned": {
      const hit = summed.find((m) => Number((m.raw as any).code) === expectation.card);
      return {
        expectation: describe(expectation),
        met: Boolean(hit),
        evidence: hit ? `Engine: ${hit.typeName} code=${expectation.card} at step ${hit.step}` : `Engine: no SUMMONING/SPSUMMONING for ${cardLabel(expectation.card)}`
      };
    }
    case "notSummoned": {
      const hit = summed.find((m) => Number((m.raw as any).code) === expectation.card);
      return {
        expectation: describe(expectation),
        met: !hit,
        evidence: hit ? `Engine: still saw ${hit.typeName} code=${expectation.card}` : `Engine: no Summon message for ${cardLabel(expectation.card)}`
      };
    }
    case "toGrave": {
      const hit = moves.find((m) => Number((m.raw as any).card) === expectation.card && Number((m.raw as any).to?.location) === OcgLocation.GRAVE);
      return {
        expectation: describe(expectation),
        met: Boolean(hit),
        evidence: hit ? `Engine: MOVE code=${expectation.card} → GRAVE at step ${hit.step}` : `Engine: ${cardLabel(expectation.card)} did not go to the GY`
      };
    }
    case "banished": {
      const hit = moves.find((m) => Number((m.raw as any).card) === expectation.card && Number((m.raw as any).to?.location) === OcgLocation.REMOVED);
      return {
        expectation: describe(expectation),
        met: Boolean(hit),
        evidence: hit ? `Engine: MOVE code=${expectation.card} → BANISHED at step ${hit.step}` : `Engine: ${cardLabel(expectation.card)} was not banished`
      };
    }
    case "activated": {
      const count = activated.filter((m) => Number((m.raw as any).code) === expectation.card).length;
      const wanted = expectation.times ?? 1;
      return {
        expectation: describe(expectation),
        met: count === wanted,
        evidence: `Engine: ${count} CHAINING for ${cardLabel(expectation.card)} (expected ${wanted})`
      };
    }
    case "lp": {
      const lp = finalLp[expectation.player];
      const ok = (expectation.atMost === undefined || lp <= expectation.atMost) && (expectation.atLeast === undefined || lp >= expectation.atLeast);
      return {
        expectation: describe(expectation),
        met: ok,
        evidence: `Engine: LP Player ${expectation.player === 0 ? "A" : "B"} = ${lp}`
      };
    }
    case "size": {
      const zone = sizes[expectation.player]?.[expectation.zone] ?? -1;
      const ok =
        (expectation.equals === undefined || zone === expectation.equals) &&
        (expectation.atLeast === undefined || zone >= expectation.atLeast) &&
        (expectation.atMost === undefined || zone <= expectation.atMost);
      return {
        expectation: describe(expectation),
        met: ok,
        evidence: `Engine: ${expectation.zone} Player ${expectation.player === 0 ? "A" : "B"} = ${zone}`
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const FILLER = 46986420; // Dark Magician, used to pad decks

export async function runScenario(spec: ScenarioSpec): Promise<ScenarioResult> {
  const deckA = spec.deckA ?? Array(20).fill(FILLER);
  const deckB = spec.deckB ?? Array(20).fill(FILLER);

  const { respond, state } = makeScriptedResponder(spec);

  const result = await runOcgCoreDuel({
    deckA,
    deckB,
    handA: spec.handA,
    handB: spec.handB,
    extraA: spec.extraA,
    extraB: spec.extraB,
    startingLP: spec.startingLP,
    maxSteps: spec.maxSteps ?? 200,
    startingDrawCount: 0,
    drawCountPerTurn: 0,
    seed: [7n, 11n, 13n, 17n],
    responder: (message) => respond(message)
  });

  const chain = buildChain(result);

  // LP is not part of the field snapshot, so reconstruct it from LPUPDATE.
  const finalLp: [number, number] = [spec.startingLP ?? 8000, spec.startingLP ?? 8000];
  for (const message of result.messages) {
    if (message.type !== OcgMessageType.LPUPDATE) continue;
    const raw = message.raw as any;
    const player = Number(raw.player);
    if (player === 0 || player === 1) finalLp[player] = Number(raw.lp);
  }

  const finalField = (result.finalField as any)?.players || [];

  const summarise = (playerIndex: number) => {
    const player = finalField[playerIndex] || {};
    const monsterSlots = (player.monsters || []).filter((m: any) => m && Number(m.position) !== 0);
    const spellSlots = (player.spells || []).filter((s: any) => s && Number(s.position) !== 0);
    return {
      monsters: monsterSlots.length,
      monsterPositions: monsterSlots.map((m: any) => Number(m.position)),
      spells: spellSlots.length,
      hand: Number(player.hand_size ?? 0),
      deck: Number(player.deck_size ?? 0),
      grave: Number(player.grave_size ?? 0),
      banished: Number(player.banish_size ?? 0),
      extra: Number(player.extra_size ?? 0)
    };
  };

  const sizes = [summarise(0), summarise(1)];

  const expectations = spec.expect.map((e) => evaluateExpectation(e, result, chain, finalLp, sizes));
  const met = expectations.filter((e) => e.met).length;
  const engineErrors = result.errors.filter((e) => !/WAITING (but no request message was found|nhưng không tìm thấy request)/.test(e));

  let verdict: ScenarioResult["verdict"];
  if (expectations.length === 0) verdict = "INCONCLUSIVE";
  else if (met === expectations.length) verdict = "CONFIRMED";
  else if (met === 0) verdict = "REFUTED";
  else verdict = "INCONCLUSIVE";

  const conclusion = buildConclusion(spec, verdict, expectations, chain, engineErrors);

  return {
    runtime: "ocgcore-wasm",
    name: spec.name,
    description: spec.description,
    legal: engineErrors.length === 0,
    verdict,
    conclusion,
    chain,
    timeline: result.timeline,
    transcript: state.transcript,
    expectations,
    field: { lp: finalLp, playerA: summarise(0), playerB: summarise(1) },
    engineErrors,
    steps: result.steps,
    luaScripts: result.luaScriptNames
  };
}

function buildConclusion(
  spec: ScenarioSpec,
  verdict: ScenarioResult["verdict"],
  expectations: ExpectationResult[],
  chain: ScenarioChainLink[],
  engineErrors: string[]
): string {
  const lines: string[] = [];
  const chainText = chain.length
    ? chain.map((l) => `CL${l.link}: ${cardLabel(l.code)}${l.negated ? " (negated)" : l.solved ? " (resolved)" : ""}`).join(" → ")
    : "No chain was created.";

  lines.push(`ocgcore-wasm ran "${spec.name}".`);
  lines.push(`Actual chain: ${chainText}`);
  if (verdict === "CONFIRMED") {
    lines.push(`All ${expectations.length} judge expectations were confirmed by the engine.`);
  } else if (verdict === "REFUTED") {
    lines.push(`No expectation matched the engine result — the initial conclusion was wrong.`);
  } else {
    const failed = expectations.filter((e) => !e.met);
    lines.push(`${failed.length}/${expectations.length} expectations did not match: ${failed.map((f) => f.expectation).join("; ")}.`);
  }
  if (engineErrors.length) lines.push(`Engine warnings: ${engineErrors.slice(0, 3).join(" | ")}`);

  return lines.join("\n");
}
