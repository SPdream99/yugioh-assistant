/**
 * Card script resolution with provenance.
 *
 * Order of precedence:
 *   1. user override      data/card-scripts/manual/c<id>.lua
 *   2. shipped custom     data/custom_cards/c<id>.lua
 *   3. official           data/ocgcore-scripts/official/c<id>.lua  (then live ProjectIgnis)
 *   4. generated          data/card-scripts/generated/c<id>.lua
 *
 * Replacement is automatic: whenever a generated script exists and an official
 * one becomes obtainable, the generated file is deleted, the official script is
 * cached, and the caller is told `replacedGenerated: true`.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readCardData, type CardData } from "./card-data.js";
import { generateLuaFromCardData, type GeneratedScript } from "./script-generator.js";
import { runOcgCoreDuel } from "./ocgcore-runtime.js";
import { extractCardFromArticle } from "../news-rulings/news-card-extractor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");

const MANUAL_DIR = path.join(ROOT, "data", "card-scripts", "manual");
const GENERATED_DIR = path.join(ROOT, "data", "card-scripts", "generated");
const GENERATED_META = path.join(GENERATED_DIR, "meta.json");
const OFFICIAL_DIR = path.join(ROOT, "data", "ocgcore-scripts", "official");
const CUSTOM_DIR = path.join(ROOT, "data", "custom_cards");

const OFFICIAL_URLS = (passcode: number) => [
  `https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master/official/c${passcode}.lua`,
  `https://raw.githubusercontent.com/ProjectIgnis/CardScripts/master/scripts/c${passcode}.lua`
];

export type ScriptProvenance = "manual" | "custom" | "official" | "generated";

export interface GeneratedMeta {
  passcode: number;
  createdAt: string;
  cardName: string;
  cardTextHash: string;
  confidence: GeneratedScript["confidence"];
  patterns: string[];
  notes: string[];
  verified: boolean;
  errors: string[];
}

export interface ResolvedScript {
  passcode: number;
  available: boolean;
  provenance?: ScriptProvenance;
  text?: string;
  path?: string;
  replacedGenerated?: boolean;
  cardName?: string;
  generated?: GeneratedMeta;
  reason?: string;
}

function scriptName(passcode: number): string {
  return `c${passcode}.lua`;
}

function cardTextHash(card: CardData | null): string {
  const payload = card ? `${card.name}\n${card.desc}\n${card.type}\n${card.atk}\n${card.def}\n${card.level}` : "unknown";
  return crypto.createHash("sha1").update(payload).digest("hex");
}

function readIfExists(file: string): string | null {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
  } catch {
    return null;
  }
}

function readGeneratedMeta(): Record<string, GeneratedMeta> {
  try {
    if (!fs.existsSync(GENERATED_META)) return {};
    return JSON.parse(fs.readFileSync(GENERATED_META, "utf-8"));
  } catch {
    return {};
  }
}

function writeGeneratedMeta(meta: Record<string, GeneratedMeta>): void {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(GENERATED_META, JSON.stringify(meta, null, 2), "utf-8");
}

function removeGenerated(passcode: number): void {
  try {
    fs.rmSync(path.join(GENERATED_DIR, scriptName(passcode)), { force: true });
  } catch {
    // ignore
  }
  const meta = readGeneratedMeta();
  if (meta[String(passcode)]) {
    delete meta[String(passcode)];
    writeGeneratedMeta(meta);
  }
}

async function fetchOfficial(passcode: number): Promise<string | null> {
  for (const url of OFFICIAL_URLS(passcode)) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) continue;
      const text = await response.text();
      if (!text || text.startsWith("404: Not Found") || text.trim().length === 0) continue;
      fs.mkdirSync(OFFICIAL_DIR, { recursive: true });
      fs.writeFileSync(path.join(OFFICIAL_DIR, scriptName(passcode)), text, "utf-8");
      return text;
    } catch {
      // try next URL
    }
  }
  return null;
}

/**
 * Compiles and initialises the script in the real core.
 * Returns the engine's own error messages, so a generated script is never
 * trusted just because it looks plausible.
 */
