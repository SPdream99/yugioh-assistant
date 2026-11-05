import axios from "axios";
import fs from "fs";
import path from "path";
import { DeckData } from "../../types/deck.js";

export type SupportedFormat = "TCG" | "OCG" | "AE" | "Genesys" | "Master Duel";

export interface BanlistCardEntry {
  id: number;
  name: string;
  status: "Forbidden" | "Limited" | "Semi-Limited";
  maxCopies: number;
}

export interface FormatBanlist {
  format: SupportedFormat;
  lastUpdated: string;
  cards: Record<number, BanlistCardEntry>;
}

export class BanlistManager {
  private static instance: BanlistManager;
  private cachePath: string;
  private banlists: Record<SupportedFormat, FormatBanlist>;

  private constructor() {
    this.cachePath = path.resolve(process.cwd(), "data", "cache", "banlists_cache.json");
    this.banlists = {
      TCG: { format: "TCG", lastUpdated: "", cards: {} },
      OCG: { format: "OCG", lastUpdated: "", cards: {} },
      AE: { format: "AE", lastUpdated: "", cards: {} },
      Genesys: { format: "Genesys", lastUpdated: "", cards: {} },
      "Master Duel": { format: "Master Duel", lastUpdated: "", cards: {} }
    };
    this.loadCache();
    this.loadLocalCustomBanlists();
  }

  public static getInstance(): BanlistManager {
    if (!BanlistManager.instance) {
      BanlistManager.instance = new BanlistManager();
    }
    return BanlistManager.instance;
  }

