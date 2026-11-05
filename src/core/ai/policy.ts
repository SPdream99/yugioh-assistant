/**
 * Heuristic duel policy.
 *
 * This is not a learned model and not "optimal play": it is a deterministic
 * scoring policy on top of the legal options ocgcore offers, with seeded jitter
 * so self-play produces varied games. It exists to give the simulator a real
 * opponent and to generate training data.
 *
 * The policy only sees what a player sees at that request: the legal options,
 * the zone, and the card codes. It never reads hidden information.
 */

import { OcgMessageType, OcgResponseType, OcgPosition, OcgLocation, SelectBattleCMDAction, SelectIdleCMDAction } from "ocgcore-wasm";

export interface PolicyStats {
  decisions: number;
  activations: number;
  summons: number;
  chains: number;
  attacks: number;
  passes: number;
}

export interface PolicyOptions {
  seed?: number;
  /** 0 = always the top-scored option, 1 = fully random among legal options. */
  exploration?: number;
  /** Chain at most this many links before passing. */
  maxChainDepth?: number;
}

/** Common hand traps / disruption that should be chained when offered. */
const DISRUPTION_CODES = new Set([
  14558127, // Ash Blossom
  23434538, // Maxx "C"
  94145021, // Droll & Lock Bird
  97268402, // Effect Veiler
  10045474, // Infinite Impermanence (hand use)
  24224830, // Called by the Grave
  73642296, // Nibiru
  65681983, // Ghost Belle
  59438930, // Ghost Ogre
  62015408, // Dimension Shifter
  52038441 // Mulcharmy Fuwalos
]);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Candidate {
  index: number;
  score: number;
}

function pick(candidates: Candidate[], random: () => number, exploration: number): number | null {
  if (candidates.length === 0) return null;
  if (exploration > 0 && random() < exploration) {
    return candidates[Math.floor(random() * candidates.length)].index;
  }
  return candidates.sort((a, b) => b.score - a.score)[0].index;
}

function atkOf(entry: any): number {
  // Requests do not carry stats; use code-based ordering as a stable tie-breaker.
  return Number(entry?.code) || 0;
}

