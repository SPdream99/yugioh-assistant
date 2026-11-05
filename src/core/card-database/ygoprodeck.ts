import fs from 'node:fs/promises';
import { httpFetch } from '../http/fetch-client.js';
import fsSync from 'node:fs';
import path from 'node:path';
import { getDataRoot } from '../../utils/paths.js';
import type { Card, CardFilter } from '../../types/card.js';
import type { DeckData, ResolvedDeck } from '../../types/deck.js';

interface CacheData {
  timestamp: number;
  data: Card[];
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_PATH = path.join(getDataRoot(), 'data', 'cache', 'cards_cache.json');

export class CardDatabase {
  private static instance?: CardDatabase;
  public cards: Map<number, Card> = new Map();
  public nameIndex: Map<string, Card> = new Map();
  public cacheTimestamp?: number;
  private cachePath: string;

  public static getInstance(cachePath: string = DEFAULT_CACHE_PATH): CardDatabase {
    if (!CardDatabase.instance) {
      CardDatabase.instance = new CardDatabase(cachePath, true);
    }
    return CardDatabase.instance;
  }

  constructor(cachePath: string = DEFAULT_CACHE_PATH, autoLoadCache = false) {
    this.cachePath = cachePath;
    this.populateFallbackCards();
    if (autoLoadCache) {
      this.loadCacheSync();
    }
  }

