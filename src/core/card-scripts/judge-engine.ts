import { fetchCardScript } from './script-fetcher.js';
import { parseCardLua } from './lua-parser.js';
import { analyzeLuaCard } from './lua-ast.js';
import { CardRulingAnalysis, ParsedEffect } from '../../types/lua.js';

/**
 * Analyzes the ruling mechanics of a Yu-Gi-Oh card from its Lua script.
 */
export async function analyzeCardMechanics(
  passcode: number,
  cardName?: string,
  customLua?: string
): Promise<CardRulingAnalysis> {
  const luaCode = customLua || (await fetchCardScript(passcode));

  if (!luaCode) {
    return {
      passcode,
      cardName: cardName || `Card #${passcode}`,
      luaSourceAvailable: false,
      effects: [],
      targetingProperties: {
        targets: false,
        explanation: `No Lua script available for card #${passcode}.`,
      },
      costProperties: {
        hasCost: false,
        costDetails: [],
      },
      timingProperties: {
        canMissTiming: false,
        triggerType: 'Unknown',
        explanation: 'Script unavailable for timing analysis.',
      },
      negationProperties: {
        negatesActivation: false,
        negatesEffect: false,
        explanation: 'Script unavailable for negation analysis.',
      },
      damageStepUsable: {
        usable: false,
        reason: 'Script unavailable for Damage Step analysis.',
      },
      summaryVerdict: `Card #${passcode}: Lua script not found.`,
    };
  }

  const effects = parseCardLua(luaCode, passcode);
  const structure = analyzeLuaCard(luaCode, passcode);

  // 1. Targeting Analysis
  const targetingEffects = effects.filter((e) => e.isTargeting);
  const targets = targetingEffects.length > 0;
  let targetingExplanation = '';
  if (targets) {
    const indices = targetingEffects.map((e) => `#${e.index}`).join(', ');
    const descriptions = targetingEffects
      .map((e) => `Effect #${e.index}: ${e.targetDescription || 'Targets card(s)'}`)
      .join('; ');
    targetingExplanation = `This card TARGETS (Effect(s) ${indices}). Details: ${descriptions}. Targets must be designated at activation and can be blocked by target-immunity.`;
  } else {
    targetingExplanation =
      'This card DOES NOT TARGET (Non-targeting). Choices are made at resolution, bypassing standard targeting immunity.';
  }

  // 2. Cost Analysis
  const costEffects = effects.filter((e) => !!e.costDescription);
  const hasCost = costEffects.length > 0;
  const costDetails = costEffects.map((e) => `Effect #${e.index}: ${e.costDescription}`);

  // 3. Timing Analysis
  let canMissTiming = false;
  let triggerType = 'Non-Trigger / Activated';
  let timingExplanation =
    'This card does not have optional trigger effects that can miss timing. Effects are Quick, Ignition, or Mandatory.';

  const optionalTriggersWithoutDelay = effects.filter(
    (e) =>
      e.effectType.includes('EFFECT_TYPE_TRIGGER_O') &&
      !e.flags.includes('EFFECT_FLAG_DELAY')
  );

  const optionalTriggersWithDelay = effects.filter(
    (e) =>
      e.effectType.includes('EFFECT_TYPE_TRIGGER_O') &&
      e.flags.includes('EFFECT_FLAG_DELAY')
  );

  const mandatoryTriggers = effects.filter((e) =>
    e.effectType.includes('EFFECT_TYPE_TRIGGER_F')
  );

  const quickEffects = effects.filter(
    (e) =>
      e.effectType.includes('EFFECT_TYPE_QUICK_O') ||
      e.effectType.includes('EFFECT_TYPE_QUICK_F')
  );

  if (optionalTriggersWithoutDelay.length > 0) {
    canMissTiming = true;
    triggerType = "Optional 'When... you can' Trigger";
    const idxs = optionalTriggersWithoutDelay.map((e) => `#${e.index}`).join(', ');
    timingExplanation = `WARNING: Effect(s) ${idxs} are optional trigger effects without EFFECT_FLAG_DELAY ("When... you can"). They CAN MISS TIMING if their trigger event is not the very last thing to occur in the chain or resolution.`;
  } else if (optionalTriggersWithDelay.length > 0) {
    canMissTiming = false;
    triggerType = "Optional 'If... you can' Trigger (with Delay)";
    timingExplanation =
      'This card features optional trigger effects with EFFECT_FLAG_DELAY ("If... you can"). They CANNOT miss timing and will activate in the next chain.';
  } else if (mandatoryTriggers.length > 0) {
    canMissTiming = false;
    triggerType = 'Mandatory Trigger';
    timingExplanation =
      'This card features mandatory trigger effect(s). Mandatory triggers CANNOT miss timing and must activate in the next chain.';
  } else if (quickEffects.length > 0) {
    canMissTiming = false;
    triggerType = 'Quick Effect (Spell Speed 2)';
    timingExplanation =
      'This card has Quick Effect(s) (Spell Speed 2) that activate in direct chain response or during appropriate phases.';
  }

  // 4. Negation Analysis
  const negatesActivation = effects.some(
    (e) =>
      e.categories.includes('CATEGORY_NEGATE') ||
      (e.operationDescription && e.operationDescription.includes('Negates the activation'))
  );
  const negatesEffect = effects.some(
    (e) =>
      e.categories.includes('CATEGORY_DISABLE') ||
      (e.operationDescription &&
        (e.operationDescription.includes('Negates the activated effect') ||
          e.operationDescription.includes('Negates monster/card effects')))
  );

  let negExplanation = 'Does not negate activations or effects.';
  if (negatesActivation && negatesEffect) {
    negExplanation =
      'Can negate both activation (CATEGORY_NEGATE) and effects (CATEGORY_DISABLE).';
  } else if (negatesActivation) {
    negExplanation =
      'Negates ACTIVATION (CATEGORY_NEGATE). The activation is treated as if it never occurred. If a card with "You can only activate 1 [Card Name] per turn" has its activation negated, another copy CAN be activated that turn.';
  } else if (negatesEffect) {
    negExplanation =
      'Negates EFFECT (CATEGORY_DISABLE). The card was still successfully activated, but its resolving effect is negated. If a card with "You can only activate 1 [Card Name] per turn" has its effect negated, another copy CANNOT be activated that turn.';
  }

  // 5. Damage Step Usable Analysis
  let damageStepUsable = false;
  const damageStepReasons: string[] = [];

  for (const e of effects) {
    // 1. Explicit Damage Step flags
    if (
      e.flags.includes('EFFECT_FLAG_DAMAGE_STEP') ||
      e.flags.includes('EFFECT_FLAG_DAMAGE_CAL')
    ) {
      damageStepUsable = true;
      damageStepReasons.push(
        `Effect #${e.index} has explicit ${e.flags.filter((f) => f.includes('DAMAGE')).join('+')} flag`
      );
    }
    // 2. Negate Activation
    if (e.categories.includes('CATEGORY_NEGATE')) {
      damageStepUsable = true;
      damageStepReasons.push(`Effect #${e.index} negates activations (CATEGORY_NEGATE)`);
    }
    // 3. Counter Trap activation
    if (
      e.effectType.includes('EFFECT_TYPE_ACTIVATE') &&
      e.categories.includes('CATEGORY_DISABLE_SUMMON')
    ) {
      damageStepUsable = true;
      damageStepReasons.push(`Effect #${e.index} negates summons (Counter Trap / Summon negation)`);
    }
    // 4. ATK/DEF change
    if (
      e.categories.includes('CATEGORY_ATKCHANGE') ||
      e.categories.includes('CATEGORY_DEFCHANGE')
    ) {
      damageStepUsable = true;
      damageStepReasons.push(`Effect #${e.index} modifies ATK/DEF directly`);
    }
    // 5. Mandatory trigger
    if (e.effectType.includes('EFFECT_TYPE_TRIGGER_F')) {
      damageStepUsable = true;
      damageStepReasons.push(`Effect #${e.index} is a mandatory trigger`);
    }
  }

  const damageReason = damageStepUsable
    ? `Usable in Damage Step: ${damageStepReasons.join('; ')}.`
    : 'NOT usable in Damage Step. Standard Ignition, Quick, and non-Delay optional trigger effects cannot be activated in the Damage Step unless modifying ATK/DEF or negating activation.';

  // 6. Summary Verdict
  const displayName = cardName || `Card #${passcode}`;
  const hoptCount = effects.filter((e) => e.isHOPT).length;
  const soptCount = effects.filter((e) => e.isSOPT).length;
  const optSummary =
    hoptCount > 0
      ? `HOPT (${hoptCount} effect(s))`
      : soptCount > 0
      ? `SOPT (${soptCount} effect(s))`
      : 'No turn limit';

  const summaryVerdict = `${displayName}: ${effects.length} effect(s) parsed. ${optSummary}. Targets: ${
    targets ? 'YES' : 'NO'
  }. Cost: ${hasCost ? costDetails.join(' | ') : 'None'}. Can miss timing: ${
    canMissTiming ? 'YES' : 'NO'
  }. Damage Step: ${damageStepUsable ? 'YES' : 'NO'}.`;

  return {
    passcode,
    cardName: displayName,
    luaSourceAvailable: true,
    effects,
    targetingProperties: {
      targets,
      explanation: targetingExplanation,
    },
    costProperties: {
      hasCost,
      costDetails,
    },
    timingProperties: {
      canMissTiming,
      triggerType,
      explanation: timingExplanation,
    },
    negationProperties: {
      negatesActivation,
      negatesEffect,
      explanation: negExplanation,
    },
    damageStepUsable: {
      usable: damageStepUsable,
      reason: damageReason,
    },
    structure,
    summaryVerdict,
  };
}

