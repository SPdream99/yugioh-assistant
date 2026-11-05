import { SimulatorProfile, MasterCardData, ValidationIssue } from './types.js';

export interface EngineConstants {
  locationGrave: string;
  timingEndPhase: string;
  linkProcedure: string;
  xyzProcedure: string;
  synchroProcedure: string;
  fusionProcedure: string;
  countLimitOath: string;
  dbFileName: string;
  scriptsSubdir: string;
  artsSubdir: string;
}

export const PROFILE_CONSTANTS: Record<SimulatorProfile, EngineConstants> = {
  omega: {
    // YGO Omega does not pre-load the EDOPro procedure libraries, so each card script
    // explicitly loads proc_link/proc_xyz/proc_synchro/proc_fusion before using them.
    locationGrave: 'LOCATION_GRAVE',
    timingEndPhase: 'TIMINGS_CHECK_MONSTER + TIMING_END_PHASE',
    linkProcedure: 'Link.AddProcedure',
    xyzProcedure: 'Xyz.AddProcedure',
    synchroProcedure: 'Synchro.AddProcedure',
    fusionProcedure: 'Fusion.AddProcMix',
    countLimitOath: '',
    dbFileName: 'Databases/gm.db',
    scriptsSubdir: 'Scripts',
    artsSubdir: 'Arts'
  },
  edopro: {
    // EDOPro also uses LOCATION_GRAVE (LOCATION_GY does NOT exist).
    locationGrave: 'LOCATION_GRAVE',
    timingEndPhase: 'TIMINGS_CHECK_MONSTER_E',
    linkProcedure: 'Link.AddProcedure',
    xyzProcedure: 'Xyz.AddProcedure',
    synchroProcedure: 'Synchro.AddProcedure',
    fusionProcedure: 'Fusion.AddProcMix',
    countLimitOath: ', EFFECT_COUNT_CODE_OATH',
    dbFileName: 'expansions/cards.cdb',
    scriptsSubdir: 'expansions/script',
    artsSubdir: 'pics'
  },
  generic: {
    locationGrave: 'LOCATION_GRAVE',
    timingEndPhase: 'TIMINGS_CHECK_MONSTER + TIMING_END_PHASE',
    linkProcedure: 'aux.AddLinkProcedure',
    xyzProcedure: 'aux.AddXyzProcedure',
    synchroProcedure: 'aux.AddSynchroProcedure',
    fusionProcedure: 'aux.AddFusionProcMix',
    countLimitOath: '',
    dbFileName: 'cards.cdb',
    scriptsSubdir: 'script',
    artsSubdir: 'pics'
  }
};

/**
 * Validates a single card against simulator constraints (e.g. 8-digit ID for Omega).
 */
export function validateCardForProfile(card: MasterCardData, profile: SimulatorProfile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check ID constraints
  if (profile === 'omega') {
    // YGO Omega strictly requires 8-digit IDs <= 134,217,727 to avoid Unity int32 overflow
    if (card.id < 10000000 || card.id > 134217727) {
      issues.push({
        cardId: card.id,
        cardName: card.name,
        field: 'id',
        severity: 'error',
        message: `YGO Omega requires an 8-digit Card ID below 134,217,727 (got ${card.id}). A larger ID causes the Unity overflow error 'Unknown -xxxx'.`
      });
    }
  } else if (profile === 'edopro') {
    if (card.id < 10000000 || card.id > 999999999) {
      issues.push({
        cardId: card.id,
        cardName: card.name,
        field: 'id',
        severity: 'warning',
        message: `EDOPro recommends an 8-9 digit Card ID (got ${card.id}).`
      });
    }
  }

  // 2. Check Name & Desc
  if (!card.name || card.name.trim().length === 0) {
    issues.push({
      cardId: card.id,
      field: 'name',
      severity: 'error',
      message: 'Card name cannot be empty.'
    });
  }
  if (!card.desc || card.desc.trim().length === 0) {
    issues.push({
      cardId: card.id,
      cardName: card.name,
      field: 'desc',
      severity: 'error',
      message: 'Card effect text (desc) cannot be empty.'
    });
  }

  // 3. Check strings mapping if card text has multiple choice effects
  const descLower = (card.desc || '').toLowerCase();
  const hasOptions = descLower.includes('●') || descLower.includes('apply 1 of these effects') || descLower.includes('activate 1 of these effects');
  if (hasOptions && (!card.strings || card.strings.length === 0)) {
    issues.push({
      cardId: card.id,
      cardName: card.name,
      field: 'strings',
      severity: 'warning',
      message: 'The card has choice effects (●) but no str1..str16 choice strings were declared for aux.Stringid.'
    });
  }

  return issues;
}