  public loadCacheSync(): void {
    try {
      if (fsSync.existsSync(this.cachePath)) {
        const raw = fsSync.readFileSync(this.cachePath, 'utf8');
        const parsed = JSON.parse(raw);
        let cardList: Card[] = [];
        if (Array.isArray(parsed)) {
          cardList = parsed;
        } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.data)) {
          cardList = parsed.data;
          if (typeof parsed.timestamp === 'number') {
            this.cacheTimestamp = parsed.timestamp;
          }
        }
        for (const card of cardList) {
          this.indexCard(card);
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * Populates built-in fallback card stubs for core staples so the database
   * is usable even without network connectivity or cache.
   */
  private populateFallbackCards(): void {
    const fallbackStubs: Card[] = [
      {
        id: 14558127,
        name: 'Ash Blossom & Joyous Spring',
        type: 'Tuner Monster',
        frameType: 'effect',
        desc: 'When a card or effect is activated that includes any of these effects (Quick Effect): You can discard this card; negate that effect.\n● Add a card from the Deck to the hand.\n● Special Summon from the Deck.\n● Send a card from the Deck to the GY.\nYou can only use this effect of "Ash Blossom & Joyous Spring" once per turn.',
        atk: 0,
        def: 1800,
        level: 3,
        race: 'Zombie',
        attribute: 'FIRE',
        banlist_info: { ban_tcg: 'Semi-Limited', ban_ocg: 'Semi-Limited' }
      },
      {
        id: 89631139,
        name: 'Blue-Eyes White Dragon',
        type: 'Normal Monster',
        frameType: 'normal',
        desc: 'This legendary dragon is a powerful engine of destruction. Virtually invincible, very few have faced this awesome creature and lived to tell the tale.',
        atk: 3000,
        def: 2500,
        level: 8,
        race: 'Dragon',
        attribute: 'LIGHT',
        archetype: 'Blue-Eyes'
      },
      {
        id: 46986414,
        name: 'Dark Magician',
        type: 'Normal Monster',
        frameType: 'normal',
        desc: 'The ultimate wizard in terms of attack and defense.',
        atk: 2500,
        def: 2100,
        level: 7,
        race: 'Spellcaster',
        attribute: 'DARK',
        archetype: 'Dark Magician'
      },
      {
        id: 23434538,
        name: 'Maxx "C"',
        type: 'Effect Monster',
        frameType: 'effect',
        desc: 'During either player\'s turn: You can send this card from your hand to the GY; this turn, each time your opponent Special Summons a monster(s), immediately draw 1 card. You can only use 1 "Maxx "C"" per turn.',
        atk: 500,
        def: 200,
        level: 2,
        race: 'Insect',
        attribute: 'EARTH',
        banlist_info: { ban_tcg: 'Forbidden', ban_ocg: 'Semi-Limited' }
      },
      {
        id: 27204311,
        name: 'Nibiru, the Primal Being',
        type: 'Effect Monster',
        frameType: 'effect',
        desc: 'During the Main Phase, if your opponent Normal or Special Summoned 5 or more monsters this turn (Quick Effect): You can Tribute as many face-up monsters on the field as possible, and if you do, Special Summon this card from your hand, then Special Summon 1 "Primal Being Token" to your opponent\'s field.',
        atk: 3000,
        def: 600,
        level: 11,
        race: 'Rock',
        attribute: 'LIGHT'
      },
      {
        id: 55144522,
        name: 'Pot of Greed',
        type: 'Spell Card',
        frameType: 'spell',
        desc: 'Draw 2 cards.',
        race: 'Normal',
        banlist_info: { ban_tcg: 'Forbidden', ban_ocg: 'Forbidden', ban_goat: 'Limited' }
      },
      {
        id: 67441435,
        name: 'Glow-Up Bulb',
        type: 'Tuner Monster',
        frameType: 'effect',
        desc: 'If this card is in the GY: You can send the top card of your Deck to the GY, and if you do, Special Summon this card. You can only use this effect of "Glow-Up Bulb" once per Duel.',
        atk: 100,
        def: 100,
        level: 1,
        race: 'Plant',
        attribute: 'EARTH',
        banlist_info: { ban_tcg: 'Forbidden', ban_ocg: 'Forbidden' }
      },
      {
        id: 1861629,
        name: 'Decode Talker',
        type: 'Link Monster',
        frameType: 'link',
        desc: '2+ Effect Monsters. Gains 500 ATK for each monster it points to. When your opponent activates a card or effect that targets a card(s) you control (Quick Effect): You can Tribute 1 monster this card points to; negate the activation, and if you do, destroy that card.',
        atk: 2300,
        linkval: 3,
        linkmarkers: ['Top', 'Bottom-Left', 'Bottom-Right'],
        race: 'Cyberse',
        attribute: 'DARK',
        archetype: 'Code Talker'
      },
      {
        id: 84013237,
        name: 'Number 39: Utopia',
        type: 'XYZ Monster',
        frameType: 'xyz',
        desc: '2 Level 4 monsters. When a monster declares an attack: You can detach 1 material from this card; negate the attack.',
        atk: 2500,
        def: 2000,
        level: 4,
        race: 'Warrior',
        attribute: 'LIGHT',
        archetype: 'Utopia'
      }
    ];

    for (const card of fallbackStubs) {
      this.cards.set(card.id, card);
      this.nameIndex.set(card.name.toLowerCase(), card);
    }
  }

  /**
   * Registers a card into internal collections.
   */
  private indexCard(card: Card): void {
    this.cards.set(card.id, card);
    this.nameIndex.set(card.name.toLowerCase(), card);
  }

  /**
   * Ensures the cache directory exists on disk.
   */
  private async ensureCacheDir(): Promise<void> {
    const dir = path.dirname(this.cachePath);
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Reads cards_cache.json if it exists and checks age (< 7 days).
   * Populates cards map and nameIndex if fresh.
   */
  public async loadCache(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.cachePath, 'utf8');
      const parsed = JSON.parse(raw);

      let timestamp = 0;
      let cardList: Card[] = [];

      if (Array.isArray(parsed)) {
        cardList = parsed;
        const stats = await fs.stat(this.cachePath);
        timestamp = stats.mtimeMs;
      } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.data)) {
        cardList = parsed.data;
        timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
      }

      if (cardList.length === 0) {
        return false;
      }

      const age = Date.now() - timestamp;
      if (age > SEVEN_DAYS_MS) {
        return false;
      }

      for (const card of cardList) {
        this.indexCard(card);
      }
      this.cacheTimestamp = timestamp;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetches card database from YGOPRODeck API or cache.
   * If offline, falls back to stale cache or fallback stubs without throwing.
   */
  public async fetchCards(forceRefresh = false): Promise<Card[]> {
    if (!forceRefresh) {
      const loaded = await this.loadCache();
      if (loaded) {
        return Array.from(this.cards.values());
      }
    }

    try {
      const response = await httpFetch('https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes', {
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        const json = await response.json() as any;
        const cardList: Card[] = Array.isArray(json) ? json : (json.data || []);

        if (Array.isArray(cardList) && cardList.length > 0) {
          for (const card of cardList) {
            this.indexCard(card);
          }

          this.cacheTimestamp = Date.now();
          await this.ensureCacheDir();
          const cacheContent: CacheData = {
            timestamp: this.cacheTimestamp,
            data: cardList
          };
          await fs.writeFile(this.cachePath, JSON.stringify(cacheContent), 'utf8');

          return cardList;
        }
      }
    } catch {
      // Network failed or timed out. Attempt to load stale cache regardless of age.
      try {
        const raw = await fs.readFile(this.cachePath, 'utf8');
        const parsed = JSON.parse(raw);
        const cardList: Card[] = Array.isArray(parsed) ? parsed : (parsed.data || []);
        if (cardList.length > 0) {
          for (const card of cardList) {
            this.indexCard(card);
          }
          if (parsed && typeof parsed.timestamp === 'number') {
            this.cacheTimestamp = parsed.timestamp;
          }
          return Array.from(this.cards.values());
        }
      } catch {
        // No cache available; retain built-in stubs without throwing
      }
    }

    return Array.from(this.cards.values());
  }

  /**
   * Refreshes the full card database when the cache is older than maxAgeHours.
   * Returns true only when a live refresh actually succeeded.
   */
  public async ensureFresh(maxAgeHours: number = 24): Promise<boolean> {
    const ageHours = this.cacheTimestamp
      ? (Date.now() - this.cacheTimestamp) / 3600000
      : Number.POSITIVE_INFINITY;
    if (ageHours <= maxAgeHours) return false;
    try {
      await this.fetchCards(true);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Looks up a card by its numeric ID.
   */
  public getCardById(id: number): Card | undefined {
    return this.cards.get(id);
  }

  /**
   * Looks up a card by name: case-insensitive exact match first, then substring match.
   */
  public getCardByName(name: string): Card | undefined {
    const trimmed = name.trim();
    if (!trimmed) return undefined;

    const lower = trimmed.toLowerCase();

    // 1. Exact match
    const exact = this.nameIndex.get(lower);
    if (exact) return exact;

    // 2. Substring / fuzzy search
    for (const card of this.cards.values()) {
      if (card.name.toLowerCase().includes(lower)) {
        return card;
      }
      const betaName = (card as any).misc_info?.[0]?.beta_name?.toLowerCase();
      if (betaName && betaName === lower) {
        return card;
      }
    }

    if (lower === "ritual of light and darkness" || lower === "rolad") {
      for (const card of this.cards.values()) {
        if (card.name.toLowerCase() === "light and darkness ritual") {
          return card;
        }
      }
    }

    return undefined;
  }

  /**
   * Online fallback fetch by name or id when card is not found locally.
   */
  public async fetchCardOnline(query: string | number): Promise<Card | undefined> {
    try {
      const axiosModule = await import('axios');
      const axios = axiosModule.default || axiosModule;
      const params: Record<string, any> = { misc: 'yes' };
      if (typeof query === 'number') {
        params.id = query;
      } else {
        const trimmed = query.trim();
        if (trimmed.toLowerCase() === "rolad" || trimmed.toLowerCase() === "ritual of light and darkness") {
          params.name = "Light and Darkness Ritual";
        } else {
          // Exact name first; fuzzy fname is only a fallback below.
          params.name = trimmed;
        }
      }
      let resp: any = null;
      try {
        resp = await axios.get('https://db.ygoprodeck.com/api/v7/cardinfo.php', {
          params,
          timeout: 8000
        });
      } catch {
        resp = null;
      }

      // Exact-name lookup failed (404/400 or empty): retry with fuzzy fname.
      if ((!resp?.data?.data || resp.data.data.length === 0) && typeof query === 'string') {
        try {
          resp = await axios.get('https://db.ygoprodeck.com/api/v7/cardinfo.php', {
            params: { misc: 'yes', fname: query.trim() },
            timeout: 8000
          });
        } catch {
          resp = null;
        }
      }
      if (resp.data && Array.isArray(resp.data.data) && resp.data.data.length > 0) {
        for (const c of resp.data.data) {
          this.indexCard(c);
        }
        return resp.data.data[0];
      }
    } catch {
      // online lookup failed
    }
    return undefined;
  }

  /**
   * Searches loaded cards matching filter criteria.
   */
  public searchCards(filter: CardFilter): Card[] {
    const results: Card[] = [];

    const matchNumber = (val: number | undefined, range: number | { min?: number; max?: number } | undefined): boolean => {
      if (range === undefined) return true;
      if (val === undefined) return false;
      if (typeof range === 'number') {
        return val === range;
      }
      if (range.min !== undefined && val < targetMinOrMax(range.min, val, 'min')) return false;
      if (range.max !== undefined && val > targetMinOrMax(range.max, val, 'max')) return false;
      return true;
    };

    function targetMinOrMax(limit: number, _val: number, _type: 'min' | 'max'): number {
      return limit;
    }

    for (const card of this.cards.values()) {
      // Name
      if (filter.name) {
        const filterName = filter.name.toLowerCase();
        const cardName = card.name.toLowerCase();
        const betaName = (card as any).misc_info?.[0]?.beta_name?.toLowerCase();
        const isMatch = cardName.includes(filterName) ||
          (betaName && betaName.includes(filterName)) ||
          ((filterName === "rolad" || filterName === "ritual of light and darkness") &&
            (cardName.includes("light and darkness") || (card.archetype && card.archetype.toLowerCase().includes("light and darkness ritual"))));
        if (!isMatch) {
          continue;
        }
      }

      // Type
      if (filter.type && !card.type.toLowerCase().includes(filter.type.toLowerCase())) {
        continue;
      }

      // Race
      if (filter.race && (!card.race || card.race.toLowerCase() !== filter.race.toLowerCase())) {
        continue;
      }

      // Attribute
      if (filter.attribute && (!card.attribute || card.attribute.toLowerCase() !== filter.attribute.toLowerCase())) {
        continue;
      }

      // Archetype
      if (filter.archetype && (!card.archetype || !card.archetype.toLowerCase().includes(filter.archetype.toLowerCase()))) {
        continue;
      }

      // Description
      if (filter.desc && (!card.desc || !card.desc.toLowerCase().includes(filter.desc.toLowerCase()))) {
        continue;
      }

      // Numeric ranges
      if (!matchNumber(card.level, filter.level)) continue;
      if (!matchNumber(card.atk, filter.atk)) continue;
      if (!matchNumber(card.def, filter.def)) continue;
      if (!matchNumber(card.scale, filter.scale)) continue;
      if (!matchNumber(card.linkval, filter.linkval)) continue;

      // Banlist / Format checks
      if (filter.banlist) {
        const banTarget = filter.banlist.toLowerCase();
        const banInfo = card.banlist_info;
        if (!banInfo) continue;

        const hasMatchingStatus =
          (banInfo.ban_tcg && banInfo.ban_tcg.toLowerCase().includes(banTarget)) ||
          (banInfo.ban_ocg && banInfo.ban_ocg.toLowerCase().includes(banTarget)) ||
          (banInfo.ban_goat && banInfo.ban_goat.toLowerCase().includes(banTarget));

        if (!hasMatchingStatus) continue;
      }

      if (filter.format) {
        const fmtTarget = filter.format.toLowerCase();
        const banInfo = card.banlist_info;
        const matchesFormat =
          (fmtTarget === 'tcg' && !!banInfo?.ban_tcg) ||
          (fmtTarget === 'ocg' && !!banInfo?.ban_ocg) ||
          (fmtTarget === 'goat' && !!banInfo?.ban_goat);

        if (!matchesFormat) continue;
      }

      results.push(card);
    }

    return results;
  }

  /**
   * Resolves card passcodes in DeckData to full Card objects.
   * Unrecognized cards are populated with a stub object.
   * Tallies card frequency across all 3 sections.
   */
  public resolveDeck(deck: DeckData): ResolvedDeck {
    const cardCounts = new Map<number, number>();

    const resolveSection = (items: (number | string | Card)[]): Card[] => {
      return items.map(item => {
        if (typeof item === 'object' && item !== null && 'id' in item) {
          cardCounts.set(item.id, (cardCounts.get(item.id) || 0) + 1);
          return item;
        }

        if (typeof item === 'string') {
          const found = this.getCardByName(item);
          if (found) {
            cardCounts.set(found.id, (cardCounts.get(found.id) || 0) + 1);
            return found;
          }
          const stub: Card = {
            id: 0,
            name: item,
            type: 'Unknown',
            frameType: 'normal',
            desc: ''
          };
          return stub;
        }

        const id = item;
        cardCounts.set(id, (cardCounts.get(id) || 0) + 1);

        const card = this.getCardById(id);
        if (card) {
          return card;
        }

        const stub: Card = {
          id,
          name: `Unknown Card (${id})`,
          type: 'Unknown',
          frameType: 'normal',
          desc: ''
        };
        return stub;
      });
    };

    const main = resolveSection(deck.main || []);
    const extra = resolveSection(deck.extra || []);
    const side = resolveSection(deck.side || []);

    return {
      name: deck.name,
      main,
      extra,
      side,
      cardCounts
    };
  }
}
