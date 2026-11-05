export interface ParsedEffect {
  index: number;
  effectType: string[];
  code?: string;
  categories: string[];
  flags: string[];
  isHOPT: boolean;
  isSOPT: boolean;
  isOncePerDuel?: boolean;
  countLimit?: number;
  countLimitCode?: string;
  isTargeting: boolean;
  spellSpeed?: 1 | 2 | 3;
  range?: string;
  value?: string;
  label?: string;
  hintTiming?: string;
  descriptionId?: number;
  reset?: string;
  factory?: string;
  conditionDescription?: string;
  costDescription?: string;
  targetDescription?: string;
  operationDescription?: string;
  apiCalls?: string[];
  rawSnippet: string;
}

export interface LuaFunctionInfo {
  name: string;
  parameters: string[];
  role: "initial_effect" | "condition" | "cost" | "target" | "operation" | "filter" | "summon" | "helper" | "unknown";
  calls: string[];
  lineCount: number;
}

export interface LuaSummonProcedure {
  kind: "fusion" | "synchro" | "xyz" | "link" | "pendulum" | "ritual" | "special";
  call: string;
  materials: string[];
  rankOrLevel?: number;
  linkRating?: number;
  linkMarkers?: string[];
}

export interface LuaApiCall {
  name: string;
  argsPreview: string;
  location: string;
}

export interface LuaCardAnalysis {
  parsed: boolean;
  parseError?: string;
  simulatorProfile: {
    engine: "edopro" | "omega" | "master_duel" | "duel_links" | "unknown";
    loadedLibraries: string[];
    usesProcLibraries: boolean;
    usesAux: boolean;
    usesLegacyGlobals: boolean;
    notes: string[];
  };
  functions: LuaFunctionInfo[];
  effects: ParsedEffect[];
  summonProcedures: LuaSummonProcedure[];
  apiCalls: LuaApiCall[];
  constants: {
    effectTypes: string[];
    events: string[];
    categories: string[];
    locations: string[];
    types: string[];
    reasons: string[];
  };
  setcodes: number[];
  warnings: string[];
  stats: {
    lineCount: number;
    functionCount: number;
    effectCount: number;
    apiCallCount: number;
  };
}

export interface CardRulingAnalysis {
  passcode: number;
  cardName?: string;
  luaSourceAvailable: boolean;
  effects: ParsedEffect[];
  targetingProperties: {
    targets: boolean;
    explanation: string;
  };
  costProperties: {
    hasCost: boolean;
    costDetails: string[];
  };
  timingProperties: {
    canMissTiming: boolean;
    triggerType: string;
    explanation: string;
  };
  negationProperties: {
    negatesActivation: boolean;
    negatesEffect: boolean;
    explanation: string;
  };
  damageStepUsable: {
    usable: boolean;
    reason: string;
  };
  structure?: LuaCardAnalysis;
  summaryVerdict: string;
}
