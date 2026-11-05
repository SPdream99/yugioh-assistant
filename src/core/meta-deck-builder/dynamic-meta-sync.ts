import axios from "axios";
import fs from "fs";
import path from "path";
import { BanlistManager, SupportedFormat } from "../banlist/banlist-manager.js";

export interface MetaStaple {
  id: number;
  name: string;
  type: string;
  category: "Hand Traps" | "Board Breakers" | "Consistency" | "Extra Deck" | string;
  tier: "S" | "A" | "B" | "Tech";
  desc?: string;
}

export interface BanlistEntry {
  name: string;
  status: "Banned" | "Limited" | "Semi-Limited";
}

export interface TopArchetype {
  name: string;
  tier: number;
  sharePercentage: number;
  coreCards: number[];
  flexSlots: number;
}

export interface MetaCache {
  lastSynced: string;
  tcgBanlist: Record<number, { name: string; status: "Banned" | "Limited" | "Semi-Limited" }>;
  ocgBanlist: Record<number, { name: string; status: "Banned" | "Limited" | "Semi-Limited" }>;
  liveStaples: { id: number; name: string; type: string; category: string; tier: "S" | "A" | "B" | "Tech" }[];
  topArchetypes: { name: string; tier: number; sharePercentage: number; coreCards: number[]; flexSlots: number }[];
}

export interface SyncMetaResult {
  success: boolean;
  isFallback?: boolean;
  dataSource?: "live" | "disk_cache" | "builtin_fallback";
  staplesCount: number;
  banlistChanges: number;
  message: string;
}

export interface MetaStatus {
  lastSynced: string;
  totalStaples: number;
  tcgBannedCount: number;
  tcgLimitedCount: number;
  tcgSemiLimitedCount: number;
  ocgBannedCount: number;
  ocgLimitedCount: number;
  ocgSemiLimitedCount: number;
  topArchetypesCount: number;
}

const DEFAULT_CACHE_PATH = path.resolve(process.cwd(), "data", "cache", "meta_cache.json");
const STAPLES_API_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php?staple=yes";
const TCG_BANLIST_API_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php?banlist=tcg";
const OCG_BANLIST_API_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php?banlist=ocg";

/**
 * Built-in fallback staples for guaranteed offline support.
 */
