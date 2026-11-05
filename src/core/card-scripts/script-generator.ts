/**
 * Best-effort Lua generator for cards that have no official script yet.
 *
 * This is deliberately conservative: it recognises a small set of PSCT actions
 * (draw, search, destroy, banish, bounce, burn, recover, Special Summon) and
 * emits a script that compiles and runs in ocgcore. Everything it could not
 * understand is left as an explicit TODO comment.
 *
 * The output is NEVER presented as official. Every script carries a header with
 * its provenance and a confidence level, and the resolver replaces it the moment
 * an official `c<passcode>.lua` becomes available upstream.
 */

import { CardData, TYPE_MONSTER, TYPE_NORMAL, TYPE_SPELL, TYPE_TRAP, TYPE_CONTINUOUS, TYPE_QUICKPLAY, TYPE_COUNTER, TYPE_FIELD } from "./card-data.js";

export interface GeneratedScript {
  lua: string;
  confidence: "high" | "medium" | "low";
  patterns: string[];
  notes: string[];
}

type Action =
  | { kind: "draw"; amount: number }
  | { kind: "search"; amount: number }
  | { kind: "destroy"; amount: number }
  | { kind: "banish"; amount: number }
  | { kind: "bounce"; amount: number }
  | { kind: "damage"; amount: number }
  | { kind: "recover"; amount: number }
  | { kind: "spsummon"; amount: number }
  | { kind: "mill"; amount: number }
  | { kind: "discard"; amount: number }
  | { kind: "returnDeck"; amount: number };

const CATEGORY: Record<Action["kind"], string> = {
  draw: "CATEGORY_DRAW",
  search: "CATEGORY_TOHAND + CATEGORY_SEARCH",
  destroy: "CATEGORY_DESTROY",
  banish: "CATEGORY_REMOVE",
  bounce: "CATEGORY_TOHAND",
  damage: "CATEGORY_DAMAGE",
  recover: "CATEGORY_RECOVER",
  spsummon: "CATEGORY_SPECIAL_SUMMON",
  mill: "CATEGORY_GRAVE_ACTION",
  discard: "CATEGORY_HANDES",
  returnDeck: "CATEGORY_TODECK"
};

function toNumber(value: string | undefined, fallback = 1, max = 6): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

/** Detects what the card text says it does. */
export function detectActions(desc: string): Action[] {
  const text = desc.toLowerCase();
  const actions: Action[] = [];

  const draw = text.match(/draw (\d+) cards?/);
  if (draw) actions.push({ kind: "draw", amount: toNumber(draw[1]) });

  const search = text.match(/add (?:up to |exactly )?(\d+|1) cards? .{0,80}?from your deck to your hand/);
  if (search) actions.push({ kind: "search", amount: toNumber(search[1]) });
  else if (/add .{0,60}?from your deck to your hand/.test(text)) actions.push({ kind: "search", amount: 1 });

  if (/\bdestroy\b/.test(text)) {
    const m = text.match(/destroy (?:up to )?(\d+|all)/);
    actions.push({ kind: "destroy", amount: m && m[1] !== "all" ? toNumber(m[1]) : 1 });
  }

  if (/\bbanish\b|remove from play/.test(text)) {
    const m = text.match(/banish (?:up to )?(\d+)/);
    actions.push({ kind: "banish", amount: m ? toNumber(m[1]) : 1 });
  }

  if (/return .{0,60}?to the hand/.test(text)) {
    const m = text.match(/return (?:up to )?(\d+)/);
    actions.push({ kind: "bounce", amount: m ? toNumber(m[1]) : 1 });
  }

  if (/inflict (\d+) damage/.test(text)) {
    const m = text.match(/inflict (\d+) damage/);
    actions.push({ kind: "damage", amount: toNumber(m?.[1], 500, 100000) });
  }

  if (/gain (\d+) life points/.test(text)) {
    const m = text.match(/gain (\d+) life points/);
    actions.push({ kind: "recover", amount: toNumber(m?.[1], 500, 100000) });
  }

  if (/special summon/.test(text)) actions.push({ kind: "spsummon", amount: 1 });

  const mill = text.match(/send (?:the top )?(\d+) cards? .{0,60}?from your deck to the (?:gy|graveyard)/);
  if (mill) actions.push({ kind: "mill", amount: toNumber(mill[1]) });
  else if (/send the top (\d+) cards? of your deck to the (?:gy|graveyard)/.test(text)) {
    const m = text.match(/send the top (\d+) cards?/);
    actions.push({ kind: "mill", amount: toNumber(m?.[1]) });
  }

  const discard = text.match(/discard (\d+) cards?/);
  if (discard) actions.push({ kind: "discard", amount: toNumber(discard[1]) });

  if (/return .{0,60}?to the deck|shuffle .{0,40}?into the deck/.test(text)) {
    const m = text.match(/return (?:up to )?(\d+)/);
    actions.push({ kind: "returnDeck", amount: m ? toNumber(m[1]) : 1 });
  }

  // Keep one action per kind, in a stable order.
  const seen = new Set<string>();
  return actions.filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));
}

