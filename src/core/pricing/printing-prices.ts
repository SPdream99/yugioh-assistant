import { CardDatabase } from '../card-database/ygoprodeck.js';
import { httpFetch } from '../http/fetch-client.js';
import { getYuyuteiPrices } from './yuyutei.js';
import { getTcgCornerPrices } from './tcgcorner.js';

/**
 * Per-printing (per-rarity, per-language) price lookup.
 *
 * Why this exists: "Common is cheaper than Secret Rare" is a guess, not a price.
 * Yu-Gi-Oh printings of the same card can invert that (promo/event packs, small
 * regional print runs). This module only reports a number when a source actually
 * lists that printing, and returns `price: null` otherwise.
 *
 * Sources:
 *  - EN: TCGCSV (TCGplayer's own per-product prices, with Number + Rarity)
 *  - JP: Yuyu-tei live listings (set code + rarity + yen)
 *  - AE: TCGCorner live listings (title carries set/rarity)
 *  - KR / DE / FR / IT / SP / PT and others: no public per-printing feed.
 */

const TCGCSV = 'https://tcgcsv.com/tcgplayer';
const CATEGORY_YGO = 2;
const CACHE_MS = 6 * 60 * 60 * 1000;
const FX_TO_USD: Record<string, number> = { USD: 1, JPY: 1 / 150, HKD: 1 / 7.8, EUR: 1.08 };

export interface PrintingPriceRow {
  language: string;
  source: 'tcgplayer' | 'yuyu-tei' | 'tcgcorner' | 'none';
  setCode: string;
  setName: string;
  rarity: string;
  price: number | null;
  currency: string;
  priceUsd: number | null;
  inStock?: boolean;
  url?: string;
  note?: string;
}

export interface LanguageCoverage {
  language: string;
  source: string;
  available: boolean;
  note: string;
}

export interface PrintingPricesResult {
  card: string;
  passcode?: number;
  rows: PrintingPriceRow[];
  coverage: LanguageCoverage[];
  cheapest?: PrintingPriceRow;
  caveats: string[];
  fetchedAt: string;
}

interface GroupRow {
  groupId: number;
  name: string;
  abbreviation: string;
}

interface GroupData {
  at: number;
  products: any[];
  prices: Map<number, any>;
}

const groupCache: { at: number; groups: GroupRow[] } = { at: 0, groups: [] };
const groupDataCache = new Map<number, GroupData>();

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * TCGplayer names variant printings as "Card Name (UR)" / "(Secret Rare)".
 * Accept exactly one parenthesised suffix, never a different card that merely
 * starts with the same words ("Dark Magician" vs "Dark Magician Girl").
 */