const FALLBACK_STAPLES: { id: number; name: string; type: string; category: string; tier: "S" | "A" | "B" | "Tech" }[] = [
  // Hand Traps
  { id: 14558127, name: "Ash Blossom & Joyous Spring", type: "Tuner Monster", category: "Hand Traps", tier: "S" },
  { id: 10045474, name: "Infinite Impermanence", type: "Trap Card", category: "Hand Traps", tier: "S" },
  { id: 27204311, name: "Nibiru, the Primal Being", type: "Effect Monster", category: "Hand Traps", tier: "S" },
  { id: 23434538, name: 'Maxx "C"', type: "Effect Monster", category: "Hand Traps", tier: "S" },
  { id: 94145021, name: "Droll & Lock Bird", type: "Effect Monster", category: "Hand Traps", tier: "S" },
  { id: 97268402, name: "Effect Veiler", type: "Tuner Monster", category: "Hand Traps", tier: "S" },
  { id: 73642296, name: "Ghost Belle & Haunted Mansion", type: "Tuner Monster", category: "Hand Traps", tier: "A" },
  { id: 59438930, name: "Ghost Ogre & Snow Rabbit", type: "Tuner Monster", category: "Hand Traps", tier: "A" },
  { id: 91800273, name: "Dimension Shifter", type: "Effect Monster", category: "Hand Traps", tier: "A" },
  { id: 78661338, name: "Fantastical Dragon Phantazmay", type: "Effect Monster", category: "Hand Traps", tier: "Tech" },
  { id: 38814750, name: "PSY-Framegear Gamma", type: "Tuner Monster", category: "Hand Traps", tier: "B" },
  { id: 67750322, name: "Skull Meister", type: "Effect Monster", category: "Hand Traps", tier: "Tech" },
  { id: 23002292, name: "Red Reboot", type: "Trap Card", category: "Hand Traps", tier: "B" },
  { id: 1082946, name: "Mulcharmy Fuwalos", type: "Effect Monster", category: "Hand Traps", tier: "S" },
  { id: 6511113, name: "Mulcharmy Purulia", type: "Effect Monster", category: "Hand Traps", tier: "A" },

  // Board Breakers
  { id: 54693926, name: "Dark Ruler No More", type: "Spell Card", category: "Board Breakers", tier: "A" },
  { id: 24299458, name: "Forbidden Droplet", type: "Spell Card", category: "Board Breakers", tier: "S" },
  { id: 15693423, name: "Evenly Matched", type: "Trap Card", category: "Board Breakers", tier: "S" },
  { id: 14532163, name: "Lightning Storm", type: "Spell Card", category: "Board Breakers", tier: "A" },
  { id: 18144507, name: "Harpie's Feather Duster", type: "Spell Card", category: "Board Breakers", tier: "A" },
  { id: 48130397, name: "Super Polymerization", type: "Spell Card", category: "Board Breakers", tier: "A" },
  { id: 55063751, name: "Gameciel, the Sea Turtle Kaiju", type: "Effect Monster", category: "Board Breakers", tier: "B" },
  { id: 10000080, name: "The Winged Dragon of Ra - Sphere Mode", type: "Effect Monster", category: "Board Breakers", tier: "Tech" },
  { id: 82385847, name: "Dinowrestler Pankratops", type: "Effect Monster", category: "Board Breakers", tier: "Tech" },
  { id: 12580477, name: "Raigeki", type: "Spell Card", category: "Board Breakers", tier: "B" },
  { id: 53129443, name: "Dark Hole", type: "Spell Card", category: "Board Breakers", tier: "B" },
  { id: 8267140, name: "Cosmic Cyclone", type: "Spell Card", category: "Board Breakers", tier: "A" },
  { id: 43898403, name: "Twin Twisters", type: "Spell Card", category: "Board Breakers", tier: "B" },
  { id: 41420027, name: "Solemn Judgment", type: "Trap Card", category: "Board Breakers", tier: "B" },
  { id: 40605147, name: "Solemn Strike", type: "Trap Card", category: "Board Breakers", tier: "B" },
  { id: 84749824, name: "Solemn Warning", type: "Trap Card", category: "Board Breakers", tier: "Tech" },
  { id: 83326048, name: "Dimensional Barrier", type: "Trap Card", category: "Board Breakers", tier: "B" },
  { id: 58921041, name: "Anti-Spell Fragrance", type: "Trap Card", category: "Board Breakers", tier: "B" },

  // Consistency & Spells
  { id: 24224830, name: "Called by the Grave", type: "Spell Card", category: "Consistency", tier: "S" },
  { id: 65681983, name: "Crossout Designator", type: "Spell Card", category: "Consistency", tier: "S" },
  { id: 25311006, name: "Triple Tactics Talent", type: "Spell Card", category: "Consistency", tier: "S" },
  { id: 85106520, name: "Triple Tactics Thrust", type: "Spell Card", category: "Consistency", tier: "S" },
  { id: 81439173, name: "Foolish Burial", type: "Spell Card", category: "Consistency", tier: "B" },
  { id: 35261759, name: "Pot of Desires", type: "Spell Card", category: "Consistency", tier: "A" },
  { id: 49238328, name: "Pot of Extravagance", type: "Spell Card", category: "Consistency", tier: "A" },
  { id: 84211599, name: "Pot of Prosperity", type: "Spell Card", category: "Consistency", tier: "A" },
  { id: 70368879, name: "Upstart Goblin", type: "Spell Card", category: "Consistency", tier: "B" },
  { id: 73628505, name: "Terraforming", type: "Spell Card", category: "Consistency", tier: "B" },
  { id: 73468603, name: "Set Rotation", type: "Spell Card", category: "Consistency", tier: "Tech" },
  { id: 83764719, name: "Monster Reborn", type: "Spell Card", category: "Consistency", tier: "Tech" },
  { id: 1845204, name: "Instant Fusion", type: "Spell Card", category: "Consistency", tier: "Tech" },
  { id: 97631303, name: "Magicians' Souls", type: "Effect Monster", category: "Consistency", tier: "Tech" },
  { id: 37520316, name: "Mind Control", type: "Spell Card", category: "Consistency", tier: "Tech" },
  { id: 64697431, name: "Hey, Trunade!", type: "Spell Card", category: "Consistency", tier: "Tech" },
  { id: 73915051, name: "Scapegoat", type: "Spell Card", category: "Consistency", tier: "Tech" },
  { id: 11074235, name: "Mana Dragon Zirnitron", type: "Effect Monster", category: "Consistency", tier: "Tech" },
  { id: 99674361, name: "World Legacy Succession", type: "Spell Card", category: "Consistency", tier: "Tech" },

  // Extra Deck
  { id: 29301450, name: "S:P Little Knight", type: "Link Monster", category: "Extra Deck", tier: "S" },
  { id: 65741786, name: "I:P Masquerena", type: "Link Monster", category: "Extra Deck", tier: "S" },
  { id: 86066372, name: "Accesscode Talker", type: "Link Monster", category: "Extra Deck", tier: "A" },
  { id: 4280258, name: "Apollousa, Bow of the Goddess", type: "Link Monster", category: "Extra Deck", tier: "A" },
  { id: 38342335, name: "Knightmare Unicorn", type: "Link Monster", category: "Extra Deck", tier: "A" },
  { id: 2857636, name: "Knightmare Phoenix", type: "Link Monster", category: "Extra Deck", tier: "A" },
  { id: 75452921, name: "Knightmare Cerberus", type: "Link Monster", category: "Extra Deck", tier: "Tech" },
  { id: 60303245, name: "Salamangreat Almiraj", type: "Link Monster", category: "Extra Deck", tier: "A" },
  { id: 85289965, name: "Borrelsword Dragon", type: "Link Monster", category: "Extra Deck", tier: "B" },
  { id: 31833038, name: "Borreload Dragon", type: "Link Monster", category: "Extra Deck", tier: "B" },
  { id: 21887175, name: "Mekk-Knight Crusadia Avramax", type: "Link Monster", category: "Extra Deck", tier: "B" },
  { id: 46772449, name: "Evilswarm Exciton Knight", type: "XYZ Monster", category: "Extra Deck", tier: "Tech" },
  { id: 23656668, name: "Gravity Controller", type: "Link Monster", category: "Extra Deck", tier: "Tech" },
  { id: 47444342, name: "Promethean Princess, Bestower of Flames", type: "Link Monster", category: "Extra Deck", tier: "A" }
];