function buildOperation(action: Action): string[] {
  switch (action.kind) {
    case "draw":
      return [`\tDuel.Draw(tp, ${action.amount}, REASON_EFFECT)`];
    case "search":
      return [
        `\tlocal g=Duel.SelectMatchingCard(tp, aux.TRUE, tp, LOCATION_DECK, 0, ${action.amount}, ${action.amount}, nil)`,
        `\tif #g>0 then`,
        `\t\tDuel.SendtoHand(g, tp, REASON_EFFECT)`,
        `\t\tDuel.ConfirmCards(1-tp, g)`,
        `\tend`
      ];
    case "destroy":
      return [
        `\tlocal g=Duel.SelectMatchingCard(tp, aux.TRUE, 0, LOCATION_MZONE, 0, ${action.amount}, ${action.amount}, nil)`,
        `\tif #g>0 then Duel.Destroy(g, REASON_EFFECT) end`
      ];
    case "banish":
      return [
        `\tlocal g=Duel.SelectMatchingCard(tp, aux.TRUE, 0, LOCATION_MZONE, 0, ${action.amount}, ${action.amount}, nil)`,
        `\tif #g>0 then Duel.Remove(g, POS_FACEUP, REASON_EFFECT) end`
      ];
    case "bounce":
      return [
        `\tlocal g=Duel.SelectMatchingCard(tp, aux.TRUE, 0, LOCATION_MZONE, 0, ${action.amount}, ${action.amount}, nil)`,
        `\tif #g>0 then Duel.SendtoHand(g, PLAYER_ALL, REASON_EFFECT) end`
      ];
    case "damage":
      return [`\tDuel.Damage(1-tp, ${action.amount}, REASON_EFFECT)`];
    case "recover":
      return [`\tDuel.Recover(tp, ${action.amount}, REASON_EFFECT)`];
    case "spsummon":
      return [
        `\tlocal g=Duel.SelectMatchingCard(tp, aux.TRUE, tp, LOCATION_HAND, 0, 1, 1, nil)`,
        `\tif #g>0 then Duel.SpecialSummon(g, 0, tp, tp, false, false, POS_FACEUP) end`
      ];
    case "mill":
      return [`\tDuel.SendtoGrave(Duel.GetDecktopGroup(tp, ${action.amount}), REASON_EFFECT)`];
    case "discard":
      return [`\tDuel.DiscardHand(tp, aux.TRUE, ${action.amount}, ${action.amount}, REASON_EFFECT)`];
    case "returnDeck":
      return [
        `\tlocal g=Duel.SelectMatchingCard(tp, aux.TRUE, 0, LOCATION_MZONE, 0, ${action.amount}, ${action.amount}, nil)`,
        `\tif #g>0 then Duel.SendtoDeck(g, nil, SEQ_DECKSHUFFLE, REASON_EFFECT) end`
      ];
  }
}