  private loadCache(): boolean {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, "utf-8");
        const parsed = JSON.parse(raw);
        for (const fmt of Object.keys(this.banlists) as SupportedFormat[]) {
          if (parsed[fmt]) {
            this.banlists[fmt] = parsed[fmt];
          }
        }
        return true;
      }
    } catch {
      // Ignore cache read error
    }
    return false;
  }

  private loadLocalCustomBanlists(): void {
    // Load Asian-English (AE) from data/banlists/ae.json
    try {
      const aePath = path.resolve(process.cwd(), "data", "banlists", "ae.json");
      if (fs.existsSync(aePath)) {
        const data = JSON.parse(fs.readFileSync(aePath, "utf-8"));
        const cards: Record<number, BanlistCardEntry> = {};
        for (const id of data.banned || []) {
          cards[id] = { id, name: `Card #${id}`, status: "Forbidden", maxCopies: 0 };
        }
        for (const id of data.limited || []) {
          cards[id] = { id, name: `Card #${id}`, status: "Limited", maxCopies: 1 };
        }
        for (const id of data.semiLimited || []) {
          cards[id] = { id, name: `Card #${id}`, status: "Semi-Limited", maxCopies: 2 };
        }
        this.banlists.AE = { format: "AE", lastUpdated: data.lastUpdated || new Date().toISOString(), cards };
      }
    } catch {
      // Ignore error
    }

    // Load Genesys format from data/banlists/genesys.json
    try {
      const genPath = path.resolve(process.cwd(), "data", "banlists", "genesys.json");
      if (fs.existsSync(genPath)) {
        const data = JSON.parse(fs.readFileSync(genPath, "utf-8"));
        const cards: Record<number, BanlistCardEntry> = {};
        for (const id of data.banned || []) {
          cards[id] = { id, name: `Card #${id}`, status: "Forbidden", maxCopies: 0 };
        }
        for (const id of data.limited || []) {
          cards[id] = { id, name: `Card #${id}`, status: "Limited", maxCopies: 1 };
        }
        for (const id of data.semiLimited || []) {
          cards[id] = { id, name: `Card #${id}`, status: "Semi-Limited", maxCopies: 2 };
        }
        this.banlists.Genesys = { format: "Genesys", lastUpdated: data.lastUpdated || new Date().toISOString(), cards };
      }
    } catch {
      // Ignore error
    }
  }

  public async syncBanlists(force: boolean = false): Promise<{ success: boolean; message: string }> {
    // Check cache freshness
    const tcgAge = this.banlists.TCG.lastUpdated ? (Date.now() - new Date(this.banlists.TCG.lastUpdated).getTime()) / (1000 * 3600) : 999;
    if (!force && tcgAge < 24 && Object.keys(this.banlists.TCG.cards).length > 0) {
      return { success: true, message: `Using the cached banlist (${tcgAge.toFixed(1)}h old).` };
    }

    try {
      // 1. Fetch live TCG Banlist from YGOPRODeck
      const tcgRes = await axios.get("https://db.ygoprodeck.com/api/v7/cardinfo.php?banlist=tcg", { timeout: 12000 });
      if (tcgRes.data && Array.isArray(tcgRes.data.data)) {
        const tcgCards: Record<number, BanlistCardEntry> = {};
        for (const card of tcgRes.data.data) {
          const status = card.banlist_info?.ban_tcg;
          if (status) {
            const normalized = status === "Banned" ? "Forbidden" : (status as any);
            let maxCopies = 3;
            if (normalized === "Forbidden") maxCopies = 0;
            else if (normalized === "Limited") maxCopies = 1;
            else if (normalized === "Semi-Limited") maxCopies = 2;
            tcgCards[card.id] = { id: card.id, name: card.name, status: normalized, maxCopies };
          }
        }
        this.banlists.TCG = { format: "TCG", lastUpdated: new Date().toISOString(), cards: tcgCards };
      }

      // 2. Fetch live OCG Banlist from YGOPRODeck
      const ocgRes = await axios.get("https://db.ygoprodeck.com/api/v7/cardinfo.php?banlist=ocg", { timeout: 12000 });
      if (ocgRes.data && Array.isArray(ocgRes.data.data)) {
        const ocgCards: Record<number, BanlistCardEntry> = {};
        for (const card of ocgRes.data.data) {
          const status = card.banlist_info?.ban_ocg;
          if (status) {
            const normalized = status === "Banned" ? "Forbidden" : (status as any);
            let maxCopies = 3;
            if (normalized === "Forbidden") maxCopies = 0;
            else if (normalized === "Limited") maxCopies = 1;
            else if (normalized === "Semi-Limited") maxCopies = 2;
            ocgCards[card.id] = { id: card.id, name: card.name, status: normalized, maxCopies };
          }
        }
        this.banlists.OCG = { format: "OCG", lastUpdated: new Date().toISOString(), cards: ocgCards };
        // Master Duel closely inherits OCG base with minor tweaks
        this.banlists["Master Duel"] = {
          format: "Master Duel",
          lastUpdated: new Date().toISOString(),
          cards: { ...ocgCards }
        };
      }

      // Reload local AE and Genesys overrides
      this.loadLocalCustomBanlists();

      // Save cache
      const cacheDir = path.dirname(this.cachePath);
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify(this.banlists, null, 2), "utf-8");

      return {
        success: true,
        message: `Updated successfully: TCG (${Object.keys(this.banlists.TCG.cards).length} cards), OCG (${Object.keys(this.banlists.OCG.cards).length} cards), AE (${Object.keys(this.banlists.AE.cards).length} cards), Genesys (${Object.keys(this.banlists.Genesys.cards).length} cards)!`
      };
    } catch (e: any) {
      // In case of network error, use cached/fallback
      this.loadLocalCustomBanlists();
      return {
        success: false,
        message: `Banlist API connection failed, using the local copy: ${e.message}`
      };
    }
  }

  public getCardMaxCopies(passcode: number, format: SupportedFormat = "TCG"): number {
    const list = this.banlists[format] || this.banlists.TCG;
    const entry = list.cards[passcode];
    if (!entry) {
      // Format-specific hardcoded baseline if not in banlist (Unlimited = 3)
      // Special: Maxx "C" (23434538) is Forbidden in TCG and Genesys
      if (passcode === 23434538) {
        if (format === "TCG" || format === "Genesys") return 0;
        return 2; // Semi-Limited in OCG/AE/MD
      }
      return 3;
    }
    return entry.maxCopies;
  }

  public isCardLegal(passcode: number, format: SupportedFormat = "TCG"): boolean {
    return this.getCardMaxCopies(passcode, format) > 0;
  }

  public getBanStatus(passcode: number, format: SupportedFormat = "TCG"): "Forbidden" | "Limited" | "Semi-Limited" | "Unlimited" {
    const max = this.getCardMaxCopies(passcode, format);
    if (max === 0) return "Forbidden";
    if (max === 1) return "Limited";
    if (max === 2) return "Semi-Limited";
    return "Unlimited";
  }

  public validateDeck(deck: DeckData, format: SupportedFormat = "TCG"): { valid: boolean; violations: string[]; warnings: string[] } {
    const violations: string[] = [];
    const warnings: string[] = [];

    const totalMain = (deck.main || []).length;
    if (totalMain < 40) violations.push(`The Main Deck must have at least 40 cards (currently ${totalMain}).`);
    if (totalMain > 60) violations.push(`The Main Deck cannot exceed 60 cards (currently ${totalMain}).`);

    const totalExtra = (deck.extra || []).length;
    if (totalExtra > 15) violations.push(`The Extra Deck cannot exceed 15 cards (currently ${totalExtra}).`);

    const totalSide = (deck.side || []).length;
    if (totalSide > 15) violations.push(`The Side Deck cannot exceed 15 cards (currently ${totalSide}).`);

    // Tally card frequencies across Main, Extra, Side
    const counts = new Map<number, number>();
    const allCards = [...(deck.main || []), ...(deck.extra || []), ...(deck.side || [])];

    for (const item of allCards) {
      const id = typeof item === "number" ? item : (typeof item === "object" && item !== null && "id" in item ? Number((item as any).id) : Number(item));
      if (!isNaN(id) && id > 0) {
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }

    for (const [id, count] of counts.entries()) {
      const maxAllowed = this.getCardMaxCopies(id, format);
      const status = this.getBanStatus(id, format);

      if (count > maxAllowed) {
        if (maxAllowed === 0) {
          violations.push(`Card ${id} (${status}) is FORBIDDEN in ${format} and cannot be in the deck.`);
        } else {
          violations.push(`Card ${id} (${status}) allows at most ${maxAllowed} copies in ${format} (the deck has ${count}).`);
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      warnings
    };
  }

  /**
   * Applies a banlist snapshot that another component already fetched (the meta
   * sync), so both managers agree without a second network call.
   */
  public applyBanlistSnapshot(
    tcg: Record<number, { name: string; status: "Banned" | "Limited" | "Semi-Limited" }>,
    ocg: Record<number, { name: string; status: "Banned" | "Limited" | "Semi-Limited" }>
  ): void {
    const toEntries = (
      source: Record<number, { name: string; status: "Banned" | "Limited" | "Semi-Limited" }>
    ): Record<number, BanlistCardEntry> => {
      const entries: Record<number, BanlistCardEntry> = {};
      for (const [id, entry] of Object.entries(source || {})) {
        const status = entry.status === "Banned" ? "Forbidden" : entry.status;
        const maxCopies = status === "Forbidden" ? 0 : status === "Limited" ? 1 : 2;
        entries[Number(id)] = { id: Number(id), name: entry.name, status, maxCopies };
      }
      return entries;
    };

    const now = new Date().toISOString();
    this.banlists.TCG = { format: "TCG", lastUpdated: now, cards: toEntries(tcg) };
    this.banlists.OCG = { format: "OCG", lastUpdated: now, cards: toEntries(ocg) };
    this.banlists["Master Duel"] = { format: "Master Duel", lastUpdated: now, cards: toEntries(ocg) };
    this.persist();
  }

  private persist(): void {
    try {
      const cacheDir = path.dirname(this.cachePath);
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify(this.banlists, null, 2), "utf-8");
    } catch {
      // A read-only cache directory must not break a legality answer.
    }
  }

  public getFormatSummary(format: SupportedFormat): { format: SupportedFormat; lastUpdated: string; forbiddenCount: number; limitedCount: number; semiLimitedCount: number } {
    const list = this.banlists[format] || this.banlists.TCG;
    let forbidden = 0;
    let limited = 0;
    let semi = 0;

    for (const entry of Object.values(list.cards)) {
      if (entry.maxCopies === 0) forbidden++;
      else if (entry.maxCopies === 1) limited++;
      else if (entry.maxCopies === 2) semi++;
    }

    return {
      format,
      lastUpdated: list.lastUpdated || "Not synced",
      forbiddenCount: forbidden,
      limitedCount: limited,
      semiLimitedCount: semi
    };
  }
}