/**
 * Categorizes a card into one of the 4 standard meta categories:
 * 'Hand Traps', 'Board Breakers', 'Consistency', 'Extra Deck'.
 */
function categorizeStapleCard(card: { id: number; name: string; type?: string; frameType?: string; desc?: string; race?: string }): string {
  const type = (card.type || "").toLowerCase();
  const frameType = (card.frameType || "").toLowerCase();
  const desc = (card.desc || "").toLowerCase();
  const name = card.name.toLowerCase();

  // 1. Extra Deck
  const extraTypes = ["link", "xyz", "synchro", "fusion"];
  if (extraTypes.some(t => type.includes(t) || frameType.includes(t))) {
    return "Extra Deck";
  }

  // 2. Hand Traps
  const handTrapNames = [
    "ash blossom", "droll & lock", "effect veiler", "ghost belle", "ghost ogre",
    "ghost mourner", "ghost reaper", "nibiru", "psy-framegear gamma", "skull meister",
    "dimension shifter", "fantastical dragon phantazmay", "infinite impermanence",
    "red reboot", 'maxx "c"', "mulcharmy", "d.d. crow", "artifact lancea",
    "bystial magn", "bystial druis"
  ];
  if (handTrapNames.some(ht => name.includes(ht))) {
    return "Hand Traps";
  }
  if (
    type.includes("monster") &&
    (desc.includes("discard this card") || desc.includes("send this card from your hand") ||
     desc.includes("quick effect): you can discard") || desc.includes("quick effect): you can send this card"))
  ) {
    return "Hand Traps";
  }

  // 3. Consistency
  const consistencyNames = [
    "pot of", "upstart goblin", "triple tactics", "terraforming", "set rotation",
    "foolish burial", "magicians' souls", "monster reborn", "called by the grave",
    "crossout designator", "instant fusion", "bonfire", "small world", "cynet mining"
  ];
  if (consistencyNames.some(cn => name.includes(cn))) {
    return "Consistency";
  }
  if (
    type.includes("spell") &&
    (desc.includes("draw ") || desc.includes("add ") || desc.includes("from your deck to your hand") || desc.includes("send 1 monster from your deck to the gy"))
  ) {
    return "Consistency";
  }

  // 4. Board Breakers
  const boardBreakerNames = [
    "dark hole", "raigeki", "dark ruler no more", "evenly matched", "forbidden droplet",
    "kaiju", "sphere mode", "lava golem", "harpie's feather duster", "lightning storm",
    "super polymerization", "pankratops", "mind control", "trunade", "twin twisters",
    "cosmic cyclone", "anti-spell", "dimensional barrier", "solemn", "mystic mine",
    "imperial order", "book of eclipse", "kurikara"
  ];
  if (boardBreakerNames.some(bb => name.includes(bb))) {
    return "Board Breakers";
  }
  if (
    desc.includes("destroy all") || desc.includes("banish as many") || desc.includes("tribute") ||
    desc.includes("negate the effects of face-up monsters") || desc.includes("cannot activate")
  ) {
    return "Board Breakers";
  }

  // Fallback defaults based on card type
  if (type.includes("trap")) return "Board Breakers";
  if (type.includes("spell")) return "Consistency";
  return "Hand Traps";
}

