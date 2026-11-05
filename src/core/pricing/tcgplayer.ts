import axios from 'axios';
import type { CardPriceQuote } from '../../types/pricing.js';

export function getTcgPlayerSearchUrl(cardName: string): string {
  return `https://www.tcgplayer.com/search/yugioh/product?productLineName=yugioh&q=${encodeURIComponent(cardName)}`;
}

interface YgoprodeckCardSet {
  set_name: string;
  set_code: string;
  set_rarity: string;
  set_rarity_code?: string;
  set_price: string;
}

interface YgoprodeckCardPrices {
  cardmarket_price?: string;
  tcgplayer_price?: string;
  ebay_price?: string;
  amazon_price?: string;
  coolstuffinc_price?: string;
}

interface YgoprodeckCardData {
  id: number;
  name: string;
  card_sets?: YgoprodeckCardSet[];
  card_prices?: YgoprodeckCardPrices[];
}

interface YgoprodeckResponse {
  data?: YgoprodeckCardData[];
}

/**
 * Queries YGOPRODeck API for TCGPlayer market pricing or falls back to direct TCGPlayer search.
 */
export async function getTcgPlayerPrices(cardName: string, passcode?: number): Promise<CardPriceQuote[]> {
  const directUrl = getTcgPlayerSearchUrl(cardName);
  const fallbackQuote: CardPriceQuote = {
    platform: 'TCGPlayer',
    currency: 'USD',
    price: 0,
    url: directUrl,
    inStock: undefined,
    details: 'TCGPlayer direct search link (live market lookup)',
    isFallback: true,
    source: 'fallback'
  };

  try {
    let apiUrl = `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(cardName)}`;
    if (passcode && passcode > 0) {
      apiUrl = `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${passcode}`;
    }

    const response = await axios.get<YgoprodeckResponse>(apiUrl, {
      timeout: 6000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const card = response.data?.data?.[0];
    if (!card) {
      return [fallbackQuote];
    }

    const quotes: CardPriceQuote[] = [];
    const prices = card.card_prices?.[0];

    // 1. Primary TCGPlayer market quote from aggregated card_prices
    if (prices?.tcgplayer_price) {
      const parsedPrice = parseFloat(prices.tcgplayer_price);
      if (!isNaN(parsedPrice) && parsedPrice > 0) {
        quotes.push({
          platform: 'TCGPlayer',
          currency: 'USD',
          price: parsedPrice,
          rarity: 'Aggregate',
          url: directUrl,
          inStock: true,
          details: `${card.name} - TCGPlayer aggregate price for the cheapest commonly listed printing (not a per-rarity quote)`
        });
      }
    }

    // 2. Lowest print and highest print / edition quotes from card_sets if available
    if (card.card_sets && Array.isArray(card.card_sets) && card.card_sets.length > 0) {
      const validSets = card.card_sets
        .map(s => ({
          ...s,
          numericPrice: parseFloat(s.set_price) || 0
        }))
        .filter(s => s.numericPrice > 0)
        .sort((a, b) => a.numericPrice - b.numericPrice);

      if (validSets.length > 0) {
        const lowest = validSets[0];
        const highest = validSets[validSets.length - 1];

        // Lowest printing quote
        quotes.push({
          platform: 'TCGPlayer',
          currency: 'USD',
          price: lowest.numericPrice,
          rarity: lowest.set_rarity,
          url: directUrl,
          inStock: true,
          details: `Lowest: ${lowest.set_name} (${lowest.set_code}) - ${lowest.set_rarity}`
        });

        // If highest printing is distinctly different, include as premium/high quote
        if (highest.numericPrice > lowest.numericPrice) {
          quotes.push({
            platform: 'TCGPlayer',
            currency: 'USD',
            price: highest.numericPrice,
            rarity: highest.set_rarity,
            url: directUrl,
            inStock: true,
            details: `Highest: ${highest.set_name} (${highest.set_code}) - ${highest.set_rarity}`
          });
        }
      }
    }

    if (quotes.length === 0) {
      return [fallbackQuote];
    }

    return quotes;
  } catch (error) {
    // Graceful fallback to direct URL
    return [fallbackQuote];
  }
}
