/**
 * Reference scenarios used as regression cases.
 *
 * Each preset is a full, runnable duel: exact hands, scripted decisions and the
 * judge's expectation. They are executed by the real EDOPro core, so they double
 * as documentation of the engine's actual behaviour.
 */

import type { ScenarioSpec } from "./scenario-runner.js";

export const BRANDED_FUSION = 44362883;
export const ASH = 14558127;
export const CALLED = 24224830;
export const ALBAZ = 68468459;
export const VEILER = 97268402;
export const ALBION = 87746184;
export const POT_OF_GREED = 55144522;
export const FILLER = 46986420;

const albazDeck = () => [ALBAZ, VEILER, ...Array(18).fill(FILLER)];
const fillerDeck = () => Array(20).fill(FILLER);

export const SCENARIO_PRESETS: Record<string, ScenarioSpec> = {
  "negate-protected": {
    name: "Negate chain with protection",
    description: "Card B negates Card A; Card C negates Card B, so the summon resolves.",
    handA: [BRANDED_FUSION, CALLED],
    handB: [ASH],
    deckA: albazDeck(),
    deckB: fillerDeck(),
    extraA: [ALBION],
    decisions: [
      { on: "idle", player: 0, action: "activate", card: BRANDED_FUSION },
      { on: "chain", player: 1, card: ASH },
      { on: "chain", player: 0, card: CALLED },
      { on: "card", player: 0, cards: [ALBION] },
      { on: "card", player: 0, cards: [ALBAZ, VEILER] }
    ],
    expect: [
      { kind: "chainLink", card: BRANDED_FUSION, link: 1 },
      { kind: "chainLink", card: ASH, link: 2 },
      { kind: "chainLink", card: CALLED, link: 3 },
      { kind: "banished", card: ASH },
      { kind: "summoned", card: ALBION }
    ]
  },

  "negate-unprotected": {
    name: "Negate chain without protection",
    description: "Without Card C, Card B negates Card A and no summon happens.",
    handA: [BRANDED_FUSION],
    handB: [ASH],
    deckA: albazDeck(),
    deckB: fillerDeck(),
    extraA: [ALBION],
    decisions: [
      { on: "idle", player: 0, action: "activate", card: BRANDED_FUSION },
      { on: "chain", player: 1, card: ASH }
    ],
    expect: [
      { kind: "chainLink", card: ASH, link: 2 },
      { kind: "notSummoned", card: ALBION },
      { kind: "toGrave", card: ASH }
    ]
  },

  "hopt-after-negate": {
    name: "Effect negated — hard once per turn still consumed",
    description: "Card C negates the effect (not the activation), so the HOPT is consumed and a second copy cannot be used.",
    handA: [POT_OF_GREED, CALLED],
    handB: [ASH, ASH],
    deckA: fillerDeck(),
    deckB: fillerDeck(),
    decisions: [
      { on: "idle", player: 0, action: "activate", card: POT_OF_GREED },
      { on: "chain", player: 1, card: ASH },
      { on: "chain", player: 0, card: CALLED }
    ],
    expect: [
      { kind: "activated", card: ASH, times: 1 },
      { kind: "size", player: 1, zone: "hand", equals: 1 },
      { kind: "banished", card: ASH }
    ]
  },

  "draw-blocked": {
    name: "Draw effect negated",
    description: "Card B negates Card A's effect: no cards are drawn.",
    handA: [POT_OF_GREED],
    handB: [ASH],
    deckA: fillerDeck(),
    deckB: fillerDeck(),
    decisions: [
      { on: "idle", player: 0, action: "activate", card: POT_OF_GREED },
      { on: "chain", player: 1, card: ASH }
    ],
    expect: [
      { kind: "chainLink", card: POT_OF_GREED, link: 1 },
      { kind: "chainLink", card: ASH, link: 2 },
      { kind: "size", player: 0, zone: "hand", equals: 0 }
    ]
  }
};

export function listScenarioPresets(): Array<{ id: string; name: string; description?: string; expectations: number }> {
  return Object.entries(SCENARIO_PRESETS).map(([id, spec]) => ({
    id,
    name: spec.name,
    description: spec.description,
    expectations: spec.expect.length
  }));
}
