import axios from 'axios';
import type { CardPriceQuote } from '../../types/pricing.js';

export function getTcgCornerSearchUrl(cardName: string): string {
  return `https://tcgcorner.com/search?q=${encodeURIComponent(cardName)}&type=product`;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shopify's suggest endpoint returns store-wide fuzzy matches (plushes,
 * accessories). A product is this card only when its normalised title contains
 * the normalised card name.
 */
export function isSameCardTitle(productTitle: string, cardName: string): boolean {
  const title = normalize(productTitle);
  const wanted = normalize(cardName);
  return Boolean(title) && Boolean(wanted) && title.includes(wanted);
}

interface ShopifySuggestProduct {
  id: number | string;
  title: string;
  handle?: string;
  url: string;
  price?: string | number;
  compare_at_price?: string | number;
  available?: boolean;
  vendor?: string;
  body?: string;
}

interface ShopifySuggestResponse {
  resources?: {
    results?: {
      products?: ShopifySuggestProduct[];
    };
  };
}

/**
 * Queries TCGCorner (Asian-English AE / OCG specialty store) for card prices
 * via Shopify's public suggest API.
 */
export async function getTcgCornerPrices(cardName: string): Promise<CardPriceQuote[]> {
  const directUrl = getTcgCornerSearchUrl(cardName);
  const fallbackQuote: CardPriceQuote = {
    platform: 'TCGCorner',
    currency: 'HKD',
    price: 0,
    url: directUrl,
    inStock: undefined,
    details: 'TCGCorner direct search link (Asian-English / OCG Market)',
    isFallback: true,
    source: 'fallback'
  };

  try {
    const suggestApiUrl = `https://tcgcorner.com/search/suggest.json?q=${encodeURIComponent(cardName)}&resources[type]=product`;

    const response = await axios.get<ShopifySuggestResponse>(suggestApiUrl, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; yugioh-assistant-mcp/0.9.4; +https://github.com/SPdream99/yugioh-assistant-mcp)',
        'Accept': 'application/json'
      }
    });

    const products = response.data?.resources?.results?.products;
    if (!products || !Array.isArray(products) || products.length === 0) {
      // Query YGOPRODeck for Cardmarket / Secondary Market live quote
      try {
        const ygoRes = await axios.get<any>(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(cardName)}`, {
          timeout: 4000
        });
        const ygoCard = ygoRes.data?.data?.[0];
        const cmPriceStr = ygoCard?.card_prices?.[0]?.cardmarket_price;
        if (cmPriceStr && parseFloat(cmPriceStr) > 0) {
          const eur = parseFloat(cmPriceStr);
          const hkd = parseFloat((eur * 8.4).toFixed(2));
          return [{
            platform: 'TCGCorner',
            currency: 'EUR',
            price: eur,
            rarity: 'Cardmarket benchmark',
            url: `https://www.cardmarket.com/en/YuGiOh/Products/Search?searchString=${encodeURIComponent(cardName)}`,
            inStock: undefined,
            // This is NOT a TCGCorner listing. Marking it as a fallback keeps it out
            // of live-quote counts and out of cross-market enrichment; the details
            // still say where the number came from.
            isFallback: true,
            source: 'fallback',
            details: `${ygoCard.name} - Cardmarket benchmark (€${eur} EUR / ~$${hkd} HKD), NOT a TCGCorner listing`
          }];
        }
      } catch {
        // Fall through to fallback quote
      }
      return [fallbackQuote];
    }

    const quotes: CardPriceQuote[] = [];

    for (const prod of products) {
      // Shopify's suggest endpoint returns store-wide fuzzy matches (plushes,
      // accessories). Keep only products whose title is actually this card.
      if (!prod?.title || !isSameCardTitle(prod.title, cardName)) continue;

      let numericPrice = 0;
      if (typeof prod.price === 'number') {
        numericPrice = prod.price;
      } else if (typeof prod.price === 'string') {
        numericPrice = parseFloat(prod.price);
      }

      // If Shopify returns price in cents (e.g. 15000 for $150.00), adjust if decimal places absent
      // Typically suggest.json in modern Shopify returns string format e.g. "120.00"
      if (numericPrice > 0) {
        let productUrl = directUrl;
        if (prod.url) {
          productUrl = prod.url.startsWith('http')
            ? prod.url
            : `https://tcgcorner.com${prod.url.startsWith('/') ? '' : '/'}${prod.url}`;
        }

        // Detect rarity from product title if present (e.g. "[Secret Rare]", "(UR)", "CR")
        const rarityMatch = prod.title.match(/(?:\[|\()([A-Za-z0-9\s/+\-_]{2,12})(?:\]|\))/);
        const rarity = rarityMatch ? rarityMatch[1] : undefined;

        quotes.push({
          platform: 'TCGCorner',
          currency: 'HKD',
          price: numericPrice,
          rarity,
          url: productUrl,
          inStock: prod.available ?? true,
          details: `TCGCorner: ${prod.title}`,
          source: 'live'
        });
      }
    }

    if (quotes.length === 0) {
      return [{
        ...fallbackQuote,
        details: `TCGCorner search returned no product whose title matched "${cardName}". The search link is provided instead of an unrelated item.`
      }];
    }

    quotes.sort((a, b) => a.price - b.price);
    return quotes;
  } catch (error) {
    return [fallbackQuote];
  }
}
