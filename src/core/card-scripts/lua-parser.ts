import { ParsedEffect } from '../../types/lua.js';
import { analyzeLuaCard } from './lua-ast.js';

interface RawEffectRecord {
  varName: string;
  effectType: string[];
  code?: string;
  categories: string[];
  flags: string[];
  isHOPT: boolean;
  isSOPT: boolean;
  countLimit?: number;
  costRef?: string;
  targetRef?: string;
  operationRef?: string;
  conditionRef?: string;
  rawLines: string[];
  isTargeting: boolean;
}

/**
 * Extracts top-level and helper function definitions from Lua source code.
 * Maps both full names (e.g. "s.cost", "c14558127.distg") and short names ("cost", "distg").
 */
function extractFunctionBodies(luaCode: string): Map<string, string> {
  const functionMap = new Map<string, string>();
  const pattern = /(?:function\s+([a-zA-Z0-9_.]+)\s*\(|([a-zA-Z0-9_.]+)\s*=\s*function\s*\()/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(luaCode)) !== null) {
    const fullName = match[1] || match[2];
    if (!fullName) continue;

    const startPos = match.index;
    const codeSlice = luaCode.slice(startPos);

    // Track block depth for Lua functions
    let depth = 0;
    const tokenRegex = /\b(function|then|do|end)\b/g;
    let tokenMatch: RegExpExecArray | null;
    let endPos = -1;

    while ((tokenMatch = tokenRegex.exec(codeSlice)) !== null) {
      const keyword = tokenMatch[1];
      if (keyword === 'function' || keyword === 'then' || keyword === 'do') {
        depth++;
      } else if (keyword === 'end') {
        depth--;
        if (depth === 0) {
          endPos = startPos + tokenMatch.index + tokenMatch[0].length;
          break;
        }
      }
    }

    if (endPos !== -1) {
      const body = luaCode.slice(startPos, endPos);
      functionMap.set(fullName, body);
      const shortName = fullName.split('.').pop();
      if (shortName && !functionMap.has(shortName)) {
        functionMap.set(shortName, body);
      }
    }
  }

  return functionMap;
}

/**
 * Finds the body of `initial_effect(c)` in the Lua script.
 * If not present, returns the entire script.
 */
function getInitialEffectBody(luaCode: string, functionMap: Map<string, string>): { body: string; handler: string } {
  for (const key of ['s.initial_effect', 'initial_effect']) {
    const body = functionMap.get(key);
    if (body) {
      const handlerMatch = body.match(/function\s+[a-zA-Z0-9_.]+\s*\(\s*([a-zA-Z0-9_]+)\s*\)/);
      const handler = handlerMatch ? handlerMatch[1] : 'c';
      return { body, handler };
    }
  }

  // Check with regex for any c<id>.initial_effect
  const match = luaCode.match(/function\s+([a-zA-Z0-9_.]+initial_effect)\s*\(\s*([a-zA-Z0-9_]+)\s*\)/);
  if (match) {
    const fnName = match[1];
    const handler = match[2];
    const body = functionMap.get(fnName);
    if (body) {
      return { body, handler };
    }
  }

  return { body: luaCode, handler: 'c' };
}

/**
 * Analyzes cost reference and function body to generate a descriptive string.
 */
