import axios from 'axios';
import type { CardPriceQuote } from '../../types/pricing.js';
import { fetchYugipediaCardInfo } from '../card-database/yugipedia.js';

export function getYuyuteiSearchUrl(cardName: string): string {
  return `https://yuyu-tei.jp/sell/ygo/s/search?search_word=${encodeURIComponent(cardName)}`;
}

/**
 * Japanese card name mappings for popular staples if searched with English names.
 */
const COMMON_EN_TO_JA_MAP: Record<string, string> = {
  'ash blossom & joyous spring': '灰流うらら',
  'ash blossom': '灰流うらら',
  's:p little knight': 'S：Pリトルナイト',
  'sp little knight': 'S：Pリトルナイト',
  'maxx "c"': '増殖するG',
  'maxx c': '増殖するG',
  'nibiru, the primal being': '原始生命態ニビル',
  'nibiru': '原始生命態ニビル',
  'infinite impermanence': '無限泡影',
  'called by the grave': '墓穴の指名者',
  'crossout designator': '抹殺の指名者',
  'effect veiler': 'エフェクト・ヴェーラー',
  'droll & lock bird': 'ドロール＆ロックバード',
  'pot of prosperity': '金満で謙虚な壺',
  'blue-eyes white dragon': '青眼の白龍',
  'dark magician': 'ブラック・マジシャン'
};

const HAS_CJK = /[\u3000-\u9fff\uF900-\uFAFF]/;

const japaneseNameCache = new Map<string, string | null>();

/**
 * Yuyu-tei's search only matches Japanese card names. With an English query the
 * result page contains zero products, and the old fallback then scraped random
 * yen figures from navigation — producing confident, wrong prices (e.g. ¥320 for
 * a one-of-a-kind card). Resolve the Japanese name first and refuse to guess.
 */
async function resolveJapaneseName(cardName: string): Promise<string | undefined> {
  const key = cardName.trim().toLowerCase();
  if (HAS_CJK.test(cardName)) return cardName;
  if (COMMON_EN_TO_JA_MAP[key]) return COMMON_EN_TO_JA_MAP[key];

  if (japaneseNameCache.has(key)) return japaneseNameCache.get(key) || undefined;

  try {
    const info = await fetchYugipediaCardInfo(cardName);
    const value = info?.japaneseName?.trim() || null;
    japaneseNameCache.set(key, value);
    return value || undefined;
  } catch {
    japaneseNameCache.set(key, null);
    return undefined;
  }
}

function normalizeTitle(value: string): string {
  return value
    .replace(/[（）()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Pure parser: turns a Yuyu-tei search page into quotes. Exported so it can be
 * tested against a recorded fixture without touching the network.
 */
export function parseYuyuteiHtml(
  html: string,
  cardName: string,
  japaneseName?: string
): CardPriceQuote[] {
  const searchKeyword = japaneseName || cardName;
  const directUrl = getYuyuteiSearchUrl(searchKeyword);
  const wanted = normalizeTitle(japaneseName || cardName);
  const quotes: CardPriceQuote[] = [];

  const cardBlocks = html.split(/<div[^>]*class="[^"]*card-product[^"]*"[^>]*>/i).slice(1);
  for (const block of cardBlocks) {
    if (quotes.length >= 5) break;

    const titleMatch = block.match(/<h4[^>]*>([^<]+)<\/h4>/i);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();

    // Reject unrelated cards that merely share a keyword.
    if (!normalizeTitle(title).includes(wanted.split(' ')[0])) continue;

    const priceMatch = block.match(/<strong[^>]*>[\s\r\n]*([0-9,]+)\s*円/i);
    if (!priceMatch) continue;
    const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(price) || price <= 0) continue;

    const linkMatch = block.match(/href="([^"]*\/sell\/ygo\/card\/[^"]*)"/i);
    const productUrl = linkMatch
      ? (linkMatch[1].startsWith('http') ? linkMatch[1] : `https://yuyu-tei.jp${linkMatch[1].startsWith('/') ? '' : '/'}${linkMatch[1]}`)
      : directUrl;

    const codeMatch = block.match(/<span[^>]*border-dark[^>]*>([^<]+)<\/span>/i);
    const setCode = codeMatch ? codeMatch[1].trim() : undefined;

    // Image alt looks like "20AP-JP000 P-HR 青眼の白龍": token[1] is the rarity.
    // Several images exist in the block (the wishlist star has alt="Star"), so
    // pick the alt that starts with a set code instead of the first image.
    const alts = [...block.matchAll(/<img[^>]*alt="([^"]+)"/gi)].map(m => m[1]);
    let rarity = 'Regular';
    const cardAlt = alts.find(alt => /^[A-Z0-9]{2,6}-[A-Z0-9]{2,6}\s/.test(alt));
    if (cardAlt) {
      const tokens = cardAlt.trim().split(/\s+/);
      if (tokens.length >= 3) rarity = tokens[1];
    }

    const isSoldOut = /class="[^"]*card-product[^"]*sold-out/i.test(block) || /在庫\s*:\s*×/i.test(block);

    quotes.push({
      platform: 'Yuyu-tei',
      currency: 'JPY',
      price,
      rarity,
      url: productUrl,
      inStock: !isSoldOut,
      details: `${title}${setCode ? ` (${setCode})` : ''} - ${rarity} [JP OCG]`,
      source: 'live'
    });
  }

  return quotes.sort((a, b) => a.price - b.price);
}

/**
 * Queries Yuyu-tei (遊々亭 - JP OCG market) for card prices.
 * Returns only listings whose title actually matches the card; a failed lookup
 * returns a search-link fallback with price 0, never an invented number.
 */
export async function getYuyuteiPrices(cardName: string): Promise<CardPriceQuote[]> {
  const japaneseName = await resolveJapaneseName(cardName);
  const searchKeyword = japaneseName || cardName;
  const directUrl = getYuyuteiSearchUrl(searchKeyword);

  const fallbackQuote: CardPriceQuote = {
    platform: 'Yuyu-tei',
    currency: 'JPY',
    price: 0,
    url: directUrl,
    inStock: undefined,
    details: japaneseName
      ? `Yuyu-tei direct search link (JP OCG market) [Query: ${searchKeyword}]`
      : `No Japanese name resolved for "${cardName}", so Yuyu-tei cannot be queried reliably. Open the search link.`,
    isFallback: true,
    source: 'fallback'
  };

  try {
    const response = await axios.get<string>(directUrl, {
      timeout: 7000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; yugioh-assistant-mcp/0.9.4; +https://github.com/SPdream99/yugioh-assistant-mcp)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      },
      responseType: 'text'
    });

    const html = response.data;
    if (!html || typeof html !== 'string') {
      return [fallbackQuote];
    }

    const quotes = parseYuyuteiHtml(html, cardName, japaneseName);
    if (quotes.length > 0) return quotes;

    return [{
      ...fallbackQuote,
      details: japaneseName
        ? `Yuyu-tei returned no matching listing for "${japaneseName}" (query "${searchKeyword}"). The search link is provided instead of a guessed price.`
        : fallbackQuote.details
    }];
  } catch {
    return [fallbackQuote];
  }
}
