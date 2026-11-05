/**
 * Deep Lua AST analyzer for Yu-Gi-Oh ocgcore card scripts.
 *
 * Unlike the legacy regex parser, this understands:
 * - function declarations and inline function expressions
 * - Effect.CreateEffect / :Clone() / :Set* chains
 * - condition / cost / target / operation function references
 * - Fusion/Synchro/Xyz/Link/Pendulum summon procedures
 * - simulator-specific globals (Link/Xyz/Synchro/Fusion, aux.*, proc_*.lua)
 * - Duel.* / Card.* / Group:* API calls
 * - constants (EFFECT_*, EVENT_*, CATEGORY_*, LOCATION_*, TYPE_*, REASON_*)
 *
 * The output is deliberately simulator-agnostic: it reports what the script does
 * and flags constructs that require a specific engine/library.
 */

import luaparse from 'luaparse';
import type {
  LuaApiCall,
  LuaCardAnalysis,
  LuaFunctionInfo,
  LuaSummonProcedure,
  ParsedEffect
} from '../../types/lua.js';

type AnyNode = any;

interface FunctionInfo {
  name: string;
  params: string[];
  body: AnyNode[];
  node: AnyNode;
}

interface EffectRecord {
  varName: string;
  line: number;
  factory?: string;
  factoryArgs?: string;
  effectType: string[];
  code?: string;
  categories: string[];
  flags: string[];
  countLimit?: number;
  countLimitText?: string;
  countLimitCode?: string;
  isHOPT: boolean;
  isSOPT: boolean;
  isOncePerDuel: boolean;
  range?: string;
  value?: string;
  label?: string;
  hintTiming?: string;
  descriptionId?: number;
  reset?: string;
  costRef?: string;
  costNode?: AnyNode;
  targetRef?: string;
  targetNode?: AnyNode;
  operationRef?: string;
  operationNode?: AnyNode;
  conditionRef?: string;
  conditionNode?: AnyNode;
  raw: string[];
}

const EFFECT_CONSTANT_PREFIXES: Record<string, string> = {
  EFFECT_TYPE_: 'effectTypes',
  EFFECT_: 'effectTypes',
  EVENT_: 'events',
  CATEGORY_: 'categories',
  LOCATION_: 'locations',
  TYPE_: 'types',
  REASON_: 'reasons',
  SUMMON_TYPE_: 'summonTypes',
  POS_: 'positions',
  PHASE_: 'phases'
};

function parseLua(src: string): AnyNode | null {
  // ocgcore scripts are usually Lua 5.3, but older simulators ship 5.2/5.1-style scripts.
  for (const version of ['5.3', '5.2', '5.1'] as const) {
    try {
      return luaparse.parse(src, {
        luaVersion: version,
        locations: true,
        ranges: true,
        comments: false,
        scope: false
      });
    } catch {
      // Try the next dialect.
    }
  }
  return null;
}

function nodeName(node: AnyNode): string {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') {
    const base = nodeName(node.base);
    const suffix = nodeName(node.identifier);
    return base ? `${base}${node.indexer === ':' ? ':' : '.'}${suffix}` : suffix;
  }
  return '';
}

function callName(call: AnyNode): string {
  return nodeName(call?.base);
}

function argText(node: AnyNode): string {
  if (!node) return '';
  switch (node.type) {
    case 'StringLiteral': {
      const value = node.value ?? (typeof node.raw === 'string' ? node.raw.slice(1, -1) : '');
      return JSON.stringify(value);
    }
    case 'NumericLiteral':
      return String(node.value);
    case 'BooleanLiteral':
      return String(node.value);
    case 'NilLiteral':
      return 'nil';
    case 'Identifier':
      return node.name;
    case 'MemberExpression':
      return nodeName(node);
    case 'VarargLiteral':
      return '...';
    case 'BinaryExpression':
      return `${argText(node.left)} ${node.operator} ${argText(node.right)}`;
    case 'LogicalExpression':
      return `${argText(node.left)} ${node.operator} ${argText(node.right)}`;
    case 'UnaryExpression':
      return `${node.operator}${argText(node.argument)}`;
    case 'CallExpression':
      return `${callName(node)}(${(node.arguments || []).map(argText).join(', ')})`;
    case 'FunctionExpression':
      return `function(${(node.parameters || []).map((p: AnyNode) => p.name).join(', ')}) ... end`;
    case 'TableExpression':
      return '{...}';
    case 'IndexExpression':
      return `${argText(node.base)}[${argText(node.index)}]`;
    default:
      return node.type;
  }
}

