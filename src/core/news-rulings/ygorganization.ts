import axios from 'axios';
import { generateFreshnessEvidence, type FreshnessEvidence } from '../freshness/freshness-engine.js';

export interface YgoNewsItem {
  title: string;
  link: string;
  pubDate: string;
  snippet: string;
  isCardReveal: boolean;
  categories?: string[];
  freshness?: FreshnessEvidence;
}

function cleanCdataAndHtml(text: string): string {
  if (!text) return '';
  // 1. Unwrap CDATA
  let cleaned = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
  // 2. Strip HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  // 3. Unescape common HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '--')
    .replace(/&nbsp;/g, ' ');
  // 4. Normalize whitespace
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Checks whether an article is likely a new card reveal or card spoiler.
 */
function checkIfCardReveal(title: string, categories: string[], snippet: string): boolean {
  const combined = `${title} ${categories.join(' ')} ${snippet}`.toLowerCase();

  const revealKeywords = [
    '[ocg]',
    '[tcg]',
    '[ae]',
    '[rush]',
    'card reveal',
    'card effect',
    'new card',
    'spoiler',
    'set reveal',
    'product reveal',
    'structure deck',
    'animation chronicle',
    'quarter century',
    'terminal world',
    'booster pack',
    'deck build pack',
    'core booster',
    'promo card'
  ];

  return revealKeywords.some(keyword => combined.includes(keyword));
}

// No fake fallback items: if the RSS feed is unreachable, callers get an empty list
// and must report that the live source is unavailable.

/**
 * Fetches and parses the latest Yu-Gi-Oh! news articles from YGOrganization RSS feed.
 */
export async function getLatestYgoNews(limit: number = 10): Promise<YgoNewsItem[]> {
  const feedUrl = 'https://ygorganization.com/feed/';

  try {
    const response = await axios.get<string>(feedUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      responseType: 'text'
    });

    const xml = response.data;
    if (!xml || typeof xml !== 'string') {
      return [];
    }

    const items: YgoNewsItem[] = [];
    // Match each <item> block in RSS 2.0
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRegex.exec(xml)) !== null && items.length < limit) {
      const block = itemMatch[1];

      // Extract title
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
      const rawTitle = titleMatch ? titleMatch[1] : 'Untitled Article';
      const title = cleanCdataAndHtml(rawTitle);

      // Extract link
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
      const link = linkMatch ? cleanCdataAndHtml(linkMatch[1]) : 'https://ygorganization.com';

      // Extract pubDate
      const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const pubDate = pubDateMatch ? cleanCdataAndHtml(pubDateMatch[1]) : '';

      // Extract categories
      const categories: string[] = [];
      const catRegex = /<category>([\s\S]*?)<\/category>/gi;
      let catMatch: RegExpExecArray | null;
      while ((catMatch = catRegex.exec(block)) !== null) {
        categories.push(cleanCdataAndHtml(catMatch[1]));
      }

      // Extract description or content snippet
      const descMatch = block.match(/<(?:description|content:encoded)>([\s\S]*?)<\/(?:description|content:encoded)>/i);
      const rawDesc = descMatch ? descMatch[1] : '';
      let snippet = cleanCdataAndHtml(rawDesc);
      if (snippet.length > 250) {
        snippet = `${snippet.slice(0, 247)}...`;
      }

      const isCardReveal = checkIfCardReveal(title, categories, snippet);

      const freshness = generateFreshnessEvidence({
        sourceUrl: link || feedUrl,
        sourcePublishedAt: pubDate || new Date().toISOString(),
        isLiveFetch: true,
        dataPayload: { title, snippet }
      });

      items.push({
        title,
        link,
        pubDate,
        snippet,
        isCardReveal,
        categories,
        freshness
      });
    }

    return items;
  } catch {
    // Live source unavailable: return no items rather than fabricated news.
    return [];
  }
}