function analyzeCost(
  costRef: string | undefined,
  functionMap: Map<string, string>,
  cardPasscode: number
): string | undefined {
  if (!costRef) return undefined;

  const costRefTrimmed = costRef.trim();

  // 1. Direct standard Cost library patterns
  if (costRefTrimmed.includes('Cost.SelfDiscard')) {
    return 'Discards itself as cost';
  }
  if (costRefTrimmed.includes('Cost.SelfToGrave')) {
    return 'Sends itself to GY as cost';
  }
  if (costRefTrimmed.includes('Cost.SelfRelease') || costRefTrimmed.includes('aux.selfreleasecost')) {
    return 'Tributes itself as cost';
  }
  if (costRefTrimmed.includes('Cost.SelfRemove') || costRefTrimmed.includes('aux.bfgcost')) {
    return 'Banishes itself as cost';
  }
  if (costRefTrimmed.includes('Cost.Discard')) {
    return 'Discards card(s) as cost';
  }
  if (costRefTrimmed.includes('Cost.PayLP')) {
    return 'Pays LP as cost';
  }
  if (costRefTrimmed.includes('Cost.Release')) {
    return 'Tributes monster(s) as cost';
  }
  if (costRefTrimmed.includes('Cost.Remove')) {
    return 'Banishes card(s) as cost';
  }
  if (costRefTrimmed.includes('Cost.ToGrave')) {
    return 'Sends card(s) to GY as cost';
  }
  if (costRefTrimmed.includes('aux.dxendcost')) {
    return 'Returns card(s) to Deck as cost';
  }

  // 2. Lookup referenced cost function
  let funcBody: string | undefined;
  if (costRefTrimmed.startsWith('function')) {
    funcBody = costRefTrimmed;
  } else {
    funcBody = functionMap.get(costRefTrimmed) || functionMap.get(costRefTrimmed.split('.').pop() || '');
  }

  if (funcBody) {
    const actions: string[] = [];

    // Discard check
    if (
      /Duel\.DiscardHand\s*\([^)]*REASON_COST/.test(funcBody) ||
      /Duel\.Send(?:to|To)Grave\s*\([^)]*REASON_COST\s*[+|]\s*REASON_DISCARD/.test(funcBody) ||
      (/IsDiscardable/.test(funcBody) && /REASON_COST/.test(funcBody))
    ) {
      if (/GetHandler\(\):IsDiscardable/.test(funcBody) || /c:IsDiscardable/.test(funcBody)) {
        actions.push('Discards itself as cost');
      } else {
        actions.push('Discards card(s) as cost');
      }
    }
    // Send to GY check
    else if (
      /Duel\.Send(?:to|To)Grave\s*\([^)]*REASON_COST/.test(funcBody) ||
      /IsAbleToGraveAsCost/.test(funcBody)
    ) {
      if (/GetHandler\(\):IsAbleToGraveAsCost/.test(funcBody) || /c:IsAbleToGraveAsCost/.test(funcBody)) {
        actions.push('Sends itself to GY as cost');
      } else {
        actions.push('Sends card(s) to GY as cost');
      }
    }

    // Pay LP check
    if (/Duel\.PayLPCost/.test(funcBody)) {
      if (/Duel\.GetLP\(tp\)\/2/.test(funcBody) || /math\.floor\(Duel\.GetLP\(tp\)\/2\)/.test(funcBody)) {
        actions.push('Pays half LP as cost');
      } else {
        actions.push('Pays LP as cost');
      }
    }

    // Tribute / Release check
    if (/Duel\.Release\s*\([^)]*REASON_COST/.test(funcBody) || (/IsReleasableByEffect/.test(funcBody) && /REASON_COST/.test(funcBody))) {
      if (/GetHandler\(\)/.test(funcBody)) {
        actions.push('Tributes itself as cost');
      } else {
        actions.push('Tributes monster(s) as cost');
      }
    }

    // Banish / Remove check
    if (/Duel\.Remove\s*\([^)]*REASON_COST/.test(funcBody) || /IsAbleToRemoveAsCost/.test(funcBody)) {
      if (/GetHandler\(\)/.test(funcBody)) {
        actions.push('Banishes itself as cost');
      } else {
        actions.push('Banishes card(s) as cost');
      }
    }

    // Detach overlay material
    if (/RemoveOverlayCard/.test(funcBody) || /CheckRemoveOverlayCard/.test(funcBody)) {
      actions.push('Detaches Xyz material(s) as cost');
    }

    // Return to deck / hand
    if (/Duel\.Send(?:to|To)Deck\s*\([^)]*REASON_COST/.test(funcBody)) {
      actions.push('Returns card(s) to Deck as cost');
    }
    if (/Duel\.Send(?:to|To)Hand\s*\([^)]*REASON_COST/.test(funcBody)) {
      actions.push('Returns card(s) to hand as cost');
    }

    // Reveal
    if (/Duel\.ConfirmCards/.test(funcBody)) {
      actions.push('Reveals card(s) in hand as cost');
    }

    if (actions.length > 0) {
      return actions.join('; ');
    }

    return `Custom cost (${costRefTrimmed})`;
  }

  return `Cost: ${costRefTrimmed}`;
}

/**
 * Analyzes target function to check targeting behavior and description.
 */