export async function verifyScript(
  passcode: number,
  lua: string,
  cardOverride?: ResolveOptions["cardData"]
): Promise<{ ok: boolean; errors: string[] }> {
  try {
    const overrides = cardOverride
      ? {
          [passcode]: {
            code: passcode,
            alias: 0,
            setcodes: cardOverride.setcodes || [],
            type: cardOverride.type || 0,
            level: cardOverride.level || 0,
            attribute: cardOverride.attribute || 0,
            race: BigInt(cardOverride.race || 0),
            attack: cardOverride.atk || 0,
            defense: cardOverride.def || 0,
            lscale: 0,
            rscale: 0,
            link_marker: 0
          }
        }
      : undefined;

    const result = await runOcgCoreDuel({
      deckA: [passcode],
      deckB: [passcode],
      startingDrawCount: 0,
      drawCountPerTurn: 0,
      maxSteps: 6,
      seed: [3n, 5n, 7n, 11n],
      scriptOverrides: { [scriptName(passcode)]: lua },
      cardOverrides: overrides as any,
      responder: () => null
    });
    const relevant = result.errors.filter(
      (e) => e.includes(scriptName(passcode)) || /initial_effect|CallCardFunction/.test(e)
    );
    return { ok: relevant.length === 0, errors: relevant };
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }
}

export interface ResolveOptions {
  allowGenerate?: boolean;
  /** Re-check upstream even if an official copy is already cached. */
  refreshOfficial?: boolean;
  /** Skip engine verification for generated scripts (faster, less safe). */
  skipVerify?: boolean;
  /** Card data to use when the card is not in cards.cdb (news cards, custom cards). */
  cardData?: { code: number; name: string; desc: string; type: number; level?: number; race?: number; attribute?: number; atk?: number; def?: number; setcodes?: number[] };
}

/** Auto-generated scripts carry this marker; they must never outrank an official file. */
export function isAutoGenerated(script: string): boolean {
  return script.includes("AUTO-GENERATED SCRIPT") || script.includes("AUTO-GENERATED by yugioh-assistant-mcp");
}

/**
 * Resolves the script for a passcode, generating one when nothing official
 * exists and swapping it out once the official script shows up.
 */
export async function resolveCardScript(passcode: number, options: ResolveOptions = {}): Promise<ResolvedScript> {
  const name = scriptName(passcode);
  const card = options.cardData
    ? ({ ...options.cardData, setcodes: options.cardData.setcodes || [] } as unknown as CardData)
    : await readCardData(passcode);
  const cardName = card?.name || `Card ${passcode}`;

  const manual = readIfExists(path.join(MANUAL_DIR, name));
  if (manual) return { passcode, available: true, provenance: "manual", text: manual, path: path.join(MANUAL_DIR, name), cardName };

  const customPath = path.join(CUSTOM_DIR, name);
  const custom = readIfExists(customPath);
  const customIsGenerated = Boolean(custom && isAutoGenerated(custom));
  if (custom && !customIsGenerated) {
    return { passcode, available: true, provenance: "custom", text: custom, path: customPath, cardName };
  }

  const cachedOfficialPath = path.join(OFFICIAL_DIR, name);
  let official = options.refreshOfficial ? null : readIfExists(cachedOfficialPath);
  if (!official) official = await fetchOfficial(passcode);

  if (official) {
    const generatedExisted = fs.existsSync(path.join(GENERATED_DIR, name)) || customIsGenerated;
    if (fs.existsSync(path.join(GENERATED_DIR, name))) removeGenerated(passcode);
    // An auto-generated file that was migrated into custom_cards must not shadow the official one.
    if (customIsGenerated) {
      try {
        fs.rmSync(customPath, { force: true });
      } catch {
        // ignore
      }
      removeGenerated(passcode);
    }
    return {
      passcode,
      available: true,
      provenance: "official",
      text: official,
      path: cachedOfficialPath,
      cardName,
      replacedGenerated: generatedExisted
    };
  }

  // No official script. Reuse a generated one if the card text has not changed.
  const generatedPath = path.join(GENERATED_DIR, name);
  const meta = readGeneratedMeta();
  const existingMeta = meta[String(passcode)];
  const existingText = readIfExists(generatedPath);
  const currentHash = cardTextHash(card);

  if (existingText && existingMeta && existingMeta.cardTextHash === currentHash) {
    return {
      passcode,
      available: true,
      provenance: "generated",
      text: existingText,
      path: generatedPath,
      cardName,
      generated: existingMeta
    };
  }

  if (!options.allowGenerate) {
    return {
      passcode,
      available: false,
      cardName,
      reason: "No official script. Enable allowGenerate to let the MCP generate a temporary script."
    };
  }

  if (!card) {
    return {
      passcode,
      available: false,
      cardName,
      reason: "No card data in cards.cdb, so a script cannot be generated."
    };
  }

  const generated = generateLuaFromCardData(card);
  const verification = options.skipVerify ? { ok: true, errors: [] } : await verifyScript(passcode, generated.lua);

  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(generatedPath, generated.lua, "utf-8");

  const newMeta: GeneratedMeta = {
    passcode,
    createdAt: new Date().toISOString(),
    cardName: card.name,
    cardTextHash: currentHash,
    confidence: generated.confidence,
    patterns: generated.patterns,
    notes: generated.notes,
    verified: verification.ok,
    errors: verification.errors
  };
  meta[String(passcode)] = newMeta;
  writeGeneratedMeta(meta);

  return {
    passcode,
    available: true,
    provenance: "generated",
    text: generated.lua,
    path: generatedPath,
    cardName,
    generated: newMeta
  };
}