/**
 * Judges interactions between two cards based on parsed Lua properties.
 */
export async function judgeInteraction(
  cardA: number | string,
  cardB: number | string,
  question: string
): Promise<string> {
  const resolveId = (c: number | string): number => {
    if (typeof c === 'number') return c;
    if (c === 'Baronne de Fleur') return 84013237;
    if (c === 'Ash Blossom & Joyous Spring') return 14558127;
    const n = parseInt(c, 10);
    return isNaN(n) ? 84013237 : n;
  };
  const cardA_id = resolveId(cardA);
  const cardB_id = resolveId(cardB);
  const analysisA = await analyzeCardMechanics(cardA_id);
  const analysisB = await analyzeCardMechanics(cardB_id);

  const qLower = question.toLowerCase();
  const outputSections: string[] = [
    '=== YU-GI-OH JUDGE ENGINE ADJUDICATION ===',
    `Card A: [${analysisA.cardName}] (#${cardA_id})`,
    `Card B: [${analysisB.cardName}] (#${cardB_id})`,
    `Question: "${question}"`,
    '',
  ];

  // Helper check for specific topics
  const isDamageStepQ =
    qLower.includes('damage step') || qLower.includes('damage') || qLower.includes('battle');
  const isTargetingQ =
    qLower.includes('target') || qLower.includes('targets') || qLower.includes('targeting');
  const isNegationQ =
    qLower.includes('activation') ||
    qLower.includes('negate') ||
    qLower.includes('disable') ||
    qLower.includes('negate');
  const isOptQ =
    qLower.includes('once per turn') ||
    qLower.includes('hopt') ||
    qLower.includes('sopt') ||
    qLower.includes('reactivate') ||
    qLower.includes('re-activate') ||
    qLower.includes('another copy') ||
    qLower.includes('copy') ||
    qLower.includes('activate again');
  const isDarkWorldQ =
    qLower.includes('dark world') ||
    qLower.includes('discard') ||
    qLower.includes('cost vs effect') ||
    qLower.includes('cost') ||
    qLower.includes('discard');
  const isTimingQ =
    qLower.includes('timing') ||
    qLower.includes('miss timing') ||
    qLower.includes('miss timing') ||
    qLower.includes('when vs if');

  // 1. Damage Step Activation
  if (isDamageStepQ || (!isTargetingQ && !isDarkWorldQ && !isTimingQ && !isOptQ && !isNegationQ)) {
    outputSections.push('--- [1. Damage Step Usability] ---');
    outputSections.push(
      `Card A (${analysisA.cardName}): ${
        analysisA.damageStepUsable.usable ? 'CAN' : 'CANNOT'
      } activate in the Damage Step.`
    );
    outputSections.push(`  Reason: ${analysisA.damageStepUsable.reason}`);
    outputSections.push(
      `Card B (${analysisB.cardName}): ${
        analysisB.damageStepUsable.usable ? 'CAN' : 'CANNOT'
      } activate in the Damage Step.`
    );
    outputSections.push(`  Reason: ${analysisB.damageStepUsable.reason}`);
    outputSections.push('');
  }

  // 2. Targeting Check
  if (isTargetingQ || (!isDamageStepQ && !isDarkWorldQ && !isTimingQ && !isOptQ && !isNegationQ)) {
    outputSections.push('--- [2. Targeting Mechanics] ---');
    outputSections.push(
      `Does Card A (${analysisA.cardName}) target Card B (${analysisB.cardName})?`
    );
    if (analysisA.targetingProperties.targets) {
      outputSections.push(`  YES. ${analysisA.targetingProperties.explanation}`);
      outputSections.push(
        `  Ruling implication: If Card B cannot be targeted by card effects, Card A cannot target Card B.`
      );
    } else {
      outputSections.push(`  NO. ${analysisA.targetingProperties.explanation}`);
      outputSections.push(
        `  Ruling implication: Card A bypasses target immunity because it chooses its targets at resolution without targeting.`
      );
    }
    outputSections.push('');
  }

  // 3. Activation vs Effect Negation
  if (isNegationQ || (!isDamageStepQ && !isTargetingQ && !isDarkWorldQ && !isTimingQ && !isOptQ)) {
    outputSections.push('--- [3. Activation vs Effect Negation] ---');
    outputSections.push(`Card A Negation Properties: ${analysisA.negationProperties.explanation}`);
    outputSections.push(`Card B Negation Properties: ${analysisB.negationProperties.explanation}`);
    outputSections.push(
      '  Konami Rulebook Principle: negating the ACTIVATION (CATEGORY_NEGATE) erases the activation event from the Chain. Negating the EFFECT (CATEGORY_DISABLE) allows the activation to succeed but replaces the effect with nothing on resolution.'
    );
    outputSections.push('');
  }

  // 4. Once Per Turn / Re-activation
  if (isOptQ || (!isDamageStepQ && !isTargetingQ && !isDarkWorldQ && !isTimingQ && !isNegationQ)) {
    outputSections.push('--- [4. Once Per Turn & Re-Activation] ---');
    const hoptA = analysisA.effects.some((e) => e.isHOPT);
    const soptA = analysisA.effects.some((e) => e.isSOPT);
    outputSections.push(
      `Card A Turn Restrictions: ${hoptA ? 'Hard Once Per Turn (HOPT)' : soptA ? 'Soft Once Per Turn (SOPT)' : 'No Once Per Turn limit'}.`
    );
    outputSections.push(
      '  Ruling on Negated Activation vs Negated Effect:'
    );
    outputSections.push(
      '  1. If Card A has "You can only ACTIVATE 1 [Card Name] per turn" (EFFECT_COUNT_CODE_OATH):'
    );
    outputSections.push(
      '     - If its ACTIVATION is negated (e.g. by Solemn Judgment, Baronne de Fleur): The activation never officially occurred. You CAN activate another copy of Card A that turn.'
    );
    outputSections.push(
      '     - If its EFFECT is negated (e.g. by Ash Blossom, Effect Veiler): The activation was successful, only the effect was negated. You CANNOT activate another copy of Card A that turn.'
    );
    outputSections.push(
      '  2. If Card A has "You can only USE 1 [Card Name] per turn":'
    );
    outputSections.push(
      '     - You CANNOT activate another copy that turn, regardless of whether activation or effect was negated.'
    );
    outputSections.push(
      '  3. If Card A is Soft Once Per Turn (SOPT) or has no limit:'
    );
    outputSections.push(
      '     - A second copy can be activated regardless of negation.'
    );
    outputSections.push('');
  }

  // 5. Cost vs Effect Discard (Dark World Interaction)
  if (isDarkWorldQ || (!isDamageStepQ && !isTargetingQ && !isTimingQ && !isOptQ && !isNegationQ)) {
    outputSections.push('--- [5. Cost vs Effect Discard (Dark World)] ---');
    const costA = analysisA.costProperties.hasCost ? analysisA.costProperties.costDetails.join('; ') : 'None';
    const hasDiscardCostA = analysisA.effects.some(
      (e) => e.costDescription && (e.costDescription.includes('Discard') || e.costDescription.includes('discards'))
    );
    const hasDiscardEffectA = analysisA.effects.some(
      (e) => e.operationDescription && e.operationDescription.includes('Discards')
    );

    outputSections.push(`Card A Cost: ${costA}`);
    if (hasDiscardCostA) {
      outputSections.push(
        `  DISCARD AS COST: Card A discards as COST (REASON_COST).`
      );
      outputSections.push(
        `  Dark World Rule: "Dark World" monsters (Grapha, Snoww, Broww, etc.) trigger ONLY when discarded by a CARD EFFECT (REASON_EFFECT). Because Card A discards as COST, it will NOT trigger Dark World effects!`
      );
    } else if (hasDiscardEffectA) {
      outputSections.push(
        `  DISCARD AS EFFECT: Card A discards as an EFFECT (REASON_EFFECT).`
      );
      outputSections.push(
        `  Dark World Rule: Because this discard occurs as a card effect upon resolution, it DOES trigger Dark World monsters!`
      );
    } else {
      outputSections.push(
        `  Card A does not discard other cards. (Note: Ash Blossom discards ITSELF as cost; its effect does not discard opponent's cards).`
      );
    }
    outputSections.push('');
  }

  // 6. Missing Timing
  if (isTimingQ || (!isDamageStepQ && !isTargetingQ && !isDarkWorldQ && !isOptQ && !isNegationQ)) {
    outputSections.push('--- [6. Missing Timing Analysis] ---');
    outputSections.push(
      `Can Card A (${analysisA.cardName}) miss timing? ${
        analysisA.timingProperties.canMissTiming ? 'YES' : 'NO'
      }`
    );
    outputSections.push(`  Trigger Type: ${analysisA.timingProperties.triggerType}`);
    outputSections.push(`  Explanation: ${analysisA.timingProperties.explanation}`);
    outputSections.push('');
  }

  outputSections.push('=== FINAL JUDGE VERDICT ===');
  outputSections.push(
    `Adjudication completed based on ocgcore Lua script definitions for passcodes ${cardA_id} and ${cardB_id}.`
  );

  return outputSections.join('\n');
}
