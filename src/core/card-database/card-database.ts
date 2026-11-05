import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { Card, CardFilter } from '../../types/card.js';

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'card_cache.json');
const YGOPRODECK_API_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';

export class CardDatabase {
  private cardsMap: Map<string, Card> = new Map();
  private initialized = false;

  constructor() {
    this.loadFromCache();
  }


  private loadFromCache(): void {
    const candidateFiles = [
      path.join(CACHE_DIR, 'cards_cache.json'),
      path.join(CACHE_DIR, 'card_cache.json')
    ];
    for (const file of candidateFiles) {
      try {
        if (fs.existsSync(file)) {
          const raw = fs.readFileSync(file, 'utf-8');
          const parsed = JSON.parse(raw);
          const cards: Card[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
          for (const card of cards) {
            if (card && card.name) {
              this.cardsMap.set(card.name.toLowerCase(), card);
            }
          }
        }
      } catch {
        // cache read failed, try next
      }
    }
  }

  private saveToCache(): void {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
      const allCards = Array.from(this.cardsMap.values());
      fs.writeFileSync(CACHE_FILE, JSON.stringify(allCards, null, 2), 'utf-8');
    } catch {
      // ignore write errors
    }
  }

  public registerCard(card: Card): void {
    this.cardsMap.set(card.name.toLowerCase(), card);
    this.saveToCache();
  }

  public async getCardByName(name: string): Promise<Card | null> {
    const key = name.trim().toLowerCase();
    if (this.cardsMap.has(key)) {
      return this.cardsMap.get(key)!;
    }

    if (key === "rolad" || key === "ritual of light and darkness") {
      const match = this.cardsMap.get("light and darkness ritual");
      if (match) return match;
    }

    for (const card of this.cardsMap.values()) {
      if (card.name.toLowerCase().includes(key)) {
        return card;
      }
      const betaName = (card as any).misc_info?.[0]?.beta_name?.toLowerCase();
      if (betaName && (betaName === key || betaName.includes(key))) {
        return card;
      }
    }

    // Try fetching from online API
    try {
      const resp = await axios.get(YGOPRODECK_API_URL, {
        params: { name: name.trim() },
        timeout: 4000
      });
      if (resp.data && resp.data.data && resp.data.data.length > 0) {
        const fetchedCard: Card = resp.data.data[0];
        this.registerCard(fetchedCard);
        return fetchedCard;
      }
    } catch {
      // fallback
    }

    return null;
  }

  public async search(filter: CardFilter): Promise<Card[]> {
    // If online search parameters are provided and local count is small, optionally fetch
    if (filter.name || filter.race || filter.archetype || filter.attribute) {
      await this.tryFetchFromApi(filter);
    }

    const results: Card[] = [];
    for (const card of this.cardsMap.values()) {
      if (this.matchesFilter(card, filter)) {
        results.push(card);
      }
    }

    return results;
  }

  private async tryFetchFromApi(filter: CardFilter): Promise<void> {
    try {
      const params: Record<string, any> = {};
      if (filter.name) params.fname = filter.name;
      if (filter.race) params.race = filter.race;
      if (filter.attribute) params.attribute = filter.attribute;
      if (filter.archetype) params.archetype = filter.archetype;
      if (typeof filter.atk === 'number') params.atk = filter.atk;
      if (typeof filter.def === 'number') params.def = filter.def;
      if (typeof filter.level === 'number') params.level = filter.level;

      const resp = await axios.get(YGOPRODECK_API_URL, {
        params,
        timeout: 4000
      });

      if (resp.data && Array.isArray(resp.data.data)) {
        for (const card of resp.data.data) {
          this.cardsMap.set(card.name.toLowerCase(), card);
        }
        this.saveToCache();
      }
    } catch {
      // offline or query not found on remote, proceed with local
    }
  }

  private matchesFilter(card: Card, filter: CardFilter): boolean {
    if (filter.name) {
      const filterName = filter.name.toLowerCase();
      const cardName = card.name.toLowerCase();
      const betaName = (card as any).misc_info?.[0]?.beta_name?.toLowerCase();
      const isMatch = cardName.includes(filterName) ||
        (betaName && betaName.includes(filterName)) ||
        ((filterName === "rolad" || filterName === "ritual of light and darkness") &&
          (cardName.includes("light and darkness") || (card.archetype && card.archetype.toLowerCase().includes("light and darkness ritual"))));
      if (!isMatch) return false;
    }

    if (filter.type) {
      const filterType = filter.type.toLowerCase();
      const cardType = card.type.toLowerCase();
      if (filterType === 'monster') {
        if (!cardType.includes('monster')) return false;
      } else if (!cardType.includes(filterType)) {
        return false;
      }
    }

    if (filter.race) {
      if (!card.race || card.race.toLowerCase() !== filter.race.toLowerCase()) {
        return false;
      }
    }

    if (filter.attribute) {
      if (!card.attribute || card.attribute.toLowerCase() !== filter.attribute.toLowerCase()) {
        return false;
      }
    }

    if (filter.archetype) {
      if (!card.archetype || !card.archetype.toLowerCase().includes(filter.archetype.toLowerCase())) {
        return false;
      }
    }

    if (filter.desc) {
      if (!card.desc || !card.desc.toLowerCase().includes(filter.desc.toLowerCase())) {
        return false;
      }
    }

    // Number matching
    if (!this.matchesNumber(card.atk, filter.atk)) return false;
    if (!this.matchesNumber(card.def, filter.def)) return false;
    if (!this.matchesNumber(card.level, filter.level)) return false;

    return true;
  }

  private matchesNumber(val: number | undefined, target: number | { min?: number; max?: number } | undefined): boolean {
    if (target === undefined) return true;
    if (val === undefined) return false;

    if (typeof target === 'number') {
      return val === target;
    }

    if (target.min !== undefined && val < target.min) return false;
    if (target.max !== undefined && val > target.max) return false;

    return true;
  }

  public getCardById(id: number): Card | undefined {
    for (const card of this.cardsMap.values()) {
      if (card.id === id) return card;
    }

    // Official passcode to card name mapping
    const PASSCODE_MAP: Record<number, string> = {
      61245789: 'Aluber the Jester of Despia',
      32603893: 'Fallen of Albaz',
      44146295: 'Branded Fusion',
      78942511: 'Branded Opening',
      8730435: 'Albion the Branded Dragon',
      44097050: 'Mirrorjade the Iceblade Dragon',
      55623480: 'Fairy Tail - Snow',
      7902349: 'Fairy Tail - Luna',
      14558127: 'Ash Blossom & Joyous Spring'
    };

    if (PASSCODE_MAP[id]) {
      const card = this.cardsMap.get(PASSCODE_MAP[id].toLowerCase());
      if (card) {
        return { ...card, id };
      }
    }

    return undefined;
  }

  public getAllCards(): Card[] {
    return Array.from(this.cardsMap.values());
  }
}

export const cardDatabase = new CardDatabase();