/**
 * Assigns competitive power tiers to staple cards: 'S' | 'A' | 'B' | 'Tech'.
 */
function assignStapleTier(card: { id: number; name: string }): "S" | "A" | "B" | "Tech" {
  const name = card.name.toLowerCase();

  const tierS = [
    "ash blossom", "infinite impermanence", "nibiru", 'maxx "c"',
    "crossout designator", "triple tactics talent", "triple tactics thrust", "s:p little knight",
    "i:p masquerena", "forbidden droplet", "evenly matched", "droll & lock", "effect veiler",
    "mulcharmy fuwalos"
  ];
  if (tierS.some(t => name.includes(t))) return "S";

  const tierA = [
    "accesscode talker", "apollousa", "knightmare unicorn", "knightmare phoenix",
    "super polymerization", "lightning storm", "harpie's feather duster", "ghost belle",
    "ghost ogre", "dimension shifter", "dark ruler no more", "pot of prosperity",
    "pot of extravagance", "pot of desires", "cosmic cyclone", "salamangreat almiraj",
    "promethean princess", "bystial"
  ];
  if (tierA.some(t => name.includes(t))) return "A";

  const tierB = [
    "psy-framegear gamma", "gameciel", "kaiju", "raigeki", "dark hole", "twin twisters",
    "solemn judgment", "solemn strike", "red reboot", "dimensional barrier",
    "anti-spell fragrance", "foolish burial", "terraforming", "upstart goblin",
    "borrelsword dragon", "borreload dragon", "mekk-knight crusadia avramax",
    "d.d. crow", "artifact lancea", "book of eclipse", "kurikara divincarnate"
  ];
  if (tierB.some(t => name.includes(t))) return "B";

  return "Tech";
}