function buildTargetCheck(actions: Action[]): string[] {
  const checks: string[] = [];
  for (const action of actions) {
    switch (action.kind) {
      case "draw":
        checks.push(`Duel.IsPlayerCanDraw(tp, ${action.amount})`);
        break;
      case "search":
        checks.push(`Duel.IsExistingMatchingCard(aux.TRUE, tp, LOCATION_DECK, 0, 1, nil)`);
        break;
      case "destroy":
      case "banish":
      case "bounce":
        checks.push(`Duel.IsExistingMatchingCard(aux.TRUE, tp, 0, LOCATION_MZONE, 1, nil)`);
        break;
      case "damage":
      case "recover":
        checks.push(`true`);
        break;
      case "spsummon":
        checks.push(`Duel.IsExistingMatchingCard(aux.TRUE, tp, LOCATION_HAND, 0, 1, nil)`);
        break;
      case "mill":
        checks.push(`Duel.GetFieldGroupCount(tp, LOCATION_DECK, 0) >= ${action.amount}`);
        break;
      case "discard":
        checks.push(`Duel.IsExistingMatchingCard(aux.TRUE, tp, LOCATION_HAND, 0, ${action.amount}, nil)`);
        break;
      case "returnDeck":
        checks.push(`Duel.IsExistingMatchingCard(aux.TRUE, tp, 0, LOCATION_MZONE, 1, nil)`);
        break;
    }
  }
  return checks.length ? [checks[0]] : ["true"];
}

