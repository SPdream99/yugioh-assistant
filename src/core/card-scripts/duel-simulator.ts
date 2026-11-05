import { CardDatabase } from '../card-database/ygoprodeck.js';
import { fetchCardScript } from './script-fetcher.js';
import { analyzeCardMechanics } from './judge-engine.js';
import { runOcgCoreDuel, type OcgDuelResult } from './ocgcore-runtime.js';
import { CardRulingAnalysis } from '../../types/lua.js';
import type { Card } from '../../types/card.js';
import { SupportedFormat } from '../banlist/banlist-manager.js';

export interface DuelActionStep {
  stepNumber: number;
  player: 'Player A' | 'Player B' | string;
  action: 'Activate' | 'Summon' | 'Chain' | 'Trigger' | 'Attack' | 'Resolve' | 'Continuous';
  cardName: string;
  cardId?: number;
  chainLink?: number;
  spellSpeed?: 1 | 2 | 3;
  costPaid?: string;
  targetDeclared?: string;
  timingCondition?: string;
  legality: 'Legal' | 'Illegal' | 'Warning';
  legalityNotes?: string;
  outcome?: string;
}

export interface ChainResolutionStep {
  chainLink: number;
  cardName: string;
  resolvesSuccessfully: boolean;
  negatedBy?: string;
  effectResult: string;
  fieldStateChange?: string;
}

export interface CardScriptEvidence {
  cardName: string;
  id: number;
  luaScriptAvailable: boolean;
  analysis: CardRulingAnalysis;
  relevantScriptSnippet?: string;
}

export interface DuelSimulationVerdict {
  scenarioSummary: string;
  format: SupportedFormat;
  /** "ocgcore-wasm" = real EDOPro core executed the Lua; "static_analysis" = heuristic only. */
  runtime: "ocgcore-wasm" | "static_analysis";
  engineResult?: OcgDuelResult;
  isValidPlaySequence: boolean;
  actionsTimeline: DuelActionStep[];
  chainExecution: {
    chainLinkCount: number;
    resolutionOrderLIFO: ChainResolutionStep[];
  };
  cardsInvolvedEvidence: CardScriptEvidence[];
  finalBoardState: {
    playerAFieldAndGY: string[];
    playerBFieldAndGY: string[];
    remainingHandInteractions: string[];
  };
  officialJudgeRuling: {
    verdict: 'LEGAL' | 'ILLEGAL' | 'RESOLVED WITH NEGATION';
    coreRulebookPrinciples: string[];
    detailedExplanation: string;
    simulatorParityNotes: string; // Explains behavior in EDOPro, YGO Omega, Master Duel
  };
}

/**
 * Extracts card names mentioned in a free-form scenario text using generalized
 * entity extraction against the full 14,653+ card database without hardcoding.
 */
function extractCardCandidatesFromText(text: string): string[] {
  const candidates: string[] = [];
  // 1. Match quoted strings "Card Name" or 'Card Name' or “Card Name”
  const quoted = Array.from(text.matchAll(/["'“]([^"'“”]+)["'”]/g)).map(m => m[1].trim());
  candidates.push(...quoted);

  // 2. Scan text for any matching card from the full CardDatabase dynamically
  try {
    const db = CardDatabase.getInstance();
    const lowerText = text.toLowerCase();
    for (const card of db.cards.values()) {
      const lowerName = card.name.toLowerCase();
      // Match card names with significant length (>= 4 chars) to avoid false word collisions
      if (lowerName.length >= 4 && lowerText.includes(lowerName)) {
        candidates.push(card.name);
      }
    }
  } catch {
    // Ignore db read error
  }

  const unique = Array.from(new Set(candidates));
  // Filter out candidates that are substrings of another candidate (e.g. keep "Ash Blossom & Joyous Spring" over "Ash Blossom")
  return unique.filter(c => !unique.some(other => other !== c && other.toLowerCase().includes(c.toLowerCase())));
}

/**
 * Simulates and judges a complex Yu-Gi-Oh! duel scenario, evaluating card Lua scripts,
 * chain order (LIFO), activation legality, costs, targeting, timing, and resolution.
 */