export interface NewsCardScriptResult {
  available: boolean;
  sourceUrl: string;
  articleTitle?: string;
  card?: {
    tempId: number;
    name: string;
    type: string;
    text?: string;
    stats: Record<string, unknown>;
    images: string[];
  };
  provenance?: ScriptProvenance;
  confidence?: GeneratedScript["confidence"];
  patterns?: string[];
  verified?: boolean;
  errors?: string[];
  scriptPath?: string;
  /** True when the temporary card was written to the custom-card registry. */
  registered?: boolean;
  reason?: string;
}

/** Maps a human card type to the ocgcore type bitmask. */
export function cardTypeMask(type?: string): number {
  const t = (type || "").toLowerCase();
  const MONSTER = 0x1;
  const SPELL = 0x2;
  const TRAP = 0x4;
  const NORMAL = 0x10;
  const EFFECT = 0x20;
  const FUSION = 0x40;
  const RITUAL = 0x80;
  const SYNCHRO = 0x2000;
  const XYZ = 0x800000;
  const LINK = 0x4000000;
  const PENDULUM = 0x1000000;
  const QUICKPLAY = 0x10000;
  const CONTINUOUS = 0x20000;
  const EQUIP = 0x40000;
  const FIELD = 0x80000;
  const COUNTER = 0x100000;

  if (t.includes("link")) return MONSTER | EFFECT | LINK;
  if (t.includes("xyz")) return MONSTER | EFFECT | XYZ;
  if (t.includes("synchro")) return MONSTER | EFFECT | SYNCHRO;
  if (t.includes("fusion")) return MONSTER | EFFECT | FUSION;
  if (t.includes("ritual monster")) return MONSTER | EFFECT | RITUAL;
  if (t.includes("pendulum")) return MONSTER | EFFECT | PENDULUM;
  if (t.includes("normal monster")) return MONSTER | NORMAL;
  if (t.includes("monster")) return MONSTER | EFFECT;
  if (t.includes("counter trap")) return TRAP | COUNTER;
  if (t.includes("continuous trap")) return TRAP | CONTINUOUS;
  if (t.includes("trap")) return TRAP;
  if (t.includes("quick-play") || t.includes("quick play")) return SPELL | QUICKPLAY;
  if (t.includes("continuous spell")) return SPELL | CONTINUOUS;
  if (t.includes("field spell")) return SPELL | FIELD;
  if (t.includes("equip spell")) return SPELL | EQUIP;
  if (t.includes("ritual spell")) return SPELL | RITUAL;
  if (t.includes("spell")) return SPELL;
  return MONSTER | EFFECT;
}

function nextTempId(): number {
  let max = 990000000;
  try {
    const registryPath = path.join(ROOT, "data", "custom_registry.json");
    if (fs.existsSync(registryPath)) {
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      const ids = (Array.isArray(registry) ? registry : registry.cards || []).map((r: any) => Number(r.tempId) || 0);
      if (ids.length) max = Math.max(max, ...ids);
    }
  } catch {
    // fall back to the base range
  }
  try {
    for (const file of fs.readdirSync(GENERATED_DIR)) {
      const m = file.match(/^c(\d+)\.lua$/);
      if (m && Number(m[1]) >= max) max = Math.max(max, Number(m[1]));
    }
  } catch {
    // ignore
  }
  return max + 1;
}

/**
 * Turns a news article into a card record + generated script.
 *
 * This is the "brand new card" path: the card has no passcode and is not in
 * cards.cdb, so the record comes from the article itself (name, artwork, text,
 * stats). The generated script is verified with the engine using a card-data
 * override, and is replaced automatically once the official script exists.
 */