export class DynamicMetaManager {
  private static instance?: DynamicMetaManager;
  private cachePath: string;
  private cache: MetaCache;

  constructor(cachePath: string = DEFAULT_CACHE_PATH) {
    this.cachePath = cachePath;
    this.cache = this.createDefaultCache();
    this.loadFromCache();
  }

  public static getInstance(cachePath?: string): DynamicMetaManager {
    if (!DynamicMetaManager.instance) {
      DynamicMetaManager.instance = new DynamicMetaManager(cachePath);
    }
    return DynamicMetaManager.instance;
  }

  private createDefaultCache(): MetaCache {
    const tcgBanlist: Record<number, { name: string; status: "Banned" | "Limited" | "Semi-Limited" }> = {
      55144522: { name: "Pot of Greed", status: "Banned" },
      23434538: { name: 'Maxx "C"', status: "Banned" },
      24224830: { name: "Called by the Grave", status: "Banned" },
      65681983: { name: "Crossout Designator", status: "Limited" },
      81439173: { name: "Foolish Burial", status: "Limited" },
      18144507: { name: "Harpie's Feather Duster", status: "Limited" },
      73628505: { name: "Terraforming", status: "Limited" },
      44430448: { name: "Branded Fusion", status: "Limited" },
      67441435: { name: "Glow-Up Bulb", status: "Banned" },
      50588353: { name: "Crystron Halqifibrax", status: "Banned" },
      70369116: { name: "Predaplant Verte Anaconda", status: "Banned" },
      76375976: { name: "Mystic Mine", status: "Banned" },
      61740673: { name: "Imperial Order", status: "Banned" }
    };

    const ocgBanlist: Record<number, { name: string; status: "Banned" | "Limited" | "Semi-Limited" }> = {
      55144522: { name: "Pot of Greed", status: "Banned" },
      23434538: { name: 'Maxx "C"', status: "Semi-Limited" },
      24224830: { name: "Called by the Grave", status: "Banned" },
      65681983: { name: "Crossout Designator", status: "Semi-Limited" },
      81439173: { name: "Foolish Burial", status: "Limited" },
      18144507: { name: "Harpie's Feather Duster", status: "Limited" },
      73628505: { name: "Terraforming", status: "Banned" },
      67441435: { name: "Glow-Up Bulb", status: "Banned" },
      50588353: { name: "Crystron Halqifibrax", status: "Banned" },
      70369116: { name: "Predaplant Verte Anaconda", status: "Banned" }
    };

    const topArchetypes = [
      {
        name: "Maliss (M∀LICE)",
        tier: 1,
        sharePercentage: 23.5,
        coreCards: [69272449, 32061192, 68337209, 94722358],
        flexSlots: 15
      },
      {
        name: "Centur-Ion",
        tier: 1,
        sharePercentage: 17.5,
        coreCards: [15005145, 42493140, 41371602, 77765207],
        flexSlots: 14
      },
      {
        name: "Voiceless Voice",
        tier: 1,
        sharePercentage: 11.5,
        coreCards: [25801745, 51296484, 98477480, 52472775],
        flexSlots: 14
      },
      {
        name: "White Forest (Azamina)",
        tier: 1,
        sharePercentage: 11.0,
        coreCards: [25592142, 61980241, 98385955, 99289828],
        flexSlots: 15
      },
      {
        name: "Light and Darkness Ritual (RoLaD)",
        tier: 2,
        sharePercentage: 8.5,
        coreCards: [70405001, 44001993, 33599853, 50073633],
        flexSlots: 14
      },
      {
        name: "Yubel",
        tier: 2,
        sharePercentage: 8.0,
        coreCards: [90829280, 62318994, 93729896, 65261141],
        flexSlots: 12
      },
      {
        name: "Tenpai Dragon",
        tier: 2,
        sharePercentage: 6.8,
        coreCards: [99539075, 72145330, 46849495, 85272661],
        flexSlots: 18
      },
      {
        name: "Branded Despia",
        tier: 2,
        sharePercentage: 5.4,
        coreCards: [32603893, 61245789, 44146295, 78942511],
        flexSlots: 12
      },
      {
        name: "Rogue Decks",
        tier: 3,
        sharePercentage: 7.8,
        coreCards: [91800273, 15693423, 48130397],
        flexSlots: 16
      }
    ];

    return {
      lastSynced: new Date().toISOString(),
      tcgBanlist,
      ocgBanlist,
      liveStaples: [...FALLBACK_STAPLES],
      topArchetypes
    };
  }

