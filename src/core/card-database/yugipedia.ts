import axios from 'axios';

export interface YugipediaCardInfo {
  pageId: number;
  title: string;
  url: string;
  japaneseName?: string;
  romajiName?: string;
  translatedNames?: Record<string, string>;
  cardType?: string;
  property?: string;
  attribute?: string;
  types?: string;
  levelRankLink?: number;
  atkDef?: string;
  lore?: string;
  archetypes?: string[];
  mentions?: string[];
  sets?: string[];
  triviaUrl?: string;
  tipsUrl?: string;
  rulingsUrl?: string;
}

const YUGIPEDIA_API = 'https://yugipedia.com/api.php';
const USER_AGENT = 'YugiohAssistantBot/1.0 (https://github.com/SPdream99/yugioh-assistant-mcp)';

/**
 * Normalizes title for Yugipedia URL and search
 */
function toWikiTitle(name: string): string {
  return name.trim().replace(/\s+/g, '_');
}

/**
 * Cleans wikitext markup (brackets, templates, rubies, etc.)
 */
function cleanWikiMarkup(text: string): string {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\{\{Ruby\|([^|}]+)\|([^|}]+)\}\}/gi, '$1($2)')
    .replace(/\{\{[^|}]+\|([^|}]+)\}\}/g, '$1')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * Fetches deep card information, lore, trivia, and multilingual facts from Yugipedia.
 */
export async function fetchYugipediaCardInfo(cardName: string): Promise<YugipediaCardInfo | null> {
  const wikiTitle = toWikiTitle(cardName);

  try {
    const resp = await axios.get(YUGIPEDIA_API, {
      params: {
        action: 'query',
        prop: 'revisions|info',
        inprop: 'url',
        rvprop: 'content',
        titles: wikiTitle,
        format: 'json',
        redirects: 1
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 6000
    });

    const pages = resp.data?.query?.pages;
    if (!pages) return null;

    const pageIdStr = Object.keys(pages)[0];
    if (pageIdStr === '-1') {
      // Try search if exact title fails
      return searchYugipediaCard(cardName);
    }

    const page = pages[pageIdStr];
    const wikitext: string = page.revisions?.[0]?.['*'] || '';
    const pageUrl: string = page.fullurl || `https://yugipedia.com/wiki/${wikiTitle}`;

    return parseCardTable(page.pageid, page.title, pageUrl, wikitext);
  } catch {
    return null;
  }
}

/**
 * Searches Yugipedia if exact title didn't resolve directly
 */
async function searchYugipediaCard(cardName: string): Promise<YugipediaCardInfo | null> {
  try {
    const searchResp = await axios.get(YUGIPEDIA_API, {
      params: {
        action: 'query',
        list: 'search',
        srsearch: cardName,
        srlimit: 1,
        format: 'json'
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 6000
    });

    const results = searchResp.data?.query?.search;
    if (!results || results.length === 0) return null;

    const bestTitle = results[0].title;
    return fetchYugipediaCardInfo(bestTitle);
  } catch {
    return null;
  }
}

/**
 * Parses CardTable2 wikitext into structured YugipediaCardInfo
 */
function parseCardTable(pageId: number, title: string, url: string, wikitext: string): YugipediaCardInfo {
  const extractParam = (paramName: string): string | undefined => {
    const regex = new RegExp(`^[\\t ]*\\|\\s*${paramName}\\s*=\\s*([^\\r\\n]+)`, 'mi');
    const match = wikitext.match(regex);
    return match ? cleanWikiMarkup(match[1]) : undefined;
  };

  const japaneseName = extractParam('ja_name');
  const romajiName = extractParam('romaji_name');

  const translatedNames: Record<string, string> = {};
  const fr = extractParam('fr_name');
  if (fr) translatedNames.French = fr;
  const de = extractParam('de_name');
  if (de) translatedNames.German = de;
  const it = extractParam('it_name');
  if (it) translatedNames.Italian = it;
  const es = extractParam('es_name');
  if (es) translatedNames.Spanish = es;
  const pt = extractParam('pt_name');
  if (pt) translatedNames.Portuguese = pt;
  const ko = extractParam('ko_name');
  if (ko) translatedNames.Korean = ko;
  const zh = extractParam('zh_name');
  if (zh) translatedNames.Chinese = zh;

  // Lore / effect text: check text, en_text, or lore
  const textMatch = wikitext.match(/\|\s*(?:en_)?(?:text|lore)\s*=\s*([\s\S]*?)(?=\n\s*\|[a-zA-Z_]+\s*=|\n\}\})/i);
  const rawLore = textMatch ? textMatch[1] : undefined;
  const lore = rawLore ? cleanWikiMarkup(rawLore) : undefined;

  // Mentions
  const mentions: string[] = [];
  const mentionMatches = wikitext.matchAll(/\|\s*mentions\s*=\s*([^\n]+)/gi);
  for (const m of mentionMatches) {
    const cleaned = cleanWikiMarkup(m[1]);
    if (cleaned) mentions.push(...cleaned.split(',').map(s => s.trim()).filter(Boolean));
  }

  // Related Subpages (Trivia, Tips, Rulings)
  const encodedTitle = toWikiTitle(title);
  const triviaUrl = `https://yugipedia.com/wiki/Card_Trivia:${encodedTitle}`;
  const tipsUrl = `https://yugipedia.com/wiki/Card_Tips:${encodedTitle}`;
  const rulingsUrl = `https://yugipedia.com/wiki/Card_Rulings:${encodedTitle}`;

  return {
    pageId,
    title,
    url,
    japaneseName,
    romajiName,
    translatedNames: Object.keys(translatedNames).length > 0 ? translatedNames : undefined,
    cardType: extractParam('card_type') || extractParam('type'),
    property: extractParam('property'),
    attribute: extractParam('attribute'),
    types: extractParam('types'),
    levelRankLink: parseInt(extractParam('level') || extractParam('rank') || extractParam('link') || '0', 10) || undefined,
    atkDef: extractParam('atk') ? `${extractParam('atk')} / ${extractParam('def') || 0}` : undefined,
    lore,
    mentions: mentions.length > 0 ? Array.from(new Set(mentions)) : undefined,
    triviaUrl,
    tipsUrl,
    rulingsUrl
  };
}
