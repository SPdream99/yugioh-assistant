import fs from 'node:fs';
import path from 'node:path';
import type { Card } from '../../types/card.js';
import { generateLuaScript, type EffectSpec } from './lua-generator.js';
import { renderCardSvg } from './card-renderer.js';
import { guardOutputPath, readTextFileSafe } from '../../utils/safe-path.js';

export interface CustomCardRecord {
  tempId: number;
  officialId?: number;
  name: string;
  origin: 'unreleased_official' | 'custom_fanmade';
  sourceUrl?: string;
  cardData: Card;
  luaPath: string;
  status: 'active' | 'migrated';
  createdAt: string;
  updatedAt: string;
}

export interface RegisterCustomCardInput {
  name: string;
  cardData: Partial<Card>;
  origin?: 'unreleased_official' | 'custom_fanmade';
  sourceUrl?: string;
  luaCode?: string;
  effectsSpec?: EffectSpec[];
}

export interface MigrationResult {
  success: boolean;
  oldId: number;
  newId: number;
  updatedFiles: string[];
  message: string;
}

const REGISTRY_RELATIVE_PATH = 'data/custom_registry.json';
const CUSTOM_CARDS_RELATIVE_DIR = 'data/custom_cards';
const CACHE_SCRIPTS_RELATIVE_DIR = 'data/cache/scripts';

function getPaths() {
  const cwd = process.cwd();
  const registryFile = path.resolve(cwd, REGISTRY_RELATIVE_PATH);
  const customCardsDir = path.resolve(cwd, CUSTOM_CARDS_RELATIVE_DIR);
  const cacheScriptsDir = path.resolve(cwd, CACHE_SCRIPTS_RELATIVE_DIR);

  // Ensure directories exist
  if (!fs.existsSync(customCardsDir)) {
    fs.mkdirSync(customCardsDir, { recursive: true });
  }
  if (!fs.existsSync(cacheScriptsDir)) {
    fs.mkdirSync(cacheScriptsDir, { recursive: true });
  }

  const registryDir = path.dirname(registryFile);
  if (!fs.existsSync(registryDir)) {
    fs.mkdirSync(registryDir, { recursive: true });
  }

  return { registryFile, customCardsDir, cacheScriptsDir };
}

/**
 * Reads all custom card records from storage.
 */
export function listCustomCards(): CustomCardRecord[] {
  const { registryFile } = getPaths();
  if (!fs.existsSync(registryFile)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(registryFile, 'utf-8');
    if (!raw.trim()) return [];
    return JSON.parse(raw) as CustomCardRecord[];
  } catch (err) {
    console.warn(`Warning: Failed to parse ${registryFile}, returning empty array:`, err);
    return [];
  }
}

/**
 * Writes custom card records to storage file.
 */
function saveRegistry(records: CustomCardRecord[]): void {
  const { registryFile } = getPaths();
  fs.writeFileSync(registryFile, JSON.stringify(records, null, 2), 'utf-8');
}

/**
 * Finds next available temp ID (>= 990000001).
 */
function getNextTempId(records: CustomCardRecord[], requestedId?: number): number {
  const STARTING_TEMP_ID = 990000001;
  const existingIds = new Set<number>();

  for (const r of records) {
    existingIds.add(r.tempId);
    if (r.officialId) existingIds.add(r.officialId);
  }

  if (requestedId && requestedId >= STARTING_TEMP_ID && !existingIds.has(requestedId)) {
    return requestedId;
  }

  let candidate = STARTING_TEMP_ID;
  for (const r of records) {
    if (r.tempId >= candidate) {
      candidate = r.tempId + 1;
    }
  }

  while (existingIds.has(candidate)) {
    candidate++;
  }

  return candidate;
}

/**
 * Registers a new custom / unreleased card.
 * Auto-assigns unique tempId >= 990000001.
 * Generates Lua script and saves to data/custom_cards/c${tempId}.lua.
 */
