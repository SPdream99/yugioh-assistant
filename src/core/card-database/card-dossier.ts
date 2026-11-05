/**
 * Unified card dossier.
 *
 * One call answers "everything about this card": the official database record,
 * the wiki record (names in 12 languages, Yu-Gi-Oh! Card Database ID, which
 * tabs exist), the script provenance (official / custom / generated) and,
 * optionally, a rulings summary.
 *
 * Each source is fetched independently and failures are reported per source, so
 * a partial answer is still useful and never silently fabricated.
 */

import { CardDatabase } from "./ygoprodeck.js";
import { getCard as getWikiCard, getCardTab as getWikiCardTab } from "../wiki/yugipedia.js";
import { resolveCardScript } from "../card-scripts/script-resolver.js";
import type { Card } from "../../types/card.js";

export interface DossierSourceStatus {
  source: string;
  ok: boolean;
  note?: string;
}

export interface CardDossier {
  available: boolean;
  identity: {
    passcode?: number;
    name?: string;
    englishName?: string;
    databaseId?: string;
    names?: Record<string, string>;
    archetypes?: string[];
  };
  stats?: Record<string, unknown>;
  text?: { en?: string; texts?: Record<string, string> };
  script?: {
    provenance?: "manual" | "custom" | "official" | "generated";
    path?: string;
    verified?: boolean;
    confidence?: string;
    note?: string;
  };
  wiki?: {
    page?: string;
    url?: string;
    tabs?: Record<string, boolean>;
    sections?: string[];
  };
  rulings?: { text?: string; source?: string };
  prices?: unknown;
  sources: DossierSourceStatus[];
  missing: string[];
  reason?: string;
}

export interface DossierOptions {
  name?: string;
  passcode?: number;
  /** Include a rulings summary (extra wiki request). */
  includeRulings?: boolean;
  /** Include market prices from the cached price database. */
  includePrices?: boolean;
}

export async function buildCardDossier(options: DossierOptions): Promise<CardDossier> {
  const sources: DossierSourceStatus[] = [];
  const missing: string[] = [];
  const dossier: CardDossier = { available: false, identity: {}, sources, missing };

  if (!options.name && !options.passcode) {
    return { ...dossier, reason: "Provide 'name' or 'passcode'." };
  }

  // 1. Official database (YGOPRODeck, live-first with local cache fallback).
  const db = CardDatabase.getInstance();
  let card: Card | undefined;
  try {
    card = await db.fetchCardOnline(options.passcode ?? options.name!);
    sources.push({ source: "ygoprodeck", ok: Boolean(card), note: card ? "live" : "not found" });
  } catch (error) {
    sources.push({ source: "ygoprodeck", ok: false, note: (error as Error).message });
  }
  if (!card && options.passcode) {
    card = db.getCardById(options.passcode);
    if (card) sources.push({ source: "local_card_cache", ok: true });
  }
  if (!card && options.name) {
    card = db.getCardByName(options.name);
    if (card) sources.push({ source: "local_card_cache", ok: true });
  }

  const passcode = options.passcode ?? card?.id;
  const name = options.name ?? card?.name;

  if (card) {
    dossier.available = true;
    dossier.identity.passcode = card.id;
    dossier.identity.name = card.name;
    dossier.identity.englishName = card.name;
    dossier.identity.archetypes = card.archetype ? [card.archetype] : [];
    dossier.text = { en: card.desc };
    dossier.stats = {
      type: card.type,
      frameType: card.frameType,
      race: card.race,
      attribute: card.attribute,
      level: card.level,
      atk: card.atk,
      def: card.def,
      scale: card.scale,
      linkval: card.linkval,
      linkmarkers: card.linkmarkers
    };
  } else if (passcode) {
    dossier.identity.passcode = passcode;
  }

  // 2. Wiki (localised names, Card Database ID, available tabs).
  if (passcode || name) {
    try {
      const wiki = await getWikiCard(passcode ? String(passcode) : name!);
      if (wiki.available) {
        dossier.available = true;
        dossier.identity.databaseId = wiki.identifiers?.databaseId;
        dossier.identity.names = wiki.names;
        if (!dossier.identity.name) dossier.identity.name = wiki.page;
        dossier.identity.archetypes = dossier.identity.archetypes?.length ? dossier.identity.archetypes : wiki.archetypes;
        dossier.text = { en: dossier.text?.en ?? wiki.lore, texts: wiki.texts };
        dossier.wiki = {
          page: wiki.page,
          url: wiki.url,
          tabs: wiki.tabs,
          sections: wiki.sections
        };
        sources.push({ source: "yugipedia", ok: true });
      } else {
        sources.push({ source: "yugipedia", ok: false, note: wiki.reason });
        missing.push("wiki");
      }
    } catch (error) {
      sources.push({ source: "yugipedia", ok: false, note: (error as Error).message });
      missing.push("wiki");
    }
  }

  // 3. Script provenance (never generates here — reporting only).
  if (passcode) {
    try {
      const script = await resolveCardScript(passcode, { allowGenerate: false });
      if (script.available) {
        dossier.script = {
          provenance: script.provenance,
          path: script.path,
          verified: script.generated?.verified,
          confidence: script.generated?.confidence,
          note:
            script.provenance === "generated"
              ? "Auto-generated from card text; not valid for tournament rulings."
              : undefined
        };
        sources.push({ source: "card_script", ok: true });
      } else {
        sources.push({ source: "card_script", ok: false, note: script.reason });
        missing.push("script");
      }
    } catch (error) {
      sources.push({ source: "card_script", ok: false, note: (error as Error).message });
      missing.push("script");
    }
  }

  // 4. Optional rulings summary from the wiki.
  if (options.includeRulings && (dossier.wiki?.page || name)) {
    try {
      const rulings = await getWikiCardTab(dossier.wiki?.page || name!, "rulings");
      if (rulings.available) {
        dossier.rulings = { text: (rulings.text || "").slice(0, 4000), source: rulings.url };
        sources.push({ source: "yugipedia_rulings", ok: true });
      } else {
        sources.push({ source: "yugipedia_rulings", ok: false, note: rulings.reason });
      }
    } catch (error) {
      sources.push({ source: "yugipedia_rulings", ok: false, note: (error as Error).message });
    }
  }

  // 5. Optional prices from the local cache (no network call here).
  if (options.includePrices && card) {
    const prices = (card as any).card_prices?.[0] || (card as any).card_prices;
    if (prices) {
      dossier.prices = prices;
      sources.push({ source: "price_cache", ok: true });
    } else {
      sources.push({ source: "price_cache", ok: false, note: "no cached prices" });
    }
  }

  if (!dossier.available) {
    dossier.reason = `No record found for ${options.passcode ?? options.name}.`;
  }

  return dossier;
}