function analyzeTarget(
  targetRef: string | undefined,
  flags: string[],
  functionMap: Map<string, string>
): { isTargeting: boolean; description?: string } {
  let isTargeting = flags.includes('EFFECT_FLAG_CARD_TARGET');
  let description: string | undefined;

  let funcBody: string | undefined;
  if (targetRef) {
    const trimmed = targetRef.trim();
    if (trimmed.startsWith('function')) {
      funcBody = trimmed;
    } else {
      funcBody = functionMap.get(trimmed) || functionMap.get(trimmed.split('.').pop() || '');
    }
  }

  if (funcBody) {
    if (
      funcBody.includes('Duel.SelectTarget') ||
      funcBody.includes('Duel.GetFirstTarget') ||
      funcBody.includes('IsCanBeEffectTarget')
    ) {
      isTargeting = true;
    }

    const targetDetails: string[] = [];
    if (isTargeting) {
      if (/LOCATION_MZONE/.test(funcBody)) {
        targetDetails.push('Targets monster(s) on the field');
      } else if (/LOCATION_GRAVE/.test(funcBody)) {
        targetDetails.push('Targets card(s) in the GY');
      } else if (/LOCATION_ONFIELD/.test(funcBody)) {
        targetDetails.push('Targets card(s) on the field');
      } else {
        targetDetails.push('Targets card(s)');
      }
    }

    // Category operation info
    const opInfoRegex = /Duel\.SetOperationInfo\s*\(\s*\d+\s*,\s*(CATEGORY_[A-Z0-9_]+)/g;
    const opCats: string[] = [];
    let opMatch: RegExpExecArray | null;
    while ((opMatch = opInfoRegex.exec(funcBody)) !== null) {
      if (!opCats.includes(opMatch[1])) {
        opCats.push(opMatch[1]);
      }
    }
    if (opCats.length > 0) {
      targetDetails.push(`Sets operation info for ${opCats.join(', ')}`);
    }

    if (targetDetails.length > 0) {
      description = targetDetails.join('; ');
    }
  } else if (isTargeting) {
    description = 'Targets card(s) (EFFECT_FLAG_CARD_TARGET)';
  }

  return { isTargeting, description };
}

/**
 * Analyzes operation function to identify major effect actions.
 */
function analyzeOperation(
  operationRef: string | undefined,
  functionMap: Map<string, string>
): string | undefined {
  if (!operationRef) return undefined;

  const trimmed = operationRef.trim();
  let funcBody: string | undefined;
  if (trimmed.startsWith('function')) {
    funcBody = trimmed;
  } else {
    funcBody = functionMap.get(trimmed) || functionMap.get(trimmed.split('.').pop() || '');
  }

  if (!funcBody) {
    return `Executes ${trimmed}`;
  }

  const actions: string[] = [];

  if (/Duel\.NegateEffect/.test(funcBody)) {
    actions.push('Negates the activated effect');
  }
  if (/Duel\.NegateActivation/.test(funcBody)) {
    actions.push('Negates the activation');
  }
  if (/Duel\.NegateSummon/.test(funcBody)) {
    actions.push('Negates the summon');
  }
  if (/EFFECT_DISABLE/.test(funcBody) || /EFFECT_DISABLE_EFFECT/.test(funcBody) || /Duel\.NegateRelatedChain/.test(funcBody)) {
    actions.push('Negates monster/card effects');
  }
  if (/Duel\.Release\s*\([^)]*REASON_EFFECT/.test(funcBody) || /Duel\.Release/.test(funcBody)) {
    actions.push('Tributes monster(s) as effect');
  }
  if (/Duel\.Destroy\s*\([^)]*REASON_EFFECT/.test(funcBody) || /Duel\.Destroy/.test(funcBody)) {
    actions.push('Destroys card(s) as effect');
  }
  if (/Duel\.CreateToken/.test(funcBody)) {
    actions.push('Special Summons Token(s)');
  }
  if (/Duel\.SpecialSummon/.test(funcBody)) {
    actions.push('Special Summons monster(s)');
  }
  if (/Duel\.Draw/.test(funcBody)) {
    actions.push('Draws card(s)');
  }
  if (/Duel\.Send(?:to|To)Grave\s*\([^)]*REASON_EFFECT/.test(funcBody)) {
    actions.push('Sends card(s) to GY as effect');
  }
  if (/Duel\.DiscardHand\s*\([^)]*REASON_EFFECT/.test(funcBody)) {
    actions.push('Discards card(s) as effect');
  }
  if (/Duel\.Send(?:to|To)Hand/.test(funcBody)) {
    actions.push('Adds card(s) to hand');
  }
  if (/Duel\.Remove\s*\([^)]*REASON_EFFECT/.test(funcBody) || (/Duel\.Remove/.test(funcBody) && !/REASON_COST/.test(funcBody))) {
    actions.push('Banishes card(s) as effect');
  }
  if (/Duel\.Damage/.test(funcBody)) {
    actions.push('Inflicts damage');
  }
  if (/Duel\.Recover/.test(funcBody)) {
    actions.push('Recovers LP');
  }

  return actions.length > 0 ? actions.join('; ') : `Resolves effect (${trimmed})`;
}

/**
 * Parses Lua code for Yu-Gi-Oh card effects.
 */
function parseCardLuaLegacy(luaCode: string, passcode: number): ParsedEffect[] {
  const functionMap = extractFunctionBodies(luaCode);
  const { body: initialBody, handler } = getInitialEffectBody(luaCode, functionMap);

  // Map to track effect variables during construction
  const effectMap = new Map<string, RawEffectRecord>();
  // Ordered list of registered effects snapshots
  const registeredSnapshots: RawEffectRecord[] = [];

  const lines = initialBody.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Strip full-line comments or ignore empty
    if (!trimmed || trimmed.startsWith('--')) continue;

    // 1. Detect Effect.CreateEffect(c)
    const createMatch = trimmed.match(/(?:local\s+)?([a-zA-Z0-9_]+)\s*=\s*Effect\.CreateEffect\s*\(([^)]*)\)/);
    if (createMatch) {
      const varName = createMatch[1];
      const record: RawEffectRecord = {
        varName,
        effectType: [],
        categories: [],
        flags: [],
        isHOPT: false,
        isSOPT: false,
        rawLines: [rawLine],
        isTargeting: false,
      };
      effectMap.set(varName, record);
      continue;
    }

    // 2. Detect Cloning: local e2 = e1:Clone()
    const cloneMatch = trimmed.match(/(?:local\s+)?([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+):Clone\s*\(\)/);
    if (cloneMatch) {
      const destVar = cloneMatch[1];
      const srcVar = cloneMatch[2];
      const srcRecord = effectMap.get(srcVar);

      const record: RawEffectRecord = {
        varName: destVar,
        effectType: srcRecord ? [...srcRecord.effectType] : [],
        code: srcRecord?.code,
        categories: srcRecord ? [...srcRecord.categories] : [],
        flags: srcRecord ? [...srcRecord.flags] : [],
        isHOPT: srcRecord ? srcRecord.isHOPT : false,
        isSOPT: srcRecord ? srcRecord.isSOPT : false,
        countLimit: srcRecord?.countLimit,
        costRef: srcRecord?.costRef,
        targetRef: srcRecord?.targetRef,
        operationRef: srcRecord?.operationRef,
        conditionRef: srcRecord?.conditionRef,
        rawLines: [rawLine],
        isTargeting: srcRecord ? srcRecord.isTargeting : false,
      };
      effectMap.set(destVar, record);
      continue;
    }

    // 3. Detect Method Calls on Effect Variables: e1:Set...
    const methodMatch = trimmed.match(/^([a-zA-Z0-9_]+):(Set[a-zA-Z0-9_]+)\s*\(([\s\S]*)/);
    if (methodMatch) {
      const targetVar = methodMatch[1];
      const method = methodMatch[2];
      let rest = methodMatch[3];

      const record = effectMap.get(targetVar);
      if (record) {
        // Collect full argument including multi-line
        let parenDepth = 1;
        let argStr = '';
        let lineIdx = i;
        let lineSlice = rest;

        while (parenDepth > 0 && lineIdx < lines.length) {
          for (let c = 0; c < lineSlice.length; c++) {
            const ch = lineSlice[c];
            if (ch === '(') parenDepth++;
            else if (ch === ')') {
              parenDepth--;
              if (parenDepth === 0) {
                argStr += lineSlice.slice(0, c);
                break;
              }
            }
          }
          if (parenDepth > 0) {
            argStr += lineSlice + '\n';
            lineIdx++;
            if (lineIdx < lines.length) {
              lineSlice = lines[lineIdx];
              record.rawLines.push(lines[lineIdx]);
            }
          }
        }
        i = lineIdx;
        record.rawLines.push(rawLine);

        const cleanArgs = argStr.trim();

        // Process setters
        if (method === 'SetType') {
          const types = cleanArgs
            .split(/[+|]/)
            .map((t) => t.trim())
            .filter((t) => t.startsWith('EFFECT_TYPE_'));
          record.effectType = types;
        } else if (method === 'SetCode') {
          record.code = cleanArgs.trim();
        } else if (method === 'SetCategory') {
          const cats = cleanArgs
            .split(/[+|]/)
            .map((c) => c.trim())
            .filter((c) => c.startsWith('CATEGORY_'));
          record.categories = cats;
        } else if (method === 'SetProperty') {
          const props = cleanArgs
            .split(/[+|]/)
            .map((p) => p.trim())
            .filter((p) => p.startsWith('EFFECT_FLAG_'));
          record.flags = props;
          if (props.includes('EFFECT_FLAG_CARD_TARGET')) {
            record.isTargeting = true;
          }
        } else if (method === 'SetCountLimit') {
          const countParts = cleanArgs.split(',').map((p) => p.trim());
          const countVal = parseInt(countParts[0], 10);
          if (!isNaN(countVal)) {
            record.countLimit = countVal;
          }

          if (countParts.length >= 2) {
            const secondArg = countParts.slice(1).join(',');
            if (secondArg.includes('EFFECT_COUNT_CODE_SINGLE')) {
              record.isSOPT = true;
              record.isHOPT = false;
            } else if (
              secondArg.includes('id') ||
              secondArg.includes(String(passcode)) ||
              secondArg.includes('EFFECT_COUNT_CODE_OATH') ||
              secondArg.includes('EFFECT_COUNT_CODE_DUEL') ||
              /\d{6,8}/.test(secondArg)
            ) {
              record.isHOPT = true;
              record.isSOPT = false;
            } else {
              record.isHOPT = true;
              record.isSOPT = false;
            }
          } else {
            record.isSOPT = true;
            record.isHOPT = false;
          }
        } else if (method === 'SetCost') {
          record.costRef = cleanArgs;
        } else if (method === 'SetTarget') {
          record.targetRef = cleanArgs;
        } else if (method === 'SetOperation') {
          record.operationRef = cleanArgs;
        } else if (method === 'SetCondition') {
          record.conditionRef = cleanArgs;
        }
      }
      continue;
    }

    // 4. Detect Registration: c:RegisterEffect(e1)
    const regMatch = trimmed.match(new RegExp(`\\b${handler}:RegisterEffect\\s*\\(\\s*([a-zA-Z0-9_]+)`));
    if (regMatch) {
      const regVar = regMatch[1];
      const rec = effectMap.get(regVar);
      if (rec) {
        rec.rawLines.push(rawLine);
        registeredSnapshots.push({
          ...rec,
          effectType: [...rec.effectType],
          categories: [...rec.categories],
          flags: [...rec.flags],
          rawLines: [...rec.rawLines],
        });
      }
    }
  }

  // Fallback to all effects in effectMap if no explicit c:RegisterEffect was found
  const finalRecords =
    registeredSnapshots.length > 0 ? registeredSnapshots : Array.from(effectMap.values());

  return finalRecords.map((rec, index) => {
    const costDescription = analyzeCost(rec.costRef, functionMap, passcode);
    const targetInfo = analyzeTarget(rec.targetRef, rec.flags, functionMap);
    const operationDescription = analyzeOperation(rec.operationRef, functionMap);

    return {
      index: index + 1,
      effectType: rec.effectType,
      code: rec.code,
      categories: rec.categories,
      flags: rec.flags,
      isHOPT: rec.isHOPT,
      isSOPT: rec.isSOPT,
      countLimit: rec.countLimit,
      isTargeting: rec.isTargeting || targetInfo.isTargeting,
      costDescription,
      targetDescription: targetInfo.description,
      operationDescription,
      rawSnippet: rec.rawLines.join('\n'),
    };
  });
}

/**
 * AST-first parser. Falls back to the legacy regex parser only when Lua parsing
 * fails or the AST yields no effects.
 */
export function parseCardLua(luaCode: string, passcode: number): ParsedEffect[] {
  const analysis = analyzeLuaCard(luaCode, passcode);
  if (analysis.parsed && analysis.effects.length > 0) {
    return analysis.effects;
  }
  return parseCardLuaLegacy(luaCode, passcode);
}