export function registerCustomCard(input: RegisterCustomCardInput): CustomCardRecord {
  const records = listCustomCards();
  const { customCardsDir } = getPaths();

  const tempId = getNextTempId(records, input.cardData?.id);
  const now = new Date().toISOString();

  // Create full Card object adhering to Card interface
  const fullCardData: Card = {
    type: input.cardData.type || 'Effect Monster',
    frameType: input.cardData.frameType || 'effect',
    desc: input.cardData.desc || '',
    atk: input.cardData.atk,
    def: input.cardData.def,
    level: input.cardData.level,
    race: input.cardData.race,
    attribute: input.cardData.attribute,
    scale: input.cardData.scale,
    linkval: input.cardData.linkval,
    linkmarkers: input.cardData.linkmarkers,
    archetype: input.cardData.archetype,
    card_sets: input.cardData.card_sets || [],
    card_images: input.cardData.card_images || [],
    card_prices: input.cardData.card_prices || [],
    banlist_info: input.cardData.banlist_info,
    ...input.cardData,
    // Guarantee id and name consistency
    id: tempId,
    name: input.name,
  };

  // Generate or use provided Lua code
  const luaCode = input.luaCode || generateLuaScript(fullCardData, tempId, input.effectsSpec);
  const luaFileName = `c${tempId}.lua`;
  const luaFilePath = path.resolve(customCardsDir, luaFileName);
  fs.writeFileSync(luaFilePath, luaCode, 'utf-8');

  // Relative path for registry portability
  const relativeLuaPath = path.relative(process.cwd(), luaFilePath).replace(/\\/g, '/');

  // Render SVG card artwork
  try {
    renderCardSvg(fullCardData, tempId);
  } catch (err) {
    console.warn(`Warning: Failed to render SVG for card ${tempId}:`, err);
  }

  const newRecord: CustomCardRecord = {
    tempId,
    name: input.name,
    origin: input.origin || 'unreleased_official',
    sourceUrl: input.sourceUrl,
    cardData: fullCardData,
    luaPath: relativeLuaPath,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  records.push(newRecord);
  saveRegistry(records);

  return newRecord;
}

/**
 * Retrieves a custom card record by either tempId or officialId.
 */
export function getCustomCard(id: number): CustomCardRecord | undefined {
  const records = listCustomCards();
  return records.find((r) => r.tempId === id || r.officialId === id);
}

/**
 * Migrates a custom card from tempId to officialId.
 * - Migrates script file from data/custom_cards/c${tempId}.lua to official script files
 * - Updates ID in Lua source
 * - Updates custom_registry.json setting status to 'migrated' and officialId
 * - Updates YDK files by replacing tempId with officialId
 */
export function migrateTempId(
  tempId: number,
  officialId: number,
  ydkFilesToUpdate?: string[]
): MigrationResult {
  const records = listCustomCards();
  const recordIndex = records.findIndex((r) => r.tempId === tempId);

  if (recordIndex === -1) {
    return {
      success: false,
      oldId: tempId,
      newId: officialId,
      updatedFiles: [],
      message: `Card with tempId ${tempId} was not found in registry`,
    };
  }

  const record = records[recordIndex];
  const { customCardsDir, cacheScriptsDir } = getPaths();
  const oldLuaPath = path.isAbsolute(record.luaPath)
    ? record.luaPath
    : path.resolve(process.cwd(), record.luaPath);

  let luaContent = '';
  if (fs.existsSync(oldLuaPath)) {
    luaContent = fs.readFileSync(oldLuaPath, 'utf-8');
  } else {
    // Regenerate from card data if old file was missing
    luaContent = generateLuaScript({ ...record.cardData, id: officialId }, officialId);
  }

  // Update ID occurrences in Lua code
  const updatedLua = luaContent
    .replace(new RegExp(`\\(ID: ${tempId}\\)`, 'g'), `(ID: ${officialId})`)
    .replace(new RegExp(`\\bc${tempId}\\b`, 'g'), `c${officialId}`)
    .replace(new RegExp(`\\b${tempId}\\b`, 'g'), `${officialId}`);

  // Write to both data/custom_cards/c${officialId}.lua and data/cache/scripts/c${officialId}.lua
  const newCustomLuaPath = path.resolve(customCardsDir, `c${officialId}.lua`);
  const newCacheLuaPath = path.resolve(cacheScriptsDir, `c${officialId}.lua`);

  fs.writeFileSync(newCustomLuaPath, updatedLua, 'utf-8');
  try {
    fs.writeFileSync(newCacheLuaPath, updatedLua, 'utf-8');
  } catch (err) {
    console.warn(`Warning: Could not write to cache path ${newCacheLuaPath}:`, err);
  }

  // Render SVG card artwork for official ID
  try {
    renderCardSvg({ ...record.cardData, id: officialId }, officialId);
  } catch (err) {
    console.warn(`Warning: Could not render SVG for migrated card ${officialId}:`, err);
  }

  // Update YDK deck files
  const updatedFiles: string[] = [];
  if (ydkFilesToUpdate && ydkFilesToUpdate.length > 0) {
    for (const ydkPath of ydkFilesToUpdate) {
      const resolvedYdk = path.isAbsolute(ydkPath) ? ydkPath : path.resolve(process.cwd(), ydkPath);
      if (!resolvedYdk.toLowerCase().endsWith(".ydk")) {
        console.warn(`Skipping ${resolvedYdk}: only .ydk files are rewritten.`);
        continue;
      }
      const guard = guardOutputPath(resolvedYdk, { allowGameRoots: true });
      if (!guard.ok) {
        console.warn(`Skipping ${resolvedYdk}: ${guard.reason}`);
        continue;
      }
      if (fs.existsSync(guard.resolved)) {
        try {
          const read = readTextFileSafe(guard.resolved);
          if (!read.ok) throw new Error(read.reason);
          const lines = (read.text || "").split(/\r?\n/);
          let modified = false;
          const updatedLines = lines.map((line) => {
            if (line.trim() === String(tempId)) {
              modified = true;
              return String(officialId);
            }
            return line;
          });
          if (modified) {
            fs.writeFileSync(guard.resolved, updatedLines.join('\n'), 'utf-8');
            updatedFiles.push(guard.resolved);
          }
        } catch (err) {
          console.warn(`Warning: Could not update YDK file ${guard.resolved}:`, err);
        }
      }
    }
  }

  // Update registry record
  const now = new Date().toISOString();
  record.status = 'migrated';
  record.officialId = officialId;
  record.cardData.id = officialId;
  record.luaPath = path.relative(process.cwd(), newCustomLuaPath).replace(/\\/g, '/');
  record.updatedAt = now;

  records[recordIndex] = record;
  saveRegistry(records);

  return {
    success: true,
    oldId: tempId,
    newId: officialId,
    updatedFiles,
    message: `Successfully migrated card "${record.name}" from temp ID ${tempId} to official ID ${officialId}`,
  };
}

/**
 * Object-oriented CustomCardRegistry class wrapper.
 */
export class CustomCardRegistry {
  static register(input: RegisterCustomCardInput): CustomCardRecord {
    return registerCustomCard(input);
  }

  static get(id: number): CustomCardRecord | undefined {
    return getCustomCard(id);
  }

  static list(): CustomCardRecord[] {
    return listCustomCards();
  }

  static migrate(tempId: number, officialId: number, ydkFiles?: string[]): MigrationResult {
    return migrateTempId(tempId, officialId, ydkFiles);
  }
}