function stringValue(node: AnyNode): string | undefined {
  if (!node || node.type !== 'StringLiteral') return undefined;
  if (typeof node.value === 'string') return node.value;
  if (typeof node.raw === 'string') return node.raw.slice(1, -1);
  return undefined;
}

function numericValue(node: AnyNode): number | undefined {
  if (!node) return undefined;
  if (node.type === 'NumericLiteral') return Number(node.value);
  if (node.type === 'UnaryExpression' && node.operator === '-') {
    const v = numericValue(node.argument);
    return v === undefined ? undefined : -v;
  }
  return undefined;
}

function walk(node: AnyNode, visit: (n: AnyNode) => void): void {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const value = (node as any)[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

function collectCallsIn(body: AnyNode[]): AnyNode[] {
  const calls: AnyNode[] = [];
  for (const stmt of body || []) {
    walk(stmt, node => {
      if (node.type === 'CallExpression') calls.push(node);
    });
  }
  return calls;
}

/** Walks a statement without descending into nested function bodies (scope-safe). */
function walkShallow(node: AnyNode, visit: (n: AnyNode) => void): void {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') return;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const value = (node as any)[key];
    if (Array.isArray(value)) {
      for (const child of value) walkShallow(child, visit);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walkShallow(value, visit);
    }
  }
}

function collectCallsShallow(body: AnyNode[]): AnyNode[] {
  const calls: AnyNode[] = [];
  for (const stmt of body || []) {
    walkShallow(stmt, node => {
      if (node.type === 'CallExpression') calls.push(node);
    });
  }
  return calls;
}

function collectCallsDeep(node: AnyNode): AnyNode[] {
  const calls: AnyNode[] = [];
  walk(node, n => {
    if (n.type === 'CallExpression') calls.push(n);
  });
  return calls;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function functionRole(name: string, node: AnyNode): LuaFunctionInfo['role'] {
  const lower = name.toLowerCase();
  if (lower.includes('initial_effect')) return 'initial_effect';
  if (lower.includes('condition') || lower.endsWith('.con') || lower.endsWith('.con2') || lower.includes('con')) return 'condition';
  if (lower.includes('cost')) return 'cost';
  if (lower.includes('target') || lower.endsWith('.tg') || lower.includes('tg')) return 'target';
  if (lower.includes('operation') || lower.includes('oper') || lower.endsWith('.op')) return 'operation';
  if (lower.includes('filter')) return 'filter';
  if (lower.includes('summon') || lower.includes('procedure') || lower.includes('proc')) return 'summon';
  return 'helper';
}

function describeCostFromCalls(calls: AnyNode[]): string | undefined {
  const names = calls.map(callName);
  const has = (n: string) => names.some(x => x === n || x.endsWith(`.${n}`));
  const actions: string[] = [];

  if (has('Cost.SelfDiscard') || has('Cost.SelfToGrave')) actions.push('Discards/sends itself as cost');
  if (has('Cost.SelfRelease') || has('aux.selfreleasecost')) actions.push('Tributes itself as cost');
  if (has('Cost.SelfRemove') || has('aux.bfgcost')) actions.push('Banishes itself as cost');
  if (has('Duel.DiscardHand') && calls.some(c => argText(c).includes('REASON_COST'))) actions.push('Discards card(s) as cost');
  if (has('Duel.PayLPCost') || has('Cost.PayLP')) actions.push('Pays LP as cost');
  if (has('Duel.Release') && calls.some(c => argText(c).includes('REASON_COST'))) actions.push('Tributes monster(s) as cost');
  if (has('Duel.Remove') && calls.some(c => argText(c).includes('REASON_COST'))) actions.push('Banishes card(s) as cost');
  if (has('Duel.SendtoGrave') && calls.some(c => argText(c).includes('REASON_COST'))) actions.push('Sends card(s) to GY as cost');
  if (has('Duel.SendToGrave') && calls.some(c => argText(c).includes('REASON_COST'))) actions.push('Sends card(s) to GY as cost');
  if (has('Duel.SendtoDeck') && calls.some(c => argText(c).includes('REASON_COST'))) actions.push('Returns card(s) to Deck as cost');
  if (has('Duel.SendtoHand') && calls.some(c => argText(c).includes('REASON_COST'))) actions.push('Returns card(s) to hand as cost');
  if (has('RemoveOverlayCard') || has('CheckRemoveOverlayCard')) actions.push('Detaches Xyz material(s) as cost');
  if (has('Duel.ConfirmCards')) actions.push('Reveals card(s) as cost');

  return actions.length > 0 ? unique(actions).join('; ') : undefined;
}

function describeTargetFromCalls(calls: AnyNode[], flags: string[]): { isTargeting: boolean; description?: string } {
  const names = calls.map(callName);
  const has = (n: string) => names.some(x => x === n || x.endsWith(`.${n}`));
  let isTargeting = flags.includes('EFFECT_FLAG_CARD_TARGET');
  const details: string[] = [];

  if (has('Duel.SelectTarget') || has('Duel.IsExistingTarget')) isTargeting = true;
  if (isTargeting) {
    const text = calls.map(argText).join(' ');
    if (text.includes('LOCATION_MZONE')) details.push('Targets monster(s) on the field');
    else if (text.includes('LOCATION_GRAVE')) details.push('Targets card(s) in the GY');
    else if (text.includes('LOCATION_REMOVED')) details.push('Targets banished card(s)');
    else if (text.includes('LOCATION_ONFIELD')) details.push('Targets card(s) on the field');
    else details.push('Targets card(s)');
  }

  const opCats = unique(
    calls
      .filter(c => callName(c) === 'Duel.SetOperationInfo')
      .map(c => (c.arguments || []).map(argText).join(' '))
      .flatMap(t => t.match(/CATEGORY_[A-Z0-9_]+/g) || [])
  );
  if (opCats.length > 0) details.push(`Sets operation info for ${opCats.join(', ')}`);

  return { isTargeting, description: details.length > 0 ? details.join('; ') : undefined };
}

function describeOperationFromCalls(calls: AnyNode[]): string | undefined {
  const names = calls.map(callName);
  const has = (n: string) => names.some(x => x === n || x.endsWith(`.${n}`));
  const actions: string[] = [];

  if (has('Duel.NegateEffect')) actions.push('Negates the activated effect');
  if (has('Duel.NegateActivation')) actions.push('Negates the activation');
  if (has('Duel.NegateSummon')) actions.push('Negates the summon');
  if (has('Duel.DisableEffect') || has('Duel.NegateRelatedChain')) actions.push('Disables/negates monster effects');
  if (has('Duel.Release') || has('Duel.Tribute')) actions.push('Tributes monster(s) as effect');
  if (has('Duel.Destroy')) actions.push('Destroys card(s) as effect');
  if (has('Duel.CreateToken')) actions.push('Special Summons Token(s)');
  if (has('Duel.SpecialSummon')) actions.push('Special Summons monster(s)');
  if (has('Duel.Draw')) actions.push('Draws card(s)');
  if (has('Duel.DiscardHand')) actions.push('Discards card(s) as effect');
  if (has('Duel.SendtoGrave') || has('Duel.SendToGrave')) actions.push('Sends card(s) to GY as effect');
  if (has('Duel.SendtoHand') || has('Duel.SendToHand')) actions.push('Adds/returns card(s) to hand');
  if (has('Duel.SendtoDeck') || has('Duel.SendToDeck')) actions.push('Returns card(s) to Deck');
  if (has('Duel.Remove')) actions.push('Banishes card(s) as effect');
  if (has('Duel.Damage')) actions.push('Inflicts damage');
  if (has('Duel.Recover')) actions.push('Recovers LP');
  if (has('Duel.ChangePosition')) actions.push('Changes battle position');
  if (has('Duel.Equip')) actions.push('Equips a card');
  if (has('Duel.Overlay')) actions.push('Attaches Xyz material');
  if (has('Duel.MoveToField')) actions.push('Places a card on the field');
  if (has('Duel.ChangeAttackTarget')) actions.push('Redirects an attack');
  if (has('Duel.GetControl') || has('Duel.GiveControl')) actions.push('Changes control');

  return actions.length > 0 ? unique(actions).join('; ') : undefined;
}

function describeConditionFromCalls(calls: AnyNode[]): string | undefined {
  const names = calls.map(callName);
  const has = (n: string) => names.some(x => x === n || x.endsWith(`.${n}`));
  const details: string[] = [];

  if (has('Duel.IsExistingMatchingCard') || has('Duel.IsExistingTarget')) details.push('Requires a matching card/target');
  if (has('Duel.GetLocationCount') || has('Duel.GetLocationCountFromEx')) details.push('Requires an available zone');
  if (has('Duel.IsPhase') || has('Duel.IsBattlePhase') || has('Duel.IsMainPhase')) details.push('Phase-restricted');
  if (has('Duel.IsTurnPlayer')) details.push('Turn-player restricted');
  if (has('Duel.GetCurrentChain') || has('Duel.GetChainInfo')) details.push('Chain-link condition');
  if (has('Duel.GetFieldGroupCount') || has('Duel.GetMatchingGroupCount')) details.push('Field/group count condition');
  if (has('Duel.IsEnvironment') || has('Duel.IsExistingMatchingCard')) details.push('Inspects the field/deck/GY');
  if (has('Duel.IsChainNegatable')) details.push('Only while the chain is negatable');

  return details.length > 0 ? unique(details).join('; ') : undefined;
}

function spellSpeedFor(effectType: string[], code: string | undefined): 1 | 2 | 3 {
  if (effectType.includes('EFFECT_TYPE_QUICK_O') || effectType.includes('EFFECT_TYPE_QUICK_F')) return 2;
  if (effectType.includes('EFFECT_TYPE_ACTIVATE')) {
    if (code?.includes('EVENT_CHAINING') || code?.includes('EVENT_FREE_CHAIN')) return 2;
    return 1;
  }
  return 1;
}

function extractFunctions(ast: AnyNode): Map<string, FunctionInfo> {
  const map = new Map<string, FunctionInfo>();
  const add = (name: string, node: AnyNode) => {
    if (!name) return;
    const info: FunctionInfo = {
      name,
      params: (node.parameters || []).map((p: AnyNode) => p.name),
      body: node.body || [],
      node
    };
    map.set(name, info);
    const short = name.split('.').pop();
    if (short && !map.has(short)) map.set(short, info);
  };

  walk(ast, node => {
    if (node.type === 'FunctionDeclaration') {
      add(nodeName(node.identifier), node);
    }
    if ((node.type === 'LocalStatement' || node.type === 'AssignmentStatement') && node.init) {
      for (let i = 0; i < node.variables.length; i++) {
        const init = node.init[i];
        if (init?.type === 'FunctionExpression') {
          add(nodeName(node.variables[i]), init);
        }
      }
    }
  });
  return map;
}

function resolveFunction(refNode: AnyNode | undefined, functions: Map<string, FunctionInfo>): FunctionInfo | undefined {
  if (!refNode) return undefined;
  if (refNode.type === 'FunctionExpression') {
    return { name: 'inline', params: (refNode.parameters || []).map((p: AnyNode) => p.name), body: refNode.body || [], node: refNode };
  }
  if (refNode.type === 'Identifier' || refNode.type === 'MemberExpression') {
    const name = nodeName(refNode);
    // Built-in helper functions are not card-local; treat them as resolved.
    if (/^(Cost|Duel|aux|Card|Group)\./.test(name)) {
      return { name, params: [], body: [], node: refNode };
    }
    return functions.get(name) || functions.get(name.split('.').pop() || '');
  }
  if (refNode.type === 'CallExpression') {
    // Library helper such as aux.bfgcost / Cost.SelfDiscard; no body available.
    return { name: callName(refNode), params: [], body: [], node: refNode };
  }
  return undefined;
}

/**
 * Main entry: parse and analyze a card script.
 */
export function analyzeLuaCard(luaCode: string, passcode: number): LuaCardAnalysis {
  const empty: LuaCardAnalysis = {
    parsed: false,
    simulatorProfile: {
      engine: 'unknown',
      loadedLibraries: [],
      usesProcLibraries: false,
      usesAux: false,
      usesLegacyGlobals: false,
      notes: []
    },
    functions: [],
    effects: [],
    summonProcedures: [],
    apiCalls: [],
    constants: {
      effectTypes: [],
      events: [],
      categories: [],
      locations: [],
      types: [],
      reasons: []
    },
    setcodes: [],
    warnings: [],
    stats: { lineCount: luaCode.split('\n').length, functionCount: 0, effectCount: 0, apiCallCount: 0 }
  };

  const ast = parseLua(luaCode);
  if (!ast) {
    return { ...empty, parseError: 'Lua parse failed (syntax error or unsupported Lua version).' };
  }

  const allNodes: AnyNode[] = [];
  walk(ast, n => allNodes.push(n));
  const allCalls: AnyNode[] = allNodes.filter(n => n.type === 'CallExpression');
  const functions = extractFunctions(ast);
  const initialEffectFn = functions.get('s.initial_effect') || functions.get('initial_effect');
  const effectScopeBody = initialEffectFn?.body || ast.body;
  const effectCalls = collectCallsShallow(effectScopeBody);

  const effectRecords = new Map<string, EffectRecord>();
  const orderedRecords: EffectRecord[] = [];

  // 1. Create effect records (scope-safe: only initial_effect, not helper functions).
  for (const stmt of effectScopeBody) walkShallow(stmt, node => {
    if ((node.type === 'LocalStatement' || node.type === 'AssignmentStatement') && node.init) {
      for (let i = 0; i < node.variables.length; i++) {
        const init = node.init[i];
        if (!init) continue;
        if (init.type === 'CallExpression') {
          const factory = callName(init);
          const isEffectFactory =
            factory === 'Effect.CreateEffect' ||
            /\.CreateSummonEff$/.test(factory);
          if (isEffectFactory) {
            const varName = nodeName(node.variables[i]);
            effectRecords.set(varName, {
              varName,
              line: node.loc?.start?.line || 0,
              factory,
              factoryArgs: (init.arguments || []).map(argText).join(', '),
              // Summon-effect factories generate an activation/ignition effect internally.
              effectType: factory === 'Effect.CreateEffect' ? [] : ['EFFECT_TYPE_ACTIVATE'],
              categories: [],
              flags: [],
              isHOPT: false,
              isSOPT: false,
              isOncePerDuel: false,
              raw: []
            });
          }
        }
        // Clone: local e2 = e1:Clone()
        if (init.type === 'CallExpression' && nodeName(init.base).endsWith(':Clone')) {
          const dest = nodeName(node.variables[i]);
          const srcName = nodeName(init.base).replace(/:Clone$/, '');
          const src = effectRecords.get(srcName);
          if (src) {
            effectRecords.set(dest, {
              ...src,
              varName: dest,
              effectType: [...src.effectType],
              categories: [...src.categories],
              flags: [...src.flags],
              raw: [...src.raw]
            });
          }
        }
      }
    }
  });

  // 2. Apply :Set* methods in source order (only calls in initial_effect).
  for (const call of effectCalls) {
    const name = callName(call);
    const colon = name.lastIndexOf(':');
    const dot = name.lastIndexOf('.');
    const sep = Math.max(colon, dot);
    if (sep <= 0) continue;
    const base = name.slice(0, sep);
    const method = name.slice(sep + 1);
    const rec = effectRecords.get(base);
    if (!rec || !method.startsWith('Set')) continue;

    rec.raw.push(`${name}(${(call.arguments || []).map(argText).join(', ')})`);

    switch (method) {
      case 'SetType':
        rec.effectType = unique(
          (call.arguments || []).map(argText).join(' ').match(/EFFECT_TYPE_[A-Z0-9_]+/g) || []
        );
        break;
      case 'SetCode':
        rec.code = (call.arguments || []).map(argText).join(', ');
        break;
      case 'SetCategory':
        rec.categories = unique(
          (call.arguments || []).map(argText).join(' ').match(/CATEGORY_[A-Z0-9_]+/g) || []
        );
        break;
      case 'SetProperty':
        rec.flags = unique(
          (call.arguments || []).map(argText).join(' ').match(/EFFECT_FLAG_[A-Z0-9_]+/g) || []
        );
        break;
      case 'SetRange':
        rec.range = (call.arguments || []).map(argText).join(', ');
        break;
      case 'SetValue':
        rec.value = (call.arguments || []).map(argText).join(', ');
        break;
      case 'SetLabel':
        rec.label = (call.arguments || []).map(argText).join(', ');
        break;
      case 'SetHintTiming':
        rec.hintTiming = (call.arguments || []).map(argText).join(', ');
        break;
      case 'SetReset':
        rec.reset = (call.arguments || []).map(argText).join(', ');
        break;
      case 'SetDescription': {
        const id = numericValue((call.arguments || [])[0]);
        if (id !== undefined) rec.descriptionId = id;
        break;
      }
      case 'SetCountLimit': {
        const args = call.arguments || [];
        const val = numericValue(args[0]);
        if (val !== undefined) rec.countLimit = val;
        const rest = args.slice(1).map(argText).join(', ');
        rec.countLimitText = rest;
        const code = rest.match(/EFFECT_COUNT_CODE_[A-Z0-9_]+/g)?.join('+');
        rec.countLimitCode = code;
        rec.isOncePerDuel = rest.includes('EFFECT_COUNT_CODE_DUEL');
        if (rest.includes('EFFECT_COUNT_CODE_SINGLE')) {
          rec.isSOPT = true;
          rec.isHOPT = false;
        } else if (args.length >= 2) {
          rec.isHOPT = true;
          rec.isSOPT = false;
        } else {
          rec.isSOPT = true;
          rec.isHOPT = false;
        }
        break;
      }
      case 'SetCost':
        rec.costRef = (call.arguments || []).map(argText).join(', ');
        rec.costNode = (call.arguments || [])[0];
        break;
      case 'SetTarget':
        rec.targetRef = (call.arguments || []).map(argText).join(', ');
        rec.targetNode = (call.arguments || [])[0];
        break;
      case 'SetOperation':
        rec.operationRef = (call.arguments || []).map(argText).join(', ');
        rec.operationNode = (call.arguments || [])[0];
        break;
      case 'SetCondition':
        rec.conditionRef = (call.arguments || []).map(argText).join(', ');
        rec.conditionNode = (call.arguments || [])[0];
        break;
      default:
        break;
    }
  }

  // 3. Registration order (only calls in initial_effect).
  for (const call of effectCalls) {
    const name = callName(call);
    const isRegister = name.endsWith(':RegisterEffect') || name === 'Duel.RegisterEffect';
    if (!isRegister) continue;
    const arg = (call.arguments || [])[0];
    const varName = nodeName(arg);
    const rec = effectRecords.get(varName);
    if (rec && !orderedRecords.includes(rec)) orderedRecords.push(rec);
  }

  const finalRecords = orderedRecords.length > 0 ? orderedRecords : Array.from(effectRecords.values());

  // 4. Analyze functions.
  const functionInfos: LuaFunctionInfo[] = [];
  for (const [name, info] of functions) {
    if (name !== info.name) continue; // skip short-name aliases
    const calls = collectCallsIn(info.body);
    functionInfos.push({
      name,
      parameters: info.params,
      role: functionRole(name, info.node),
      calls: unique(calls.map(callName).filter(Boolean)),
      lineCount: (info.node.loc?.end?.line || 0) - (info.node.loc?.start?.line || 0) + 1
    });
  }

  // 5. Build ParsedEffect list.
  const effects: ParsedEffect[] = finalRecords.map((rec, index) => {
    const costInfo = resolveFunction(rec.costNode, functions);
    const targetInfo = resolveFunction(rec.targetNode, functions);
    const operationInfo = resolveFunction(rec.operationNode, functions);
    const conditionInfo = resolveFunction(rec.conditionNode, functions);

    const costCalls = costInfo ? collectCallsIn(costInfo.body) : [];
    const targetCalls = targetInfo ? collectCallsIn(targetInfo.body) : [];
    const operationCalls = operationInfo ? collectCallsIn(operationInfo.body) : [];
    const conditionCalls = conditionInfo ? collectCallsIn(conditionInfo.body) : [];

    const target = describeTargetFromCalls(targetCalls, rec.flags);
    const factorySummon = rec.factory?.match(/^(Fusion|Synchro|Xyz|Link|Pendulum|Ritual)\.CreateSummonEff$/);
    const operationDescription = describeOperationFromCalls(operationCalls)
      || (factorySummon ? `${factorySummon[1]} Summon effect (library factory)` : undefined);
    const conditionDescription = describeConditionFromCalls(conditionCalls);
    const costDescription = describeCostFromCalls(costCalls) || (rec.costRef ? `Custom cost (${rec.costRef})` : undefined);

    const apiCalls = unique(
      [...costCalls, ...targetCalls, ...operationCalls, ...conditionCalls]
        .map(callName)
        .filter(Boolean)
    );

    return {
      index: index + 1,
      effectType: rec.effectType,
      code: rec.code,
      categories: rec.categories,
      flags: rec.flags,
      isHOPT: rec.isHOPT,
      isSOPT: rec.isSOPT,
      isOncePerDuel: rec.isOncePerDuel,
      countLimit: rec.countLimit,
      countLimitCode: rec.countLimitCode,
      isTargeting: target.isTargeting,
      spellSpeed: spellSpeedFor(rec.effectType, rec.code),
      range: rec.range,
      value: rec.value,
      label: rec.label,
      hintTiming: rec.hintTiming,
      descriptionId: rec.descriptionId,
      reset: rec.reset,
      factory: rec.factory,
      conditionDescription,
      costDescription,
      targetDescription: target.description,
      operationDescription,
      apiCalls,
      rawSnippet: rec.raw.join('\n')
    };
  });

  // 6. Summon procedures.
  const summonProcedures: LuaSummonProcedure[] = [];
  for (const call of allCalls) {
    const name = callName(call);
    const kindMap: Record<string, LuaSummonProcedure['kind']> = {
      'Fusion.AddProcMix': 'fusion',
      'Fusion.AddProcMixRep': 'fusion',
      'Synchro.AddProcedure': 'synchro',
      'Xyz.AddProcedure': 'xyz',
      'Link.AddProcedure': 'link',
      'Pendulum.AddProcedure': 'pendulum',
      'Ritual.AddProcedure': 'ritual'
    };
    let kind = kindMap[name];
    const factoryMatch = name.match(/^(Fusion|Synchro|Xyz|Link|Pendulum|Ritual)\.CreateSummonEff$/);
    if (!kind && factoryMatch) {
      kind = factoryMatch[1].toLowerCase() as LuaSummonProcedure['kind'];
    }
    if (!kind) continue;
    const args = call.arguments || [];
    const materials = args
      .slice(kind === 'fusion' && factoryMatch ? 0 : 1)
      .map(argText)
      .filter((a: string) => a && !['true', 'false', 'nil'].includes(a));
    const proc: LuaSummonProcedure = {
      kind,
      call: name,
      materials
    };
    if (kind === 'xyz') {
      proc.rankOrLevel = numericValue(args[2]);
    }
    if (kind === 'link') {
      proc.linkRating = numericValue(args[2]);
    }
    summonProcedures.push(proc);
  }
  // Effect-based special summon.
  if (effects.some(e => (e.operationDescription || '').includes('Special Summons'))) {
    summonProcedures.push({ kind: 'special', call: 'Duel.SpecialSummon', materials: [] });
  }

  // 7. Simulator profile.
  const loadedLibraries = unique(
    allCalls
      .filter(c => callName(c) === 'Duel.LoadScript')
      .map(c => {
        const first = (c.arguments || [])[0];
        return stringValue(first) ?? argText(first);
      })
      .filter(Boolean)
  );
  const callNames = unique(allCalls.map(callName).filter(Boolean));
  const usesProcLibraries = loadedLibraries.some(lib => String(lib).startsWith('proc_'));
  const usesAux = callNames.some(n => n.startsWith('aux.'));
  const usesLegacyGlobals = callNames.some(n => /^(Link|Xyz|Synchro|Fusion|Pendulum)\./.test(n));

  const warnings: string[] = [];
  if (!callNames.some(n => n.includes('initial_effect')) && !luaCode.includes('initial_effect')) {
    warnings.push('Script is missing function initial_effect(c).');
  }
  if (/\bLOCATION_GY\b/.test(luaCode)) {
    warnings.push('Uses LOCATION_GY, which does not exist. It must be LOCATION_GRAVE.');
  }
  if (usesLegacyGlobals && !usesProcLibraries) {
    warnings.push('Uses the Link/Xyz/Synchro/Fusion globals without Duel.LoadScript("proc_*.lua"). EDOPro preloads these libraries; YGO Omega does not, so it will throw a nil error there.');
  }
  if (callNames.some(n => /^aux\.Add(Link|Xyz|Synchro)Procedure$/.test(n) || n === 'aux.AddFusionProcMix')) {
    warnings.push('aux.Add*Procedure does not exist in standard utility.lua; use Link/Xyz/Synchro/Fusion.AddProcedure.');
  }
  if (/--\s*(Activation|Primary effect|GY effect|logic here|Trigger \/ Ignition)/i.test(luaCode)) {
    warnings.push('Script is still a skeleton/TODO, the effect will do nothing.');
  }
  for (const rec of finalRecords) {
    if (rec.costRef && !resolveFunction(rec.costNode, functions)) {
      warnings.push(`Could not resolve the cost function: ${rec.costRef}`);
    }
    if (rec.targetRef && !resolveFunction(rec.targetNode, functions)) {
      warnings.push(`Could not resolve the target function: ${rec.targetRef}`);
    }
    if (rec.operationRef && !resolveFunction(rec.operationNode, functions)) {
      warnings.push(`Could not resolve the operation function: ${rec.operationRef}`);
    }
  }

  // 8. Constants + setcodes.
  const constants: LuaCardAnalysis['constants'] = {
    effectTypes: [],
    events: [],
    categories: [],
    locations: [],
    types: [],
    reasons: []
  };
  const setcodes = new Set<number>();
  walk(ast, node => {
    if (node.type !== 'Identifier') return;
    const name = node.name;
    for (const [prefix, bucket] of Object.entries(EFFECT_CONSTANT_PREFIXES)) {
      if (name.startsWith(prefix)) {
        const target = (constants as any)[bucket];
        if (Array.isArray(target)) {
          (constants as any)[bucket] = unique([...target, name]);
        }
        break;
      }
    }
  });
  for (const call of allCalls) {
    if (!/IsSetCard$/.test(callName(call))) continue;
    for (const arg of call.arguments || []) {
      const v = numericValue(arg);
      if (v !== undefined) setcodes.add(v);
    }
  }
  // aux.FilterBoolFunction(Card.IsSetCard, 0x...)
  for (const call of allCalls) {
    if (callName(call) !== 'aux.FilterBoolFunction') continue;
    const args = call.arguments || [];
    if (nodeName(args[0]) === 'Card.IsSetCard') {
      const v = numericValue(args[1]);
      if (v !== undefined) setcodes.add(v);
    }
  }

  const apiCalls: LuaApiCall[] = allCalls
    .filter(c => {
      const n = callName(c);
      return n.startsWith('Duel.') || n.startsWith('Card.') || n.startsWith('aux.') || n.includes(':');
    })
    .map(c => ({
      name: callName(c),
      argsPreview: (c.arguments || []).map(argText).join(', ').slice(0, 160),
      location: `line ${c.loc?.start?.line || 0}`
    }));

  // EDOPro preloads proc_*.lua and utility.lua; a script that only uses the legacy
  // globals is therefore EDOPro-shaped. Omega scripts usually add Duel.LoadScript.
  const engine: LuaCardAnalysis['simulatorProfile']['engine'] =
    loadedLibraries.length > 0 && usesProcLibraries ? 'edopro' :
    usesLegacyGlobals ? 'edopro' :
    loadedLibraries.length > 0 ? 'omega' :
    'unknown';

  return {
    parsed: true,
    simulatorProfile: {
      engine,
      loadedLibraries,
      usesProcLibraries,
      usesAux,
      usesLegacyGlobals,
      notes: [
        usesProcLibraries
          ? 'Script explicitly loads proc_*.lua; works on EDOPro/Omega if the libraries are present.'
          : usesLegacyGlobals
            ? 'Uses Link/Xyz/Synchro/Fusion globals without proc_*.lua; may fail on Omega.'
            : 'No summon-procedure library detected.',
        usesAux
          ? 'Uses aux.* helpers (EDOPro utility.lua).'
          : 'No aux.* helpers detected.',
        `Archetype setcodes referenced: ${Array.from(setcodes).map(v => `0x${v.toString(16)}`).join(', ') || 'none'}`
      ]
    },
    functions: functionInfos.sort((a, b) => a.name.localeCompare(b.name)),
    effects,
    summonProcedures,
    apiCalls,
    constants,
    setcodes: Array.from(setcodes),
    warnings: unique(warnings),
    stats: {
      lineCount: luaCode.split('\n').length,
      functionCount: functionInfos.length,
      effectCount: effects.length,
      apiCallCount: apiCalls.length
    }
  };
}