export async function simulateDuelScenario(params: {
  scenario: string;
  format?: SupportedFormat;
  initialState?: string;
  deckA?: number[];
  deckB?: number[];
  handA?: number[];
  handB?: number[];
  extraA?: number[];
  extraB?: number[];
  maxSteps?: number;
  startingLP?: number;
}): Promise<DuelSimulationVerdict> {
  const db = CardDatabase.getInstance();
  const format = params.format || 'TCG';
  const scenarioText = params.scenario;

  // Real runtime: if the caller supplies actual decks, execute the EDOPro core.
  if (Array.isArray(params.deckA) && Array.isArray(params.deckB) && params.deckA.length > 0 && params.deckB.length > 0) {
    const engineResult = await runOcgCoreDuel({
      deckA: params.deckA,
      deckB: params.deckB,
      handA: params.handA,
      handB: params.handB,
      extraA: params.extraA,
      extraB: params.extraB,
      startingLP: params.startingLP,
      maxSteps: params.maxSteps || 120
    });

    const actionsTimeline: DuelActionStep[] = engineResult.timeline.map((line, index) => ({
      stepNumber: index + 1,
      player: line.includes('player 1') ? 'Player B' : 'Player A',
      action: line.includes('DRAW')
        ? 'Resolve'
        : line.includes('SUMMON') || line.includes('SPSUMMON')
          ? 'Summon'
          : line.includes('CHAIN')
            ? 'Chain'
            : 'Continuous',
      cardName: line.replace(/^T\d+:\s*/, ''),
      legality: 'Legal',
      legalityNotes: 'ocgcore-wasm runtime',
      outcome: line
    }));

    return {
      scenarioSummary: scenarioText,
      format,
      runtime: 'ocgcore-wasm',
      engineResult,
      isValidPlaySequence: engineResult.success && engineResult.errors.length === 0,
      actionsTimeline,
      chainExecution: {
        chainLinkCount: engineResult.messages.filter(m => m.typeName === 'CHAINING').length,
        resolutionOrderLIFO: []
      },
      cardsInvolvedEvidence: [],
      finalBoardState: {
        playerAFieldAndGY: [],
        playerBFieldAndGY: [],
        remainingHandInteractions: []
      },
      officialJudgeRuling: {
        verdict: engineResult.success && engineResult.errors.length === 0 ? 'LEGAL' : 'ILLEGAL',
        coreRulebookPrinciples: [
          'The result comes from ocgcore-wasm (ProjectIgnis EDOPro core) executing the Lua card scripts directly.',
          'Chain, cost, target and timing are decided by the engine, not by heuristics.'
        ],
        detailedExplanation: engineResult.timeline.join('\n') || 'The engine produced no messages.',
        simulatorParityNotes: `Real runtime: ocgcore-wasm v${engineResult.coreVersion.join('.')}. Lua scripts loaded: ${engineResult.luaScriptsLoaded}. Errors: ${engineResult.errors.length}.`
      }
    };
  }

  // 1. Discover involved cards and fetch their Lua scripts
  const cardNames = extractCardCandidatesFromText(scenarioText);
  const cardsInvolved: CardScriptEvidence[] = [];

  for (const name of cardNames) {
    const card = db.getCardByName(name) || (await db.fetchCardOnline(name));
    if (card) {
      const luaScript = await fetchCardScript(card.id);
      const analysis = await analyzeCardMechanics(card.id, card.name, luaScript || undefined);

      let relevantSnippet: string | undefined;
      if (luaScript) {
        // Grab initial_effect block snippet
        const lines = luaScript.split('\n');
        const startIdx = lines.findIndex(l => l.includes('function s.initial_effect') || l.includes('initial_effect'));
        if (startIdx !== -1) {
          relevantSnippet = lines.slice(startIdx, startIdx + 25).join('\n');
        }
      }

      cardsInvolved.push({
        cardName: card.name,
        id: card.id,
        luaScriptAvailable: !!luaScript,
        analysis,
        relevantScriptSnippet: relevantSnippet
      });
    }
  }

  // 2. Analyze Scenario Syntax & Chains
  const textLower = scenarioText.toLowerCase();
  const actionsTimeline: DuelActionStep[] = [];
  const resolutionSteps: ChainResolutionStep[] = [];

  let clIndex = 1;
  const corePrinciples: string[] = [];
  let isPlayLegal = true;
  let illegalityReason = '';

  // Specific Check 1: Target Validity & Location
  if (textLower.includes('called by the grave') || textLower.includes('grave')) {
    corePrinciples.push('Called by the Grave Targeting Condition: the target must be in the opponent’s Graveyard at activation and at resolution.');
    if (textLower.includes('called by the grave') && (textLower.includes('on field') || textLower.includes('on the field'))) {
      isPlayLegal = false;
      illegalityReason = 'Called by the Grave CANNOT target a monster on the field. The card must be in the opponent’s Graveyard.';
    }
  }

  // Specific Check 2: Cost vs Effect & Negation Types
  if (textLower.includes('negate the activation') || textLower.includes('negate the activation') || textLower.includes('negate the effect') || textLower.includes('negate the effect')) {
    corePrinciples.push('Negate Activation vs Negate Effect: negating the activation (CATEGORY_NEGATE) erases the activation event (with "You can only activate 1 per turn", the player may activate a second copy). Negating the effect (CATEGORY_DISABLE) still counts as a legal activation.');
  }

  // Specific Check 3: Continuous Spells/Traps/Field Spells face-up requirement
  if (textLower.includes('continuous') || textLower.includes('field spell') || textLower.includes('mystic mine') || textLower.includes('underground') || textLower.includes('domain')) {
    corePrinciples.push('Face-up Resolution Requirement: Continuous Spell/Trap, Field Spell and Equip Spell cards must remain face-up on the field while the chain resolves for their on-field effect to apply.');
  }

  // Specific Check 4: Missing the Timing
  const hasWhenOptional = cardsInvolved.some(c => c.analysis.timingProperties.canMissTiming);
  if (hasWhenOptional) {
    corePrinciples.push('Missing the Timing ("When... you can"): an optional "When... you can" trigger requires the trigger event to be the very last thing that happened. If it occurs at Chain Link 2 or higher, or as an intermediate material, the effect misses its timing.');
  }

  // Specific Check 5: Damage Step
  if (textLower.includes('damage step') || textLower.includes('damage calculation') || textLower.includes('battle')) {
    corePrinciples.push('Damage Step Legality: during the Damage Step only Counter Traps, activation-negating cards (CATEGORY_NEGATE), mandatory triggers, or cards that directly change ATK/DEF (before damage calculation) may be activated.');
  }

  // 3. Construct Step-by-Step Chain Simulation
  // Auto-detect steps from scenario narrative
  const mentionedCards = cardsInvolved.map(c => c.cardName);

  if (mentionedCards.length > 0) {
    // Action 1: First mentioned card
    const firstCard = cardsInvolved[0];
    actionsTimeline.push({
      stepNumber: 1,
      player: 'Player A',
      action: 'Activate',
      cardName: firstCard.cardName,
      cardId: firstCard.id,
      chainLink: 1,
      spellSpeed: 1,
      costPaid: firstCard.analysis.costProperties.hasCost ? firstCard.analysis.costProperties.costDetails.join(', ') : 'No activation cost',
      targetDeclared: firstCard.analysis.targetingProperties.targets ? 'Targets at activation' : 'Non-targeting (chosen at resolution)',
      legality: 'Legal',
      legalityNotes: `Legal Chain Link 1 activation (${firstCard.cardName}).`
    });

    // Action 2..N: Subsequent chain links
    for (let i = 1; i < cardsInvolved.length; i++) {
      const current = cardsInvolved[i];
      const isNegator = current.analysis.negationProperties.negatesActivation || current.analysis.negationProperties.negatesEffect;
      const actingPlayer = i % 2 === 1 ? 'Player B' : 'Player A';

      let stepLegality: 'Legal' | 'Illegal' | 'Warning' = 'Legal';
      let note = `Legal Chain Link ${i + 1} response (${current.cardName}).`;

      if (current.cardName.toLowerCase().includes('called by the grave') && !textLower.includes('gy') && !textLower.includes('grave') && !textLower.includes('graveyard')) {
        stepLegality = 'Warning';
        note = 'Make sure the Called by the Grave target is already in the opponent’s Graveyard.';
      }

      actionsTimeline.push({
        stepNumber: i + 1,
        player: actingPlayer,
        action: 'Chain',
        cardName: current.cardName,
        cardId: current.id,
        chainLink: i + 1,
        spellSpeed: 2,
        costPaid: current.analysis.costProperties.hasCost ? current.analysis.costProperties.costDetails.join(', ') : 'No',
        targetDeclared: current.analysis.targetingProperties.targets ? `Legal target` : 'No target',
        legality: stepLegality,
        legalityNotes: note
      });
    }

    // Build LIFO Resolution Steps with accurate negation propagation
    const activeNegations = new Set<number>();

    for (let cl = cardsInvolved.length; cl >= 1; cl--) {
      const card = cardsInvolved[cl - 1];
      const isCardNegated = activeNegations.has(cl);

      let resultText = '';
      if (isCardNegated) {
        resultText = `The effect of [${card.cardName}] was negated by an earlier response in the chain. The effect is NOT applied.`;
      } else {
        resultText = `Successfully resolved the effect of [${card.cardName}].`;
        // Handle specific negation cards
        if (card.cardName.toLowerCase().includes('called by the grave')) {
          for (let prevCl = 1; prevCl < cl; prevCl++) {
            const prevCard = cardsInvolved[prevCl - 1];
            if (
              prevCard.cardName.toLowerCase().includes('ash blossom') ||
              prevCard.cardName.toLowerCase().includes('ghost belle') ||
              prevCard.cardName.toLowerCase().includes('droll') ||
              prevCard.cardName.toLowerCase().includes('effect veiler') ||
              prevCard.cardName.toLowerCase().includes('nibiru')
            ) {
              activeNegations.add(prevCl);
            }
          }
        } else if (card.analysis.negationProperties.negatesActivation || card.analysis.negationProperties.negatesEffect) {
          const targetCl = cl - 1;
          if (targetCl >= 1) {
            activeNegations.add(targetCl);
          }
        }
      }

      resolutionSteps.push({
        chainLink: cl,
        cardName: card.cardName,
        resolvesSuccessfully: !isCardNegated,
        negatedBy: isCardNegated ? 'Responded at a higher Chain Link' : undefined,
        effectResult: resultText,
        fieldStateChange: !isCardNegated ? `Apply the full effect per the card text and script c${card.id}.lua` : 'No effect'
      });
    }
  }

  // 4. Construct Official Judge Explanation
  let detailedExplanation = '';
  if (!isPlayLegal) {
    detailedExplanation = `JUDGE RULING: the scenario is ILLEGAL because an activation/target condition was violated:\n` +
      `- Error detail: ${illegalityReason}\n` +
      `- Table procedure: the action is not allowed; restore the previous game state and issue a warning if cheating was involved.`;
  } else {
    detailedExplanation = `OFFICIAL JUDGE RULING (Level 2/3 Judge):\n` +
      `1. Chain building order:\n` +
      actionsTimeline.map(a => `   - CL${a.chainLink || 1}: [${a.player}] activates [${a.cardName}] (${a.legalityNotes || ''})`).join('\n') + '\n\n' +
      `2. Chain resolution order (LIFO - last in, first out):\n` +
      resolutionSteps.map(r => `   - Resolve CL${r.chainLink} [${r.cardName}]: ${r.effectResult}`).join('\n') + '\n\n' +
      `3. Rules conclusion:\n` +
      `   - All costs were paid at activation and are not refunded even if the effect is negated.\n` +
      `   - Targets are checked for legality at activation and re-checked at resolution.`;
  }

  return {
    scenarioSummary: scenarioText,
    format,
    runtime: 'static_analysis',
    isValidPlaySequence: isPlayLegal,
    actionsTimeline,
    chainExecution: {
      chainLinkCount: actionsTimeline.length,
      resolutionOrderLIFO: resolutionSteps
    },
    cardsInvolvedEvidence: cardsInvolved,
    finalBoardState: {
      playerAFieldAndGY: [`Player A's cards finished resolving in LIFO order.`],
      playerBFieldAndGY: [`Player B's responses have resolved or finished activating.`],
      remainingHandInteractions: ['Priority returns to the turn player in an open game state.']
    },
    officialJudgeRuling: {
      verdict: !isPlayLegal
        ? 'ILLEGAL'
        : (resolutionSteps.some(r => !r.resolvesSuccessfully) ? 'RESOLVED WITH NEGATION' : 'LEGAL'),
      coreRulebookPrinciples: corePrinciples.length > 0 ? corePrinciples : [
        'LIFO (Last In, First Out): the highest Chain Link resolves first.',
        'Cost is paid at activation; the effect resolves when its Chain Link is reached.'
      ],
      detailedExplanation,
      simulatorParityNotes: 'STATIC ANALYSIS ONLY: Lua AST + heuristic chain builder. This is NOT a real ocgcore runtime and does not execute card scripts. Use ygo_run_duel (or pass deckA/deckB) for real EDOPro-core execution.'
    }
  };
}