export function isSamePrintingName(cardName: string, productName: string): boolean {
  const raw = String(productName || '').trim();
  if (!raw) return false;
  if (normalize(raw) === normalize(cardName)) return true;
  const escaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?:\\s*\\([^)]*\\))?$`, 'i').test(raw);
}

function languageOf(setCode: string): string {
  const match = setCode.match(/-(EN|DE|FR|IT|SP|PT|JP|KR|AE|SC|TC)\d/i);
  return match ? match[1].toUpperCase() : 'EN';
}

async function loadGroups(): Promise<GroupRow[]> {
  if (groupCache.groups.length > 0 && Date.now() - groupCache.at < CACHE_MS) return groupCache.groups;
  const response = await httpFetch(`${TCGCSV}/${CATEGORY_YGO}/groups`, {
    headers: { 'User-Agent': 'yugioh-assistant-mcp/1.2 (+printing prices)' },
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw new Error(`TCGCSV groups returned HTTP ${response.status}`);
  const payload = await response.json();
  const groups = (payload.results || []) as GroupRow[];
  groupCache.groups = groups;
  groupCache.at = Date.now();
  return groups;
}

function findGroup(groups: GroupRow[], setName: string): GroupRow | undefined {
  const needle = normalize(setName);
  return (
    groups.find(g => normalize(g.name) === needle) ||
    groups.find(g => normalize(g.name).startsWith(needle) || needle.startsWith(normalize(g.name))) ||
    groups.find(g => normalize(g.name).includes(needle))
  );
}

async function loadGroupData(groupId: number): Promise<GroupData | undefined> {
  const cached = groupDataCache.get(groupId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  try {
    const [productsRes, pricesRes] = await Promise.all([
      httpFetch(`${TCGCSV}/${CATEGORY_YGO}/${groupId}/products`, { headers: { 'User-Agent': 'yugioh-assistant-mcp/1.2' }, signal: AbortSignal.timeout(25_000) }),
      httpFetch(`${TCGCSV}/${CATEGORY_YGO}/${groupId}/prices`, { headers: { 'User-Agent': 'yugioh-assistant-mcp/1.2' }, signal: AbortSignal.timeout(25_000) })
    ]);
    if (!productsRes.ok || !pricesRes.ok) return undefined;
    const products = (await productsRes.json()).results || [];
    const prices = new Map<number, any>(
      ((await pricesRes.json()).results || []).map((p: any) => [p.productId, p])
    );
    const data = { at: Date.now(), products, prices };
    groupDataCache.set(groupId, data);
    return data;
  } catch {
    return undefined;
  }
}

async function englishPrintingRows(cardName: string, maxSets: number): Promise<PrintingPriceRow[]> {
  const db = CardDatabase.getInstance();
  const card: any = db.getCardByName(cardName) || (await db.fetchCardOnline(cardName));
  const sets: any[] = Array.isArray(card?.card_sets) ? card.card_sets : [];
  const enSets = sets
    .filter(s => languageOf(String(s.set_code || '')) === 'EN')
    .slice(0, maxSets);

  const groups = await loadGroups();
  const rows: PrintingPriceRow[] = [];
  const seenSets = new Set<string>();

  for (const set of enSets) {
    const setName = String(set.set_name || '');
    const setKey = normalize(setName);
    if (seenSets.has(setKey)) continue;
    seenSets.add(setKey);

    const group = findGroup(groups, setName);
    let matched = false;

    if (group) {
      const data = await loadGroupData(group.groupId);
      if (data) {
        const products = data.products.filter((p: any) => isSamePrintingName(cardName, p.name));
        for (const product of products) {
          const extended: any[] = product.extendedData || [];
          const rarity = extended.find(e => e.name === 'Rarity')?.value || 'Unknown';
          const number = extended.find(e => e.name === 'Number')?.value || set.set_code;
          const price = data.prices.get(product.productId);
          const market = Number(price?.marketPrice);
          rows.push({
            language: 'EN',
            source: 'tcgplayer',
            setCode: String(number),
            setName,
            rarity: String(rarity),
            price: Number.isFinite(market) && market > 0 ? market : null,
            currency: 'USD',
            priceUsd: Number.isFinite(market) && market > 0 ? market : null,
            inStock: Number.isFinite(market) && market > 0,
            url: product.url,
            note: Number.isFinite(market) && market > 0 ? undefined : 'Listed product has no current market price.'
          });
          matched = true;
        }
      }
    }

    if (!matched) {
      // Fall back to the YGOPRODeck per-printing price; null if it is 0.
      for (const entry of sets.filter(s => normalize(String(s.set_name || '')) === setKey)) {
        const fallback = Number(entry.set_price) || 0;
        rows.push({
          language: 'EN',
          source: fallback > 0 ? 'tcgplayer' : 'none',
          setCode: String(entry.set_code || ''),
          setName,
          rarity: String(entry.set_rarity || 'Unknown'),
          price: fallback > 0 ? fallback : null,
          currency: 'USD',
          priceUsd: fallback > 0 ? fallback : null,
          note:
            fallback > 0
              ? 'YGOPRODeck per-printing price (TCGPlayer search not matched).'
              : 'No per-printing price reported by either source.'
        });
      }
    }
  }

  // A set can list the same printing twice; never show the user the same row twice.
  const unique = new Map<string, PrintingPriceRow>();
  for (const row of rows) {
    const key = `${row.setCode}|${row.rarity}|${row.source}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

async function japanesePrintingRows(cardName: string): Promise<PrintingPriceRow[]> {
  const quotes = await getYuyuteiPrices(cardName);
  return quotes
    .filter(q => !q.isFallback && q.price > 0)
    .map(q => {
      const details = String(q.details || '');
      const code = (details.match(/\(([A-Z0-9-]+)\)/) || [])[1] || '';
      return {
        language: 'JP',
        source: 'yuyu-tei' as const,
        setCode: code,
        setName: 'Yuyu-tei listing',
        rarity: q.rarity || 'Unknown',
        price: q.price,
        currency: 'JPY',
        priceUsd: Number((q.price * FX_TO_USD.JPY).toFixed(2)),
        inStock: q.inStock,
        url: q.url,
        note: details
      };
    });
}

