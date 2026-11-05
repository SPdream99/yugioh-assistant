/**
 * Card data reader for the local BabelCDB `cards.cdb`.
 *
 * Used by the script generator: when a card has no official Lua script we still
 * need its name, type, stats and effect text to produce a best-effort script.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const CDB_PATH = path.join(ROOT, "data", "ocgcore", "cards.cdb");

export interface CardData {
  code: number;
  name: string;
  desc: string;
  type: number;
  level: number;
  race: number;
  attribute: number;
  atk: number;
  def: number;
  setcodes: number[];
}

let dbCache: any = null;

async function getDb(): Promise<any | null> {
  if (dbCache) return dbCache;
  try {
    if (!fs.existsSync(CDB_PATH)) return null;
    const mod: any = await import("node-sqlite3-wasm");
    const Database = (mod.default || mod).Database;
    dbCache = new Database(CDB_PATH);
    return dbCache;
  } catch {
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

/** Number of cards in the local cdb, or null when the database is missing. */
export async function countLocalCards(): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = db.get("SELECT COUNT(*) AS n FROM datas");
    return Number(row?.n) || 0;
  } catch {
    return null;
  }
}

export async function readCardData(passcode: number): Promise<CardData | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const row = db.get("SELECT id, type, atk, def, level, race, attribute, setcode FROM datas WHERE id = ?", [passcode]);
    if (!row) return null;
    const text = db.get("SELECT name, desc FROM texts WHERE id = ?", [passcode]) || {};
    return {
      code: Number(row.id),
      name: String(text.name || `Card ${passcode}`),
      desc: String(text.desc || ""),
      type: Number(row.type) || 0,
      level: Number(row.level) || 0,
      race: Number(row.race) || 0,
      attribute: Number(row.attribute) || 0,
      atk: Number(row.atk) || 0,
      def: Number(row.def) || 0,
      setcodes: decodeSetcodes(row.setcode)
    };
  } catch {
    return null;
  }
}

export const TYPE_MONSTER = 0x1;
export const TYPE_SPELL = 0x2;
export const TYPE_TRAP = 0x4;
export const TYPE_NORMAL = 0x10;
export const TYPE_EFFECT = 0x20;
export const TYPE_FUSION = 0x40;
export const TYPE_RITUAL = 0x80;
export const TYPE_SYNCHRO = 0x2000;
export const TYPE_XYZ = 0x800000;
export const TYPE_LINK = 0x4000000;
export const TYPE_CONTINUOUS = 0x20000;
export const TYPE_QUICKPLAY = 0x10000;
export const TYPE_COUNTER = 0x80000;
export const TYPE_FIELD = 0x80000;