/**
 * Static safety checks for generated Lua. These catch the exact classes of bugs
 * that crash YGO Omega at runtime (wrong constants, missing helper globals, stubs).
 */
export function validateGeneratedLua(lua: string, profile: SimulatorProfile, cardName: string, cardId: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (severity: 'error' | 'warning', message: string) => issues.push({ cardId, cardName, field: 'lua', severity, message });

  if (!/function\s+s\.initial_effect\s*\(/.test(lua)) {
    add('error', 'Script is missing function s.initial_effect(c).');
  }
  if (/\bLOCATION_GY\b/.test(lua)) {
    add('error', 'Uses LOCATION_GY, which does not exist. It must be LOCATION_GRAVE.');
  }
  if (profile === 'omega') {
    // Omega does not pre-load proc_*.lua; each script must load the library it uses.
    const procedureLibs: Record<string, string> = {
      Link: 'proc_link.lua',
      Xyz: 'proc_xyz.lua',
      Synchro: 'proc_synchro.lua',
      Fusion: 'proc_fusion.lua'
    };
    for (const [globalName, lib] of Object.entries(procedureLibs)) {
      const re = new RegExp(`\\b${globalName}\\.`);
      if (re.test(lua) && !lua.includes(`Duel.LoadScript("${lib}")`)) {
        add('error', `Script uses ${globalName}.* without Duel.LoadScript("${lib}"). On Omega the procedure library must be loaded first.`);
      }
    }
    if (/\bEFFECT_COUNT_CODE_OATH\b/.test(lua)) {
      add('warning', 'EFFECT_COUNT_CODE_OATH may be unstable on Omega; use SetCountLimit(1, id).');
    }
  }
  if (/-- (Activation|Primary effect|GY effect|Trigger \/ Ignition|logic here)/i.test(lua)) {
    add('warning', 'Script is still a skeleton/TODO, the effect will do nothing. Provide an executable `lua` for this card.');
  }
  return issues;
}

/**
 * Generates an engine-adapted Lua card script for the specified simulator profile.
 */
export function generateAdaptedLuaScript(card: MasterCardData, profile: SimulatorProfile, setcode: string = '0x99f'): string {
  const constants = PROFILE_CONSTANTS[profile];

  // If the author supplied a real script, use it verbatim (only add a small header).
  if (card.lua && card.lua.trim().length > 0) {
    return `-- Generated by Yu-Gi-Oh! Archetype Studio (${profile.toUpperCase()} Profile)\n-- Card: ${card.name} (ID: ${card.id})\n${card.lua.trim()}\n`;
  }

  const typeLower = (card.type || '').toLowerCase();

  const isMonster = typeLower.includes('monster');
  const isSpell = typeLower.includes('spell');
  const isTrap = typeLower.includes('trap');
  const isLink = typeLower.includes('link');
  const isXyz = typeLower.includes('xyz');
  const isSynchro = typeLower.includes('synchro');
  const isFusion = typeLower.includes('fusion');
  const isContinuous = typeLower.includes('continuous');
  const isQuickPlay = typeLower.includes('quick-play') || typeLower.includes('quickplay');
  const isCounter = typeLower.includes('counter');

  const lines: string[] = [
    `-- Generated by Yu-Gi-Oh! Archetype Studio (${profile.toUpperCase()} Profile)`,
    `-- Card: ${card.name} (ID: ${card.id})`
  ];

  // Omega does not load the EDOPro procedure libraries by default. Loading them from the
  // card script makes Link/Xyz/Synchro/Fusion work without requiring engine changes.
  if (profile === 'omega') {
    if (isLink) lines.push(`Duel.LoadScript("proc_link.lua")`);
    if (isXyz) lines.push(`Duel.LoadScript("proc_xyz.lua")`);
    if (isSynchro) lines.push(`Duel.LoadScript("proc_synchro.lua")`);
    if (isFusion) lines.push(`Duel.LoadScript("proc_fusion.lua")`);
  }

  lines.push(`local s, id = GetID()`, `function s.initial_effect(c)`);

  // Specific Summoning Procedures (profile-aware).
  // IMPORTANT: YGO Omega has no Xyz/Synchro/Link/Fusion globals; it uses aux.* helpers.
  if (isLink) {
    lines.push(`\t-- Link Summon Procedure`);
    lines.push(`\t${constants.linkProcedure}(c, aux.FilterBoolFunction(Card.IsSetCard, ${setcode}), 2, ${card.level || 2})`);
    lines.push(`\tc:EnableReviveLimit()`);
  } else if (isXyz) {
    lines.push(`\t-- Xyz Summon Procedure`);
    lines.push(`\t${constants.xyzProcedure}(c, aux.FilterBoolFunction(Card.IsSetCard, ${setcode}), ${card.level || 4}, 2)`);
    lines.push(`\tc:EnableReviveLimit()`);
  } else if (isSynchro) {
    lines.push(`\t-- Synchro Summon Procedure`);
    lines.push(`\t${constants.synchroProcedure}(c, aux.FilterBoolFunction(Card.IsType, TYPE_TUNER), 1, 1, aux.FilterBoolFunction(Card.IsSetCard, ${setcode}), 1, 99)`);
    lines.push(`\tc:EnableReviveLimit()`);
  } else if (isFusion) {
    lines.push(`\t-- Fusion Summon Procedure`);
    lines.push(`\t${constants.fusionProcedure}(c, true, true, aux.FilterBoolFunction(Card.IsSetCard, ${setcode}), aux.FilterBoolFunction(Card.IsSetCard, ${setcode}))`);
    lines.push(`\tc:EnableReviveLimit()`);
  }

  // Primary Activation Effect
  if (isSpell || isTrap) {
    lines.push(`\t-- Activation`);
    lines.push(`\tlocal e1 = Effect.CreateEffect(c)`);
    lines.push(`\te1:SetDescription(aux.Stringid(id, 0))`);
    lines.push(`\te1:SetType(EFFECT_TYPE_ACTIVATE)`);
    lines.push(`\te1:SetCode(EVENT_FREE_CHAIN)`);
    if (isQuickPlay || isTrap) {
      lines.push(`\te1:SetHintTiming(0, ${constants.timingEndPhase})`);
    }
    lines.push(`\te1:SetCountLimit(1, id${constants.countLimitOath})`);
    lines.push(`\te1:SetTarget(s.target)`);
    lines.push(`\te1:SetOperation(s.activate)`);
    lines.push(`\tc:RegisterEffect(e1)`);
  } else if (isMonster) {
    lines.push(`\t-- Trigger / Ignition Effect`);
    lines.push(`\tlocal e1 = Effect.CreateEffect(c)`);
    lines.push(`\te1:SetDescription(aux.Stringid(id, 0))`);
    lines.push(`\te1:SetCategory(CATEGORY_SPECIAL_SUMMON + CATEGORY_SEARCH)`);
    lines.push(`\te1:SetType(EFFECT_TYPE_IGNITION)`);
    lines.push(`\te1:SetRange(LOCATION_MZONE)`);
    lines.push(`\te1:SetCountLimit(1, id)`);
    lines.push(`\te1:SetTarget(s.target)`);
    lines.push(`\te1:SetOperation(s.operation)`);
    lines.push(`\tc:RegisterEffect(e1)`);
  }

  // Secondary GY Effect (using adapted locationGrave constant)
  lines.push(`\t-- GY Recovery / Trigger Effect`);
  lines.push(`\tlocal e2 = Effect.CreateEffect(c)`);
  lines.push(`\te2:SetDescription(aux.Stringid(id, 1))`);
  lines.push(`\te2:SetType(EFFECT_TYPE_IGNITION)`);
  lines.push(`\te2:SetRange(${constants.locationGrave})`);
  lines.push(`\te2:SetCountLimit(1, id + 1000)`);
  lines.push(`\te2:SetCost(aux.bfgcost)`);
  lines.push(`\te2:SetOperation(s.gyop)`);
  lines.push(`\tc:RegisterEffect(e2)`);

  lines.push(`end`);
  lines.push(``);

  // Helper target & operation stubs
  lines.push(`function s.target(e, tp, eg, ep, ev, re, r, rp, chk)`);
  lines.push(`\tif chk == 0 then return true end`);
  lines.push(`end`);
  lines.push(``);

  lines.push(`function s.activate(e, tp, eg, ep, ev, re, r, rp)`);
  lines.push(`\t-- Activation logic here`);
  lines.push(`end`);
  lines.push(``);

  lines.push(`function s.operation(e, tp, eg, ep, ev, re, r, rp)`);
  lines.push(`\t-- Primary effect operation logic here`);
  lines.push(`end`);
  lines.push(``);

  lines.push(`function s.gyop(e, tp, eg, ep, ev, re, r, rp)`);
  lines.push(`\t-- GY effect operation logic here`);
  lines.push(`end`);

  return lines.join('\n');
}