export function createPolicy(options: PolicyOptions = {}) {
  const random = mulberry32(options.seed ?? 1);
  const exploration = Math.max(0, Math.min(options.exploration ?? 0.1, 1));
  const maxChainDepth = options.maxChainDepth ?? 3;
  const stats: PolicyStats = { decisions: 0, activations: 0, summons: 0, chains: 0, attacks: 0, passes: 0 };
  let chainDepth = 0;
  const summonedByPlayer = new Set<number>();
  let pendingZone: "MZONE" | "SZONE" = "MZONE";

  const respond = (message: any): any => {
    stats.decisions += 1;
    const player = typeof message.player === "number" ? message.player : 0;

    switch (message.type) {
      case OcgMessageType.SELECT_PLACE: {
        const location = pendingZone === "SZONE" ? OcgLocation.SZONE : OcgLocation.MZONE;
        return { type: OcgResponseType.SELECT_PLACE, places: [{ player, location, sequence: 0 }] } as any;
      }
      case OcgMessageType.SELECT_IDLECMD: {
        const acts: any[] = message.activates || [];
        const sp: any[] = message.special_summons || [];
        const summons: any[] = message.summons || [];
        const spellSets: any[] = message.spell_sets || [];
        const monsterSets: any[] = message.monster_sets || [];

        if (acts.length) {
          stats.activations += 1;
          pendingZone = "SZONE";
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: pick(acts.map((a: any, i: number) => ({ index: i, score: 100 - i })), random, exploration) };
        }
        if (sp.length) {
          stats.summons += 1;
          summonedByPlayer.add(player);
          pendingZone = "MZONE";
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index: pick(sp.map((a: any, i: number) => ({ index: i, score: 90 - i })), random, exploration) };
        }
        if (summons.length) {
          stats.summons += 1;
          summonedByPlayer.add(player);
          pendingZone = "MZONE";
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: pick(summons.map((a: any, i: number) => ({ index: i, score: 80 - i })), random, exploration) };
        }
        if (spellSets.length) {
          pendingZone = "SZONE";
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPELL_SET, index: pick(spellSets.map((a: any, i: number) => ({ index: i, score: 60 - i })), random, exploration) };
        }
        if (monsterSets.length) {
          pendingZone = "MZONE";
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: pick(monsterSets.map((a: any, i: number) => ({ index: i, score: 40 - i })), random, exploration) };
        }

        stats.passes += 1;
        // Move to the Battle Phase when this player has a monster, so games can end.
        if (message.to_bp && summonedByPlayer.has(player)) {
          return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
        }
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
      }

      case OcgMessageType.SELECT_CHAIN: {
        const selects: any[] = message.selects || [];
        if (selects.length === 0) return { type: OcgResponseType.SELECT_CHAIN, index: null };

        const disruption = selects.findIndex((s: any) => DISRUPTION_CODES.has(Number(s.code)));
        if (disruption >= 0) {
          stats.chains += 1;
          return { type: OcgResponseType.SELECT_CHAIN, index: disruption };
        }
        if (chainDepth < maxChainDepth && random() < 0.5) {
          chainDepth += 1;
          stats.chains += 1;
          return { type: OcgResponseType.SELECT_CHAIN, index: pick(selects.map((_: any, i: number) => ({ index: i, score: 10 - i })), random, exploration) };
        }
        return { type: OcgResponseType.SELECT_CHAIN, index: null };
      }

      case OcgMessageType.SELECT_CARD: {
        const selects: any[] = message.selects || [];
        const min = Math.max(Number(message.min) || 1, 1);
        if (message.can_cancel && (Number(message.min) || 0) === 0) {
          return { type: OcgResponseType.SELECT_CARD, indicies: null };
        }
        const scored = selects.map((s: any, i: number) => ({ index: i, score: atkOf(s) + (Number(s.location) === OcgLocation.HAND ? 1000 : 0) }));
        const chosen: number[] = [];
        const pool = [...scored].sort((a, b) => b.score - a.score);
        for (let i = 0; i < Math.min(min, pool.length); i++) chosen.push(pool[i].index);
        return { type: OcgResponseType.SELECT_CARD, indicies: chosen };
      }

      case OcgMessageType.SELECT_EFFECTYN:
        return { type: OcgResponseType.SELECT_EFFECTYN, yes: random() < 0.8 };

      case OcgMessageType.SELECT_YESNO:
        return { type: OcgResponseType.SELECT_YESNO, yes: random() < 0.8 };

      case OcgMessageType.SELECT_OPTION:
        return { type: OcgResponseType.SELECT_OPTION, index: 0 };

      case OcgMessageType.SELECT_POSITION: {
        const positions = Number(message.positions) || 0;
        if (positions & OcgPosition.FACEUP_ATTACK) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_ATTACK };
        if (positions & OcgPosition.FACEUP_DEFENSE) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_DEFENSE };
        return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEDOWN_DEFENSE };
      }

      case OcgMessageType.SELECT_BATTLECMD: {
        const attacks: any[] = message.attacks || [];
        if (attacks.length) {
          stats.attacks += 1;
          return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
        }
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
      }

      case OcgMessageType.SELECT_TRIBUTE: {
        const selects: any[] = message.selects || [];
        const min = Math.max(Number(message.min) || 1, 1);
        if (message.can_cancel && (Number(message.min) || 0) === 0) return { type: OcgResponseType.SELECT_TRIBUTE, indicies: null };
        const indices = selects
          .map((s: any, i: number) => ({ index: i, score: atkOf(s) }))
          .sort((a, b) => a.score - b.score)
          .slice(0, min)
          .map((c) => c.index);
        return { type: OcgResponseType.SELECT_TRIBUTE, indicies: indices };
      }

      case OcgMessageType.SELECT_UNSELECT_CARD:
        if (message.can_finish || message.can_cancel) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };

      case OcgMessageType.SORT_CARD:
        return { type: OcgResponseType.SORT_CARD, order: null };

      default:
        return null;
    }
  };

  return { respond, stats };
}