async function aePrintingRows(cardName: string): Promise<PrintingPriceRow[]> {
  const quotes = await getTcgCornerPrices(cardName);
  return quotes
    .filter(q => !q.isFallback && q.price > 0)
    .map(q => ({
      language: 'AE',
      source: 'tcgcorner' as const,
      setCode: '',
      setName: 'TCGCorner listing',
      rarity: q.rarity || 'Unknown',
      price: q.price,
      currency: q.currency,
      priceUsd: Number((q.price * (FX_TO_USD[q.currency] ?? 1)).toFixed(2)),
      inStock: q.inStock,
      url: q.url,
      note: q.details
    }));
}

const COVERAGE: LanguageCoverage[] = [
  { language: 'EN', source: 'TCGPlayer (TCGCSV per-product)', available: true, note: 'Real per-printing market price with Number + Rarity.' },
  { language: 'JP', source: 'Yuyu-tei', available: true, note: 'Live listings; only printings currently in stock are priced.' },
  { language: 'AE', source: 'TCGCorner', available: true, note: 'Live Shopify listings; availability is sparse.' },
  { language: 'KR', source: 'none', available: false, note: 'No public per-printing price feed. Korean marketplaces (Naver/Daum, cafe communities) are not machine-readable here.' },
  { language: 'DE/FR/IT/SP/PT', source: 'none', available: false, note: 'Cardmarket hosts these printings but exposes no public per-printing price API.' },
  { language: 'SC/TC', source: 'none', available: false, note: 'No public per-printing price feed.' }
];

function rowLanguageFromSetCode(code: string): string {
  return languageOf(code);
}

export async function getPrintingPrices(
  cardName: string,
  options: { maxSets?: number; includeLive?: boolean } = {}
): Promise<PrintingPricesResult> {
  const maxSets = Math.min(Math.max(options.maxSets ?? 8, 1), 20);
  const includeLive = options.includeLive !== false;

  const db = CardDatabase.getInstance();
  const card: any = db.getCardByName(cardName) || (await db.fetchCardOnline(cardName));

  const rows: PrintingPriceRow[] = [];
  if (includeLive) {
    const [en, jp, ae] = await Promise.allSettled([
      englishPrintingRows(cardName, maxSets),
      japanesePrintingRows(cardName),
      aePrintingRows(cardName)
    ]);
    if (en.status === 'fulfilled') rows.push(...en.value);
    if (jp.status === 'fulfilled') rows.push(...jp.value);
    if (ae.status === 'fulfilled') rows.push(...ae.value);
  } else {
    const sets: any[] = Array.isArray(card?.card_sets) ? card.card_sets : [];
    for (const set of sets.slice(0, maxSets)) {
      const code = String(set.set_code || '');
      const price = Number(set.set_price) || 0;
      rows.push({
        language: rowLanguageFromSetCode(code),
        source: price > 0 ? 'tcgplayer' : 'none',
        setCode: code,
        setName: String(set.set_name || ''),
        rarity: String(set.set_rarity || 'Unknown'),
        price: price > 0 ? price : null,
        currency: 'USD',
        priceUsd: price > 0 ? price : null,
        note: price > 0 ? 'YGOPRODeck per-printing price.' : 'No price reported for this printing.'
      });
    }
  }

  // Languages present in the card's printing list but with no price source.
  const known = new Set(rows.map(r => r.language));
  const sets: any[] = Array.isArray(card?.card_sets) ? card.card_sets : [];
  const missingLanguages = [...new Set(sets.map(s => languageOf(String(s.set_code || ''))))].filter(
    lang => !known.has(lang)
  );
  for (const lang of missingLanguages) {
    const coverage = COVERAGE.find(c => c.language.split('/').includes(lang));
    rows.push({
      language: lang,
      source: 'none',
      setCode: '',
      setName: '',
      rarity: '',
      price: null,
      currency: '',
      priceUsd: null,
      note: coverage?.note || `No public price feed for ${lang} printings.`
    });
  }

  const priced = rows.filter(r => r.priceUsd != null);
  const cheapest = priced.slice().sort((a, b) => (a.priceUsd || 0) - (b.priceUsd || 0))[0];

  return {
    card: card?.name || cardName,
    passcode: card?.id,
    rows,
    coverage: COVERAGE,
    cheapest,
    caveats: [
      'A price is shown only when a source lists that exact printing. `null` means no data, not "cheap".',
      'Rarity is not a price signal: rare promo/regional printings routinely cost more or less than the EN Secret Rare.',
      `Only EN (${priced.filter(r => r.language === 'EN').length}), JP (${priced.filter(r => r.language === 'JP').length}) and AE (${priced.filter(r => r.language === 'AE').length}) have priced rows in this answer.`,
      'JP/AE prices are converted with fixed reference FX, excluding shipping and duty.'
    ],
    fetchedAt: new Date().toISOString()
  };
}