  private loadFromCache(): boolean {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.liveStaples || parsed.staples)) {
          this.cache = {
            lastSynced: parsed.lastSynced || new Date().toISOString(),
            tcgBanlist: parsed.tcgBanlist || {},
            ocgBanlist: parsed.ocgBanlist || {},
            liveStaples: parsed.liveStaples || parsed.staples || [...FALLBACK_STAPLES],
            topArchetypes: parsed.topArchetypes || this.cache.topArchetypes
          };
          return true;
        }
      }
    } catch {
      // Fallback in-memory cache remains active
    }
    return false;
  }

  private saveToCache(): void {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), "utf-8");
    } catch {
      // Ignore disk write errors in restricted environments
    }
  }

  /**
   * Synchronizes meta data from online YGOPRODeck APIs and updates disk cache.
   * If network fails, gracefully falls back to existing cache or default state without crashing.
   */
  public async syncMeta(force: boolean = false): Promise<SyncMetaResult> {
    try {
      const previousBanCount = Object.keys(this.cache.tcgBanlist).length + Object.keys(this.cache.ocgBanlist).length;

      // Fetch staples, TCG banlist, and OCG banlist concurrently with timeout
      const [staplesResp, tcgResp, ocgResp] = await Promise.all([
        axios.get(STAPLES_API_URL, { timeout: 10000 }),
        axios.get(TCG_BANLIST_API_URL, { timeout: 10000 }),
        axios.get(OCG_BANLIST_API_URL, { timeout: 10000 })
      ]);

      // 1. Process Staples
      const rawStaples: any[] = staplesResp.data?.data || staplesResp.data || [];
      const liveStaplesMap = new Map<number, { id: number; name: string; type: string; category: string; tier: "S" | "A" | "B" | "Tech" }>();

      // Live API only on the success path. FALLBACK_STAPLES are used exclusively in the
      // catch block when the network is unavailable (and are then labelled as fallback).
      // Merge and enrich from live API
      for (const card of rawStaples) {
        if (!card || !card.id || !card.name) continue;
        const category = categorizeStapleCard(card);
        const tier = assignStapleTier(card);
        liveStaplesMap.set(card.id, {
          id: card.id,
          name: card.name,
          type: card.type || "Spell Card",
          category,
          tier
        });
      }

      // 1b. Supplement with recently released high-demand cards (auto-capture new staples)
      try {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const startStr = sixMonthsAgo.toISOString().slice(0, 10);
        const endStr = new Date().toISOString().slice(0, 10);
        let offset = 0;
        const pageSize = 100;
        while (offset < 2000) {
          const resp = await axios.get("https://db.ygoprodeck.com/api/v7/cardinfo.php", {
            params: { misc: "yes", num: pageSize, offset, startdate: startStr, enddate: endStr },
            timeout: 10000
          });
          const cards: any[] = resp.data?.data || [];
          if (cards.length === 0) break;
          for (const card of cards) {
            if (!card || !card.id || !card.name) continue;
            const viewsweek = card.misc_info?.[0]?.viewsweek || 0;
            if (viewsweek < 500) continue;
            if (liveStaplesMap.has(card.id)) continue;
            const category = categorizeStapleCard(card);
            // Tier derived from live demand (viewsweek), not hardcoded names
            const tier: "S" | "A" | "B" | "Tech" =
              viewsweek >= 3000 ? "S" : viewsweek >= 1000 ? "A" : viewsweek >= 500 ? "B" : "Tech";
            liveStaplesMap.set(card.id, {
              id: card.id,
              name: card.name,
              type: card.type || "Spell Card",
              category,
              tier
            });
          }
          offset += cards.length;
          if (cards.length < pageSize) break;
        }
      } catch {
        // Ignore supplement errors; keep base staples
      }

      const updatedLiveStaples = Array.from(liveStaplesMap.values());

      // 2. Process TCG Banlist
      const rawTcg: any[] = tcgResp.data?.data || tcgResp.data || [];
      const updatedTcgBanlist: Record<number, { name: string; status: "Banned" | "Limited" | "Semi-Limited" }> = {};

      for (const card of rawTcg) {
        if (!card || !card.id) continue;
        const banStatusRaw = card.banlist_info?.ban_tcg;
        if (banStatusRaw) {
          let status: "Banned" | "Limited" | "Semi-Limited" = "Banned";
          const lower = banStatusRaw.toLowerCase();
          if (lower.includes("semi")) {
            status = "Semi-Limited";
          } else if (lower.includes("limit")) {
            status = "Limited";
          } else {
            status = "Banned";
          }
          updatedTcgBanlist[card.id] = { name: card.name, status };
        }
      }

      // Ensure Pot of Greed is marked Banned
      updatedTcgBanlist[55144522] = { name: "Pot of Greed", status: "Banned" };
      // Called by the Grave is Forbidden in TCG (live data); do not override.

      // 3. Process OCG Banlist
      const rawOcg: any[] = ocgResp.data?.data || ocgResp.data || [];
      const updatedOcgBanlist: Record<number, { name: string; status: "Banned" | "Limited" | "Semi-Limited" }> = {};

      for (const card of rawOcg) {
        if (!card || !card.id) continue;
        const banStatusRaw = card.banlist_info?.ban_ocg;
        if (banStatusRaw) {
          let status: "Banned" | "Limited" | "Semi-Limited" = "Banned";
          const lower = banStatusRaw.toLowerCase();
          if (lower.includes("semi")) {
            status = "Semi-Limited";
          } else if (lower.includes("limit")) {
            status = "Limited";
          } else {
            status = "Banned";
          }
          updatedOcgBanlist[card.id] = { name: card.name, status };
        }
      }

      // Ensure Pot of Greed is Banned in OCG
      updatedOcgBanlist[55144522] = { name: "Pot of Greed", status: "Banned" };

      // Commit to cache
      const newBanCount = Object.keys(updatedTcgBanlist).length + Object.keys(updatedOcgBanlist).length;
      const banlistChanges = Math.abs(newBanCount - previousBanCount) || newBanCount;

      this.cache = {
        lastSynced: new Date().toISOString(),
        tcgBanlist: updatedTcgBanlist,
        ocgBanlist: updatedOcgBanlist,
        liveStaples: updatedLiveStaples,
        topArchetypes: this.cache.topArchetypes
      };

      this.saveToCache();

      // The meta sync and the legality checker must agree on the same snapshot.
      // Without this, a fresh install answers "3 copies" for a banned card
      // because BanlistManager never saw the data syncMeta just fetched.
      BanlistManager.getInstance().applyBanlistSnapshot(updatedTcgBanlist, updatedOcgBanlist);

      return {
        success: true,
        dataSource: "live",
        staplesCount: updatedLiveStaples.length,
        banlistChanges,
        message: `Successfully synchronized ${updatedLiveStaples.length} staples and ${newBanCount} banlist entries from YGOPRODeck.`
      };
    } catch (err: any) {
      // Network or parsing error: ensure cache is loaded from disk or fallback
      const hadCache = this.loadFromCache();
      const staplesCount = this.cache.liveStaples.length;
      const banlistCount = Object.keys(this.cache.tcgBanlist).length + Object.keys(this.cache.ocgBanlist).length;

      // Critical overrides only; never claim a live sync on failure.
      this.cache.tcgBanlist[55144522] = { name: "Pot of Greed", status: "Banned" };
      this.cache.tcgBanlist[24224830] = { name: "Called by the Grave", status: "Banned" };

      return {
        success: false,
        isFallback: true,
        dataSource: hadCache ? "disk_cache" : "builtin_fallback",
        staplesCount,
        banlistChanges: banlistCount,
        message: `Network sync failed (${err?.message || "Offline mode"}). Loaded ${staplesCount} staples from ${hadCache ? "disk cache" : "built-in defaults"}; data is NOT live.`
      };
    }
  }

  /**
   * Returns current meta staples sorted by tier (S > A > B > Tech),
   * filtering out cards banned in the chosen format.
   */
  public getLiveStaples(format: SupportedFormat = "TCG"): { id: number; name: string; type: string; category: string; tier: "S" | "A" | "B" | "Tech" }[] {
    const tierWeight: Record<string, number> = {
      S: 1,
      A: 2,
      B: 3,
      Tech: 4
    };

    return this.cache.liveStaples
      .filter(staple => {
        const allowedCopies = this.getCardBanStatus(staple.id, format);
        return allowedCopies > 0;
      })
      .sort((a, b) => {
        const wA = tierWeight[a.tier] || 99;
        const wB = tierWeight[b.tier] || 99;
        if (wA !== wB) return wA - wB;
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Returns max copies allowed for a card in the specified format:
   * 0 for Banned, 1 for Limited, 2 for Semi-Limited, 3 for Unlimited.
   * Supports TCG, OCG, AE, Genesys, and Master Duel via BanlistManager.
   */
  public getCardBanStatus(passcode: number, format: SupportedFormat = "TCG"): number {
    return BanlistManager.getInstance().getCardMaxCopies(passcode, format);
  }

  /** True when the cached meta/staples were synced from the live API recently. */
  public isCacheLive(maxAgeHours = 24): boolean {
    if (!this.cache.lastSynced) return false;
    const ageHours = (Date.now() - new Date(this.cache.lastSynced).getTime()) / 3600000;
    return ageHours <= maxAgeHours;
  }

  /**
   * Returns metadata status including last sync date, total staples, and banlist breakdown.
   */
  public getMetaStatus(): MetaStatus {
    const tcgValues = Object.values(this.cache.tcgBanlist);
    const ocgValues = Object.values(this.cache.ocgBanlist);

    return {
      lastSynced: this.cache.lastSynced,
      totalStaples: this.cache.liveStaples.length,
      tcgBannedCount: tcgValues.filter(e => e.status === "Banned").length,
      tcgLimitedCount: tcgValues.filter(e => e.status === "Limited").length,
      tcgSemiLimitedCount: tcgValues.filter(e => e.status === "Semi-Limited").length,
      ocgBannedCount: ocgValues.filter(e => e.status === "Banned").length,
      ocgLimitedCount: ocgValues.filter(e => e.status === "Limited").length,
      ocgSemiLimitedCount: ocgValues.filter(e => e.status === "Semi-Limited").length,
      topArchetypesCount: this.cache.topArchetypes.length
    };
  }

  /**
   * Returns tracked top tier archetypes.
   */
  public getTopArchetypes(): TopArchetype[] {
    return [...this.cache.topArchetypes];
  }

  /**
   * Returns current raw cache data.
   */
  public getRawCache(): MetaCache {
    return this.cache;
  }
}

export const dynamicMetaManager = DynamicMetaManager.getInstance();