export function generateLuaFromCardData(card: CardData): GeneratedScript {
  const isMonster = (card.type & TYPE_MONSTER) !== 0;
  const isNormal = (card.type & TYPE_NORMAL) !== 0;
  const selfGyTrigger = /(if|when) this card is (discarded|sent) to the (gy|graveyard)/i.test(card.desc);
  const selfSummonFromGy = selfGyTrigger && /special summon (it|this card)/i.test(card.desc);
  const isSpell = (card.type & TYPE_SPELL) !== 0;
  const isTrap = (card.type & TYPE_TRAP) !== 0;
  const isContinuous = (card.type & TYPE_CONTINUOUS) !== 0;
  const isQuickPlay = (card.type & TYPE_QUICKPLAY) !== 0;
  const isCounter = (card.type & TYPE_COUNTER) !== 0;
  const isField = (card.type & TYPE_FIELD) !== 0;

  const actions = isNormal ? [] : detectActions(card.desc);
  const notes: string[] = [];

  if (isNormal) notes.push("Normal Monster: no effect to implement.");
  if (!isNormal && actions.length === 0) notes.push("No recognised PSCT action: skeleton only, effects must be written by hand.");
  if (/\bnegate\b/.test(card.desc.toLowerCase()) && !actions.some((a) => a.kind === "destroy")) {
    notes.push("Text mentions negation: not auto-implemented (needs effect chaining).");
  }
  if (/\b(once per turn|you can only use)\b/i.test(card.desc)) {
    notes.push("Once-per-turn clause detected: emitted as a hard once-per-turn.");
  }

  const confidence: GeneratedScript["confidence"] =
    actions.length === 0 ? "low" : actions.length <= 2 ? "medium" : "low";

  const hopt = /you can only use|once per turn/i.test(card.desc);
  const categories = Array.from(new Set(actions.map((a) => CATEGORY[a.kind])));

  const lines: string[] = [
    "-- =====================================================================",
    "-- AUTO-GENERATED SCRIPT — NOT AN OFFICIAL KONAMI SCRIPT",
    `-- Card: ${card.name} (ID: ${card.code})`,
    "-- Source: local cards.cdb text only (no official c<id>.lua was found).",
    `-- Confidence: ${confidence}`,
    "-- This file is replaced automatically as soon as the official script appears.",
    "-- =====================================================================",
    `local s,id=GetID()`,
    `function s.initial_effect(c)`
  ];

  if (isNormal) {
    lines.push(`\t-- Vanilla monster: nothing to register.`);
    lines.push(`end`);
    lines.push("");
    return { lua: lines.join("\n"), confidence, patterns: [], notes };
  }

  if (isSpell || isTrap) {
    if (isContinuous || isField) lines.push(`\t-- Continuous/Field handling is not auto-generated.`);
    lines.push(`\tlocal e1=Effect.CreateEffect(c)`);
    lines.push(`\te1:SetDescription(aux.Stringid(id,0))`);
    if (categories.length) lines.push(`\te1:SetCategory(${categories.join("+")})`);
    lines.push(`\te1:SetType(EFFECT_TYPE_ACTIVATE)`);
    lines.push(`\te1:SetCode(EVENT_FREE_CHAIN)`);
    if (isQuickPlay || isTrap) lines.push(`\te1:SetHintTiming(0, TIMING_END_PHASE)`);
    if (isCounter) lines.push(`\t-- Counter Trap: negating activations is not auto-generated.`);
    lines.push(`\te1:SetCountLimit(1,id${hopt ? ",EFFECT_COUNT_CODE_OATH" : ""})`);
    lines.push(`\te1:SetTarget(s.target)`);
    lines.push(`\te1:SetOperation(s.operation)`);
    lines.push(`\tc:RegisterEffect(e1)`);
  } else {
    const normalSummonTrigger = /if this card is normal summoned|when this card is normal summoned/i.test(card.desc);
    lines.push(`\tlocal e1=Effect.CreateEffect(c)`);
    lines.push(`\te1:SetDescription(aux.Stringid(id,0))`);
    if (categories.length) lines.push(`\te1:SetCategory(${categories.join("+")})`);
    if (selfGyTrigger) {
      lines.push(`\t-- Trigger when this card is sent/discarded to the GY`);
      lines.push(`\te1:SetType(EFFECT_TYPE_TRIGGER_O+EFFECT_TYPE_SINGLE)`);
      lines.push(`\te1:SetCode(EVENT_TO_GRAVE)`);
      lines.push(`\te1:SetRange(LOCATION_HAND+LOCATION_MZONE+LOCATION_GRAVE)`);
    } else if (normalSummonTrigger) {
      lines.push(`\te1:SetType(EFFECT_TYPE_TRIGGER_O+EFFECT_TYPE_SINGLE)`);
      lines.push(`\te1:SetCode(EVENT_SUMMON_SUCCESS)`);
    } else {
      lines.push(`\te1:SetType(EFFECT_TYPE_IGNITION)`);
      lines.push(`\te1:SetRange(LOCATION_MZONE)`);
    }
    lines.push(`\te1:SetCountLimit(1,id${hopt ? ",EFFECT_COUNT_CODE_OATH" : ""})`);
    lines.push(`\te1:SetTarget(s.target)`);
    lines.push(`\te1:SetOperation(s.operation)`);
    lines.push(`\tc:RegisterEffect(e1)`);
  }

  if (/cannot be destroyed by battle/i.test(card.desc) && isMonster) {
    lines.push(`\t-- Protection: cannot be destroyed by battle`);
    lines.push(`\tlocal e2=Effect.CreateEffect(c)`);
    lines.push(`\te2:SetType(EFFECT_TYPE_SINGLE)`);
    lines.push(`\te2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)`);
    lines.push(`\te2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)`);
    lines.push(`\te2:SetValue(1)`);
    lines.push(`\tc:RegisterEffect(e2)`);
  }

  lines.push(`end`);
  lines.push(``);

  lines.push(`function s.target(e,tp,eg,ep,ev,re,r,rp,chk)`);
  lines.push(`\tif chk==0 then return ${buildTargetCheck(actions)[0]} end`);
  lines.push(`end`);
  lines.push(``);

  lines.push(`function s.operation(e,tp,eg,ep,ev,re,r,rp)`);
  if (selfSummonFromGy) {
    lines.push(`\tlocal c=e:GetHandler()`);
    lines.push(`\tif c:IsRelateToEffect(e) or c:IsLocation(LOCATION_GRAVE) then`);
    lines.push(`\t\tDuel.SpecialSummon(c, 0, tp, tp, false, false, POS_FACEUP)`);
    lines.push(`\tend`);
  } else if (actions.length === 0) {
    lines.push(`\t-- TODO: no PSCT action was recognised. Implement by hand.`);
  } else {
    for (const action of actions) {
      lines.push(`\t-- ${action.kind} ${action.amount}`);
      lines.push(...buildOperation(action));
    }
  }
  lines.push(`end`);

  return {
    lua: lines.join("\n"),
    confidence,
    patterns: actions.map((a) => `${a.kind}:${a.amount}`),
    notes
  };
}
