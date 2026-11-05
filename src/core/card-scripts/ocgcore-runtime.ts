/**
 * Real ocgcore runtime harness.
 *
 * This runs ProjectIgnis' EDOPro core compiled to WebAssembly (`ocgcore-wasm`).
 * It executes the actual card Lua scripts — not a heuristic simulation — and
 * returns the engine messages (draws, summons, chains, LP changes, win).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createCore, {
  OcgDuelMode,
  OcgLocation,
  OcgPosition,
  OcgProcessResult,
  OcgResponseType,
  OcgMessageType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgCardData,
  type OcgMessage,
  type OcgResponse
} from "ocgcore-wasm";

/** Deterministic 32-bit PRNG (mulberry32). Same seed → same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher–Yates shuffle; returns a new array. */
export function seededShuffle<T>(input: T[], seed: number): T[] {
  const random = mulberry32(seed);
  const array = [...input];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export interface OcgDuelSetup {
  deckA: number[];
  deckB: number[];
  handA?: number[];
  handB?: number[];
  extraA?: number[];
  extraB?: number[];
  seed?: [bigint, bigint, bigint, bigint];
  maxSteps?: number;
  startingLP?: number;
  /** Cards drawn before the first turn. Default 5; set 0 to control the hand exactly. */
  startingDrawCount?: number;
  /** Cards drawn during each Draw Phase. Default 1; set 0 for deterministic scenarios. */
  drawCountPerTurn?: number;
  responder?: (message: OcgMessage, context: OcgDuelContext) => OcgResponse | null | undefined;
  /** Debug hook: called for every request before a response is produced. */
  onRequest?: (message: OcgMessage) => void;
  /** Script text injected by name (e.g. { "c123.lua": lua }) — used to verify generated scripts. */
  scriptOverrides?: Record<string, string>;
  /** Card data injected by passcode — lets verification run for cards not yet in cards.cdb. */
  cardOverrides?: Record<number, OcgCardData>;
}

export interface OcgDuelContext {
  step: number;
  messages: RuntimeMessage[];
  deckA: number[];
  deckB: number[];
}

export interface RuntimeMessage {
  step: number;
  type: number;
  typeName: string;
  text: string;
  raw: any;
}

export interface OcgDuelResult {
  runtime: "ocgcore-wasm";
  coreVersion: [number, number];
  success: boolean;
  steps: number;
  messages: RuntimeMessage[];
  timeline: string[];
  winner?: number;
  finalField?: any;
  errors: string[];
  luaScriptsLoaded: number;
  luaScriptNames: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const CDB_PATH = path.join(ROOT, "data", "ocgcore", "cards.cdb");
const SCRIPT_DIR = path.join(ROOT, "data", "ocgcore-scripts");
const CUSTOM_SCRIPT_DIR = path.join(ROOT, "data", "custom_cards");
const OFFICIAL_CACHE_DIR = path.join(SCRIPT_DIR, "official");
const OFFICIAL_RAW_BASE = "https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master/official";

const TYPE_NAMES: Record<number, string> = {};
for (const [name, value] of Object.entries(OcgMessageType)) {
  if (typeof value === "number") TYPE_NAMES[value] = name;
}

function scriptCandidates(name: string): string[] {
  const safe = name.replace(/\\/g, "/");
  return [
    path.join(SCRIPT_DIR, safe),
    path.join(CUSTOM_SCRIPT_DIR, safe),
    path.join(OFFICIAL_CACHE_DIR, safe),
    path.join(SCRIPT_DIR, "official", safe)
  ];
}

function readLocalScript(name: string): string | null {
  for (const candidate of scriptCandidates(name)) {
    try {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf-8");
    } catch {
      // Continue
    }
  }
  return null;
}

async function readScriptWithRemoteFallback(name: string, errors: string[]): Promise<string | null> {
  const local = readLocalScript(name);
  if (local !== null) return local;
  if (!/^c\d+\.lua$/.test(name)) return null;

  try {
    const resp = await fetch(`${OFFICIAL_RAW_BASE}/${name}`, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text || text.startsWith("404: Not Found")) return null;
    try {
      fs.mkdirSync(OFFICIAL_CACHE_DIR, { recursive: true });
      fs.writeFileSync(path.join(OFFICIAL_CACHE_DIR, name), text, "utf-8");
    } catch {
      // Cache write optional
    }
    return text;
  } catch (error) {
    errors.push(`Could not load script ${name}: ${(error as Error).message}`);
    return null;
  }
}

let cdbModule: any = null;
let cdbDb: any = null;

async function getCardDb(errors: string[]): Promise<any | null> {
  if (cdbDb) return cdbDb;
  try {
    if (!fs.existsSync(CDB_PATH)) {
      errors.push(`cards.cdb not found at ${CDB_PATH}. Download BabelCDB cards.cdb.`);
      return null;
    }
    const mod = await import("node-sqlite3-wasm");
    cdbModule = (mod as any).default || mod;
    const Database = cdbModule.Database || cdbModule;
    cdbDb = new Database(CDB_PATH);
    return cdbDb;
  } catch (error) {
    errors.push(`Could not open cards.cdb: ${(error as Error).message}`);
    return null;
  }
}

function decodeSetcodes(raw: any): number[] {
  let value = 0;
  if (typeof raw === "bigint") value = Number(raw);
  else if (typeof raw === "number") value = raw;
  else if (raw && raw.length !== undefined) {
    const bytes = Buffer.from(raw);
    value = bytes.length >= 4 ? bytes.readUInt32LE(0) : bytes.readUInt16LE(0);
  }
  const codes: number[] = [];
  const low = value & 0xffff;
  const high = (value >>> 16) & 0xffff;
  if (low) codes.push(low);
  if (high) codes.push(high);
  return codes;
}

function toOcgCardData(row: any): OcgCardData | null {
  if (!row) return null;
  const levelRaw = Number(row.level) || 0;
  const level = levelRaw & 0xff;
  const lscale = (levelRaw >>> 24) & 0xff;
  const rscale = (levelRaw >>> 16) & 0xff;
  const isLink = (Number(row.type) & 0x4000000) !== 0;
  return {
    code: Number(row.id),
    alias: Number(row.alias) || 0,
    setcodes: decodeSetcodes(row.setcode),
    type: Number(row.type) || 0,
    level,
    attribute: Number(row.attribute) || 0,
    race: BigInt(Number(row.race) || 0),
    attack: Number(row.atk) || 0,
    defense: Number(row.def) || 0,
    lscale,
    rscale,
    link_marker: isLink ? Number(row.def) || 0 : 0
  };
}

function makeCardReader(db: any, errors: string[]): (code: number) => OcgCardData | null {
  return (code: number) => {
    try {
      const row = db.get("SELECT id, alias, setcode, type, atk, def, level, race, attribute FROM datas WHERE id = ?", [code]);
      if (!row) {
        errors.push(`Card ${code} is not in cards.cdb.`);
        return null;
      }
      return toOcgCardData(row);
    } catch (error) {
      errors.push(`cardReader ${code}: ${(error as Error).message}`);
      return null;
    }
  };
}

function firstPlace(msg: any, attempt = 0): any {
  // Spell/Trap zones first (safe for both spells and traps), then monster zones.
  const player = Number(msg.player) || 0;
  const candidates: any[] = [];
  for (let i = 0; i < 5; i++) candidates.push({ player, location: OcgLocation.SZONE, sequence: i });
  for (let i = 0; i < 7; i++) candidates.push({ player, location: OcgLocation.MZONE, sequence: i });
  return candidates[Math.min(attempt, candidates.length - 1)];
}

export function defaultResponder(message: OcgMessage, placeAttempt = 0): OcgResponse | null {
  const msg = message as any;
  switch (message.type) {
    case OcgMessageType.SELECT_IDLECMD: {
      if (msg.summons?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 };
      if (msg.special_summons?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index: 0 };
      if (msg.activates?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: 0 };
      if (msg.spell_sets?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPELL_SET, index: 0 };
      if (msg.monster_sets?.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: 0 };
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
    }
    case OcgMessageType.SELECT_BATTLECMD: {
      if (msg.attacks?.length) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
    }
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: false };
    case OcgMessageType.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: 0 };
    case OcgMessageType.SELECT_CARD: {
      const min = Number(msg.min) || 0;
      if (min === 0 && msg.can_cancel) return { type: OcgResponseType.SELECT_CARD, indicies: null };
      const count = Math.min(Math.max(min, 1), (msg.selects || []).length);
      return { type: OcgResponseType.SELECT_CARD, indicies: Array.from({ length: count }, (_, i) => i) };
    }
    case OcgMessageType.SELECT_CHAIN:
      return { type: OcgResponseType.SELECT_CHAIN, index: null };
    case OcgMessageType.SELECT_POSITION: {
      const positions = Number(msg.positions) || 0;
      if (positions & OcgPosition.FACEUP_ATTACK) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_ATTACK };
      if (positions & OcgPosition.FACEUP_DEFENSE) return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_DEFENSE };
      return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEDOWN_DEFENSE };
    }
    case OcgMessageType.SELECT_PLACE:
      return { type: OcgResponseType.SELECT_PLACE, places: [firstPlace(msg, placeAttempt)] } as any;
    case OcgMessageType.SELECT_TRIBUTE: {
      const min = Number(msg.min) || 0;
      if (min === 0 && msg.can_cancel) return { type: OcgResponseType.SELECT_TRIBUTE, indicies: null };
      const count = Math.min(Math.max(min, 1), (msg.selects || []).length);
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: Array.from({ length: count }, (_, i) => i) };
    }
    case OcgMessageType.SELECT_UNSELECT_CARD:
      if (msg.can_cancel || msg.can_finish) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };
    case OcgMessageType.SORT_CARD:
      return { type: OcgResponseType.SORT_CARD, order: (msg.cards || []).map((_: any, i: number) => i) };
    default:
      return null;
  }
}