export async function createScriptFromNews(
  url: string,
  options: { tempId?: number; cardName?: string; skipVerify?: boolean } = {}
): Promise<NewsCardScriptResult> {
  const extraction = await extractCardFromArticle(url, { cardName: options.cardName });
  if (!extraction.available) {
    return { available: false, sourceUrl: url, reason: extraction.reason || "The article could not be parsed." };
  }

  const tempId = options.tempId ?? nextTempId();
  const name = options.cardName || extraction.cardName || `Unrevealed card ${tempId}`;
  const type = cardTypeMask(extraction.stats.type);
  const desc = extraction.text || "";

  const cardData = {
    code: tempId,
    name,
    desc,
    type,
    level: extraction.stats.level || extraction.stats.rank || extraction.stats.link || 0,
    race: 0,
    attribute: 0,
    atk: extraction.stats.atk || 0,
    def: extraction.stats.def || 0,
    setcodes: [] as number[]
  };

  const generated = generateLuaFromCardData(cardData as CardData);
  const verification = options.skipVerify
    ? { ok: true, errors: [] as string[] }
    : await verifyScript(tempId, generated.lua, cardData);

  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const scriptPath = path.join(GENERATED_DIR, scriptName(tempId));
  fs.writeFileSync(scriptPath, generated.lua, "utf-8");

  const meta = readGeneratedMeta();
  meta[String(tempId)] = {
    passcode: tempId,
    createdAt: new Date().toISOString(),
    cardName: name,
    cardTextHash: cardTextHash(cardData as CardData),
    confidence: generated.confidence,
    patterns: generated.patterns,
    notes: [
      ...generated.notes,
      `Source article: ${url}`,
      extraction.images.length ? `Artwork candidates: ${extraction.images.slice(0, 3).join(", ")}` : "No artwork URL found."
    ],
    verified: verification.ok,
    errors: verification.errors
  };
  writeGeneratedMeta(meta);

  // Register the temporary card so ygo_migrate_temp_card can move it to the real
  // passcode later, and so the rest of the system can see it.
  let registered = false;
  try {
    const { registerCustomCard } = await import("../custom-cards/registry.js");
    registerCustomCard({
      name,
      origin: "unreleased_official",
      sourceUrl: url,
      luaCode: generated.lua,
      cardData: {
        id: tempId,
        type: extraction.stats.type || "Effect Monster",
        desc,
        atk: extraction.stats.atk,
        def: extraction.stats.def,
        level: extraction.stats.level || extraction.stats.rank || extraction.stats.link,
        race: extraction.stats.race,
        attribute: extraction.stats.attribute,
        card_images: extraction.images.map((imageUrl) => ({ id: tempId, image_url: imageUrl, image_url_small: imageUrl }))
      } as any
    });
    registered = true;
  } catch {
    // Registration is best-effort: the generated script is still usable.
  }

  return {
    available: true,
    sourceUrl: url,
    articleTitle: extraction.articleTitle,
    card: {
      tempId,
      name,
      type: extraction.stats.type || "Effect Monster",
      text: extraction.text,
      stats: { ...extraction.stats },
      images: extraction.images
    },
    provenance: "generated",
    confidence: generated.confidence,
    patterns: generated.patterns,
    verified: verification.ok,
    errors: verification.errors,
    scriptPath,
    registered
  };
}

export function listGeneratedScripts(): GeneratedMeta[] {
  const meta = readGeneratedMeta();
  return Object.values(meta).sort((a, b) => a.passcode - b.passcode);
}

export interface ScriptInventory {
  generated: number;
  officialCached: number;
  manual: number;
  custom: number;
  generatedEntries: GeneratedMeta[];
}

export function scriptInventory(): ScriptInventory {
  const count = (dir: string) => {
    try {
      return fs.readdirSync(dir).filter((f) => /^c\d+\.lua$/.test(f)).length;
    } catch {
      return 0;
    }
  };
  return {
    generated: count(GENERATED_DIR),
    officialCached: count(OFFICIAL_DIR),
    manual: count(MANUAL_DIR),
    custom: count(CUSTOM_DIR),
    generatedEntries: listGeneratedScripts()
  };
}

/**
 * Checks every generated script for an available official replacement.
 * Intended to be called on a schedule or on demand.
 */
export async function upgradeGeneratedScripts(): Promise<{
  checked: number;
  replaced: Array<{ passcode: number; cardName: string }>;
  stillGenerated: number;
}> {
  const entries = listGeneratedScripts();
  const replaced: Array<{ passcode: number; cardName: string }> = [];

  for (const entry of entries) {
    const resolved = await resolveCardScript(entry.passcode, { allowGenerate: false });
    if (resolved.provenance === "official") {
      replaced.push({ passcode: entry.passcode, cardName: entry.cardName });
    }
  }

  return {
    checked: entries.length,
    replaced,
    stillGenerated: listGeneratedScripts().length
  };
}