function safeFallbackFor(request: OcgMessage | null): OcgResponse | null {
  if (!request) return null;
  switch (request.type) {
    case OcgMessageType.SELECT_IDLECMD:
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
    case OcgMessageType.SELECT_BATTLECMD:
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
    case OcgMessageType.SELECT_CHAIN:
      return { type: OcgResponseType.SELECT_CHAIN, index: null };
    case OcgMessageType.SELECT_CARD:
      return { type: OcgResponseType.SELECT_CARD, indicies: null };
    case OcgMessageType.SELECT_TRIBUTE:
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: null };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: false };
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
    case OcgMessageType.SELECT_PLACE:
      return { type: OcgResponseType.SELECT_PLACE, places: [firstPlace(request as any)] } as any;
    case OcgMessageType.SELECT_POSITION:
      return { type: OcgResponseType.SELECT_POSITION, position: OcgPosition.FACEUP_ATTACK };
    case OcgMessageType.SELECT_UNSELECT_CARD:
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
    case OcgMessageType.SORT_CARD:
      return { type: OcgResponseType.SORT_CARD, order: null };
    case OcgMessageType.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: 0 };
    default:
      return null;
  }
}

/**
 * Runs a real EDOPro-core duel. Returns the engine messages and a readable timeline.
 */
export async function runOcgCoreDuel(setup: OcgDuelSetup): Promise<OcgDuelResult> {
  const errors: string[] = [];
  const messages: RuntimeMessage[] = [];
  const timeline: string[] = [];
  const luaScriptNames: string[] = [];
  const coreVersion: [number, number] = [0, 0];

  const db = await getCardDb(errors);
  if (!db) {
    return {
      runtime: "ocgcore-wasm",
      coreVersion,
      success: false,
      steps: 0,
      messages,
      timeline,
      errors,
      luaScriptsLoaded: 0,
      luaScriptNames
    };
  }

  // Use the async/JSPI core so scriptReader can fetch missing scripts on demand.
  const core = await createCore({ sync: false }).catch((error: any) => {
    if (/jspi/i.test(String(error?.message || error))) {
      throw new Error(
        "This Node.js build does not expose WebAssembly JSPI, which ocgcore-wasm requires. Use Node 24 or newer."
      );
    }
    throw error;
  });
  const version = core.getVersion();
  coreVersion[0] = version[0];
  coreVersion[1] = version[1];

  const scriptReader = async (name: string) => {
    const overridden = setup.scriptOverrides?.[name];
    const content = overridden !== undefined
      ? overridden
      : await readScriptWithRemoteFallback(name, errors);
    if (content !== null && /^c\d+\.lua$/.test(name)) {
      luaScriptNames.push(name);
    }
    return content;
  };

  const startingDrawCount = setup.startingDrawCount ?? 5;
  const drawCountPerTurn = setup.drawCountPerTurn ?? 1;

  const handle = await core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed: setup.seed || [1n, 2n, 3n, 4n],
    team1: { startingLP: setup.startingLP || 8000, startingDrawCount, drawCountPerTurn },
    team2: { startingLP: setup.startingLP || 8000, startingDrawCount, drawCountPerTurn },
    cardReader: (code: number) => setup.cardOverrides?.[code] ?? makeCardReader(db, errors)(code),
    scriptReader,
    errorHandler: (type, text) => {
      errors.push(`[core:${type}] ${text}`);
    }
  });

  if (!handle) {
    errors.push("ocgcore.createDuel returned null.");
    return {
      runtime: "ocgcore-wasm",
      coreVersion,
      success: false,
      steps: 0,
      messages,
      timeline,
      errors,
      luaScriptsLoaded: 0,
      luaScriptNames
    };
  }

  // The card scripts rely on GetID(), aux.*, Effect.* and the proc_* libraries.
  // Load the engine libraries before any card script is executed.
  const ENGINE_LIBS = [
    "constant.lua",
    "utility.lua",
    "proc_fusion.lua",
    "proc_fusion_spell.lua",
    "proc_synchro.lua",
    "proc_xyz.lua",
    "proc_link.lua",
    "proc_ritual.lua",
    "proc_pendulum.lua",
    "proc_equip.lua",
    "proc_union.lua",
    "proc_gemini.lua",
    "proc_spirit.lua",
    "proc_normal.lua",
    "proc_workaround.lua",
    "proc_persistent.lua"
  ];
  for (const lib of ENGINE_LIBS) {
    const content = readLocalScript(lib);
    if (content === null) {
      if (lib === "constant.lua" || lib === "utility.lua") {
        errors.push(`Missing ${lib} in data/ocgcore-scripts.`);
      }
      continue;
    }
    try {
      await core.loadScript(handle, lib, content);
    } catch (error) {
      errors.push(`Could not load ${lib}: ${(error as Error).message}`);
    }
  }

  const addCards = async (team: 0 | 1, codes: number[], location: number, position: number) => {
    for (const code of codes) {
      await core.duelNewCard(handle, {
        team,
        duelist: 0,
        code,
        controller: team,
        location: location as any,
        sequence: 0,
        position: position as any
      });
    }
  };

  // ocgcore draws from the deck in insertion order, so dealing the .ydk file
  // as-is produces the same opening hand for every seed. Shuffle each deck with
  // its own seeded PRNG first: a seed now replays exactly, and two seeds differ.
  const seedA = Number((setup.seed?.[0] ?? 1n) & 0xffffffffn);
  const seedB = Number((setup.seed?.[1] ?? 2n) & 0xffffffffn);
  const dealtDeckA = seededShuffle(setup.deckA, seedA ^ 0x9e3779b9);
  const dealtDeckB = seededShuffle(setup.deckB, seedB ^ 0x85ebca6b);

  await addCards(0, dealtDeckA, OcgLocation.DECK, OcgPosition.FACEDOWN_DEFENSE);
  await addCards(1, dealtDeckB, OcgLocation.DECK, OcgPosition.FACEDOWN_DEFENSE);
  if (setup.extraA?.length) await addCards(0, setup.extraA, OcgLocation.EXTRA, OcgPosition.FACEDOWN_DEFENSE);
  if (setup.extraB?.length) await addCards(1, setup.extraB, OcgLocation.EXTRA, OcgPosition.FACEDOWN_DEFENSE);
  if (setup.handA?.length) await addCards(0, setup.handA, OcgLocation.HAND, OcgPosition.FACEUP_ATTACK);
  if (setup.handB?.length) await addCards(1, setup.handB, OcgLocation.HAND, OcgPosition.FACEUP_ATTACK);

  await core.startDuel(handle);

  const maxSteps = setup.maxSteps || 120;
  let winner: number | undefined;
  let lastRequest: OcgMessage | null = null;
  let placeAttempt = 0;

  for (let step = 1; step <= maxSteps; step++) {
    const status = await core.duelProcess(handle);
    const batch = core.duelGetMessage(handle);
    for (const msg of batch) {
      const typeName = TYPE_NAMES[msg.type] || `TYPE_${msg.type}`;
      const raw = JSON.parse(
        JSON.stringify(msg, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
      );
      messages.push({ step, type: msg.type, typeName, text: describeMessage(msg), raw });
      const line = describeMessage(msg);
      if (line && !line.startsWith("HINT") && !line.startsWith("UPDATE")) {
        timeline.push(`T${step}: ${line}`);
      }
      if (msg.type === OcgMessageType.WIN) {
        winner = (msg as any).player;
      }
    }

    if (status === OcgProcessResult.END) break;
    if (status === OcgProcessResult.CONTINUE) continue;

    // RETRY means the previous response was invalid. Rotate the candidate
    // (mostly for SELECT_PLACE) and fall back to the safest legal choice.
    if (batch.some(m => m.type === OcgMessageType.RETRY)) {
      if (lastRequest && lastRequest.type === OcgMessageType.SELECT_PLACE) {
        placeAttempt += 1;
        core.duelSetResponse(handle, {
          type: OcgResponseType.SELECT_PLACE,
          places: [firstPlace(lastRequest as any, placeAttempt)]
        } as any);
        continue;
      }
      const fallback = safeFallbackFor(lastRequest);
      if (!fallback) {
        errors.push('Engine returned RETRY but there is no safe fallback.');
        break;
      }
      core.duelSetResponse(handle, fallback);
      continue;
    }

    const request = batch.find(m => m.type >= OcgMessageType.SELECT_BATTLECMD && m.type <= OcgMessageType.SELECT_UNSELECT_CARD)
      || batch.find(m => m.type === OcgMessageType.SELECT_CHAIN);
    if (!request) {
      errors.push(`WAITING but no request message was found (types: ${batch.map(m => m.type).join(",")})`);
      break;
    }
    lastRequest = request;

    if (setup.onRequest) {
      try {
        setup.onRequest(request);
      } catch {
        // Debug hook must never break the duel.
      }
    }

    const custom = setup.responder ? setup.responder(request, { step, messages, deckA: setup.deckA, deckB: setup.deckB }) : undefined;
    if (request.type !== OcgMessageType.SELECT_PLACE) placeAttempt = 0;
    const response = custom ?? defaultResponder(request, placeAttempt);
    if (!response) {
      errors.push(`No response implemented for message ${TYPE_NAMES[request.type] || request.type}.`);
      break;
    }
    core.duelSetResponse(handle, response);
  }

  const finalField = core.duelQueryField(handle);
  return {
    runtime: "ocgcore-wasm",
    coreVersion,
    success: true,
    steps: messages.length > 0 ? messages[messages.length - 1].step : 0,
    messages,
    timeline,
    winner,
    finalField: JSON.parse(JSON.stringify(finalField, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
    errors,
    luaScriptsLoaded: luaScriptNames.length,
    luaScriptNames: Array.from(new Set(luaScriptNames))
  };
}

function describeMessage(msg: OcgMessage): string {
  const m = msg as any;
  switch (msg.type) {
    case OcgMessageType.NEW_TURN:
      return `NEW_TURN: player ${m.player}`;
    case OcgMessageType.NEW_PHASE:
      return `NEW_PHASE: ${phaseName(m.phase)}`;
    case OcgMessageType.DRAW:
      return `DRAW: player ${m.player} drew ${m.drawn?.map((d: any) => d.code).join(", ")}`;
    case OcgMessageType.SUMMONING:
      return `SUMMONING: ${m.code} by player ${m.controller} (${m.position})`;
    case OcgMessageType.SPSUMMONING:
      return `SPSUMMONING: ${m.code} by player ${m.controller} (${m.position})`;
    case OcgMessageType.CHAINING:
      return `CHAINING: ${m.code} chain link ${m.chain_size}`;
    case OcgMessageType.CHAIN_SOLVING:
      return `CHAIN_SOLVING: chain link ${m.chain_size}`;
    case OcgMessageType.CHAIN_SOLVED:
      return `CHAIN_SOLVED: chain link ${m.chain_size}`;
    case OcgMessageType.CHAIN_END:
      return `CHAIN_END`;
    case OcgMessageType.CHAIN_NEGATED:
      return `CHAIN_NEGATED: chain link ${m.chain_size}`;
    case OcgMessageType.LPUPDATE:
      return `LPUPDATE: player ${m.player} -> ${m.lp}`;
    case OcgMessageType.DAMAGE:
      return `DAMAGE: player ${m.player} took ${m.amount}`;
    case OcgMessageType.RECOVER:
      return `RECOVER: player ${m.player} gained ${m.amount}`;
    case OcgMessageType.MOVE:
      return `MOVE: ${m.card} ${locationName(m.from?.location)} -> ${locationName(m.to?.location)}`;
    case OcgMessageType.WIN:
      return `WIN: player ${m.player} wins (reason ${m.reason})`;
    default:
      return `${TYPE_NAMES[msg.type] || msg.type}`;
  }
}

function phaseName(phase: number): string {
  const names: Record<number, string> = {
    1: "DRAW",
    2: "STANDBY",
    4: "MAIN1",
    8: "BATTLE_START",
    16: "BATTLE_STEP",
    32: "DAMAGE",
    64: "DAMAGE_CALC",
    128: "BATTLE_END",
    256: "MAIN2",
    512: "END"
  };
  return names[phase] || String(phase);
}

function locationName(loc: number): string {
  const names: Record<number, string> = {
    1: "DECK",
    2: "HAND",
    4: "MZONE",
    8: "SZONE",
    16: "GRAVE",
    32: "REMOVED",
    64: "EXTRA",
    128: "OVERLAY"
  };
  return names[loc] || String(loc);
}
