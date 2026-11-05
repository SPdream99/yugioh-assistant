/**
 * Extracts a playable card record from a news article (YGOrganization and any
 * site with a normal article body).
 *
 * A brand-new card often exists only as a news post: no passcode, no entry in
 * cards.cdb, no script. This module pulls out the name, artwork URLs, effect
 * text and whatever stats the article prints, so the script generator has
 * something real to work from.
 */

import { assertSafeHttpUrl } from "../../utils/net-guard.js";

const USER_AGENT = "Mozilla/5.0 (compatible; yugioh-assistant-mcp/0.9.4; +https://github.com/SPdream99/yugioh-assistant-mcp)";

export interface NewsCardStats {
  atk?: number;
  def?: number;
  level?: number;
  rank?: number;
  link?: number;
  attribute?: string;
  type?: string;
  race?: string;
}

export interface NewsCardExtraction {
  available: boolean;
  sourceUrl: string;
  articleTitle?: string;
  cardName?: string;
  text?: string;
  images: string[];
  stats: NewsCardStats;
  confidence: "high" | "medium" | "low";
  /** Other cards the same article revealed. */
  otherCards?: string[];
  reason?: string;
}

const TYPE_WORDS = "Field Spell Card|Normal Spell Card|Quick-Play Spell Card|Continuous Spell Card|Equip Spell Card|Ritual Spell Card|Normal Trap Card|Continuous Trap Card|Counter Trap Card|Effect Monster|Normal Monster|Fusion Monster|Synchro Monster|Xyz Monster|Link Monster|Pendulum Monster|Ritual Monster";

export interface NewsCardBlock {
  name?: string;
  type?: string;
  text: string;
}

/**
 * Reveal articles usually list several cards. Splits the body on every
 * card-type phrase and captures the name printed just before it, so each card
 * gets its own text instead of one merged blob.
 */
export function extractCardBlocks(bodyText: string): NewsCardBlock[] {
  const re = new RegExp(TYPE_WORDS, "gi");
  const matches = [...bodyText.matchAll(re)];
  if (matches.length === 0) return [];

  const raw = matches.map((match, i) => {
    const start = match.index as number;
    const beforeStart = Math.max(0, start - 160);
    const before = bodyText.slice(beforeStart, start);
    const nameMatch = before.match(/\(([A-Z][A-Za-z0-9'’\-!:,. ]{2,60})\)\s*$/);
    const nameStart = nameMatch ? beforeStart + (before.length - nameMatch[0].length) : start;
    return {
      name: nameMatch ? nameMatch[1].trim() : undefined,
      type: match[0].replace(/\s*card$/i, "").trim(),
      nameStart,
      textStart: start + match[0].length,
      index: i
    };
  });

  return raw.map((block, i) => {
    const textEnd = i + 1 < raw.length ? Math.max(block.textStart, raw[i + 1].nameStart) : bodyText.length;
    const text = bodyText
      .slice(block.textStart, textEnd)
      .replace(/^[\s,:.\-–—]+/, "")
      .replace(/\s+/g, " ")
      .trim();
    return { name: block.name, type: block.type, text };
  });
}
const ATTRIBUTES = ["DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND", "DIVINE"];
const RACES = [
  "Spellcaster", "Dragon", "Zombie", "Warrior", "Beast-Warrior", "Beast", "Winged Beast", "Fiend",
  "Fairy", "Insect", "Dinosaur", "Reptile", "Fish", "Sea Serpent", "Aqua", "Pyro", "Thunder",
  "Rock", "Plant", "Machine", "Psychic", "Wyrm", "Cyberse", "Illusion"
];

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Cleans a news headline into a plausible card name. */
export function cardNameFromTitle(title: string): string {
  let name = title
    .replace(/\s*[|–—-]\s*YGOrganization\s*$/i, "")
    .replace(/^\s*\[[^\]]{1,12}\]\s*/g, "")
    .replace(/\b(card reveal|reveal|spoiler|new card|card|confirmed|officially revealed)\b/gi, " ")
    .replace(/\s*[-–—|:]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // "Name, from ..." / "Name and Name" → take the first segment.
  name = name.split(/\s+from\s+/i)[0].split(/\s*[,;]\s*/)[0].trim();

  // Drop trailing set/product noise in parentheses.
  name = name.replace(/\s*\((?:OCG|TCG|AE|Rush Duel|anime|manga)\)\s*$/i, "").trim();
  return name;
}

/**
 * Finds the card name inside the article body.
 *
 * Reveal posts usually look like:
 *   RV02-JP005 方界領域 Houkai Ryouiki (Cubic Dimension) Field Spell Card
 * so the Latin name in parentheses right before the card type is the best guess.
 */
export function cardNameFromBody(bodyText: string): string | undefined {
  const typeWords = "Field Spell Card|Normal Spell Card|Quick-Play Spell Card|Continuous Spell Card|Equip Spell Card|Ritual Spell Card|Normal Trap Card|Continuous Trap Card|Counter Trap Card|Effect Monster|Normal Monster|Fusion Monster|Synchro Monster|Xyz Monster|Link Monster|Pendulum Monster|Ritual Monster";

  const paren = bodyText.match(new RegExp(`\\(([A-Z][A-Za-z0-9'’\\-!:,. ]{2,60})\\)\\s*(?:${typeWords})`, "i"));
  if (paren) return paren[1].trim();

  const plain = bodyText.match(new RegExp(`([A-Z][A-Za-z0-9'’\\-!:,. ]{2,60}?)\\s+(?:${typeWords})`, "i"));
  if (plain) {
    return plain[1]
      .replace(/^.*?(?:RV|DB|AC|PHNI|LEDE|AGOV|SUDA|ALIN|INFO|VASM|DUNE|CYAC|BLVO|BACH|DIFO|BODE|MP|OP|SD|SR|ST|TU|AP|JUMP)[-A-Z0-9]*\s+/i, "")
      .trim();
  }
  return undefined;
}

/** Pulls PSCT-looking sentences out of the article body. */
export function extractCardText(bodyText: string): string {
  const sentences = bodyText
    .split(/(?<=[.!?])\s+(?=[A-Z“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);

  const psct = sentences.filter((s) =>
    /(you can|if this card|when this card|once per turn|during the |target \d|special summon|add 1|destroy|banish|send .* to the gy|gain \d+ life|inflict \d+ damage|this card gains|cannot be)/i.test(s)
  );

  if (psct.length === 0) return "";
  return psct.join(" ").replace(/\s+/g, " ").trim();
}

export function parseStats(bodyText: string): NewsCardStats {
  const stats: NewsCardStats = {};
  const atk = bodyText.match(/\bATK[:\s/]*(\d{1,5})/i) || bodyText.match(/(\d{1,5})\s*ATK\b/i);
  const def = bodyText.match(/\bDEF[:\s/]*(\d{1,5})/i) || bodyText.match(/(\d{1,5})\s*DEF\b/i);
  const level = bodyText.match(/\bLevel[:\s]*(\d{1,2})\b/i);
  const rank = bodyText.match(/\bRank[:\s]*(\d{1,2})\b/i);
  const link = bodyText.match(/\bLink[-\s]?(\d)\b/i);

  if (atk) stats.atk = Number(atk[1]);
  if (def) stats.def = Number(def[1]);
  if (level) stats.level = Number(level[1]);
  if (rank) stats.rank = Number(rank[1]);
  if (link) stats.link = Number(link[1]);

  const attribute = ATTRIBUTES.find((a) => new RegExp(`\\b${a}\\b`, "i").test(bodyText));
  if (attribute) stats.attribute = attribute;

  const race = RACES.find((r) => new RegExp(`\\b${r}\\b`, "i").test(bodyText));
  if (race) stats.race = race;

  // Spell/Trap phrasing is unambiguous, so check it before any generic "monster" word
  // (spell text often says "add 1 monster", which must not be mistaken for the card type).
  if (/\bfield spell( card)?\b/i.test(bodyText)) stats.type = "Field Spell";
  else if (/\bquick-play spell( card)?\b/i.test(bodyText)) stats.type = "Quick-Play Spell";
  else if (/\bcontinuous spell( card)?\b/i.test(bodyText)) stats.type = "Continuous Spell";
  else if (/\bequip spell( card)?\b/i.test(bodyText)) stats.type = "Equip Spell";
  else if (/\britual spell( card)?\b/i.test(bodyText)) stats.type = "Ritual Spell";
  else if (/\bcounter trap( card)?\b/i.test(bodyText)) stats.type = "Counter Trap";
  else if (/\bcontinuous trap( card)?\b/i.test(bodyText)) stats.type = "Continuous Trap";
  else if (/\bnormal trap( card)?\b/i.test(bodyText)) stats.type = "Normal Trap";
  else if (/\bnormal spell( card)?\b/i.test(bodyText)) stats.type = "Normal Spell";
  else if (/\blink monster\b/i.test(bodyText)) stats.type = "Link Monster";
  else if (/\bxyz monster\b|\brank \d/i.test(bodyText)) stats.type = "Xyz Monster";
  else if (/\bsynchro monster\b/i.test(bodyText)) stats.type = "Synchro Monster";
  else if (/\bfusion monster\b/i.test(bodyText)) stats.type = "Fusion Monster";
  else if (/\britual monster\b/i.test(bodyText)) stats.type = "Ritual Monster";
  else if (/\bpendulum monster\b/i.test(bodyText)) stats.type = "Pendulum Monster";
  else if (/\bnormal monster\b/i.test(bodyText)) stats.type = "Normal Monster";
  else if (/\beffect monster\b/i.test(bodyText)) stats.type = "Effect Monster";
  else if (/\btrap card\b/i.test(bodyText)) stats.type = "Normal Trap";
  else if (/\bspell card\b/i.test(bodyText)) stats.type = "Normal Spell";

  return stats;
}

/** Collects card-ish image URLs from the article. */
export function extractImages(html: string, baseUrl: string): string[] {
  const found = new Set<string>();

  for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) {
    found.add(m[1]);
  }
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = m[1];
    if (/logo|avatar|icon|banner|emoji|sprite|header/i.test(src)) continue;
    if (!/\.(png|jpe?g|webp)(\?|$)/i.test(src)) continue;
    found.add(src);
  }

  return [...found]
    .map((src) => {
      try {
        return new URL(src, baseUrl).toString();
      } catch {
        return src;
      }
    })
    .slice(0, 12);
}

/**
 * Fetches an article and extracts a card record. Never invents content: when the
 * page has no recognisable card text the result is unavailable with a reason.
 */
export async function extractCardFromArticle(
  url: string,
  options: { cardName?: string } = {}
): Promise<NewsCardExtraction> {
  try {
    await assertSafeHttpUrl(url);
  } catch (error) {
    return {
      available: false,
      sourceUrl: url,
      images: [],
      stats: {},
      confidence: "low",
      reason: (error as Error).message
    };
  }

  let html: string;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      return { available: false, sourceUrl: url, images: [], stats: {}, confidence: "low", reason: `HTTP ${response.status} while fetching the article.` };
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 5_000_000) {
      return { available: false, sourceUrl: url, images: [], stats: {}, confidence: "low", reason: "Article is larger than 5 MB; refusing to parse it." };
    }
    html = await response.text();
    if (html.length > 5_000_000) html = html.slice(0, 5_000_000);
  } catch (error) {
    return { available: false, sourceUrl: url, images: [], stats: {}, confidence: "low", reason: `Could not fetch the article: ${(error as Error).message}` };
  }

  const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const articleTitle = titleMatch ? stripTags(titleMatch[1]) : "";

  const bodyMatch = html.match(/<div[^>]+class="[^"]*(?:entry-content|post-content|article-content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/(?:article|div)>/i)
    || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const bodyText = stripTags(bodyHtml);

  const blocks = extractCardBlocks(bodyText);
  const wanted = options.cardName?.trim().toLowerCase();
  const primary = wanted
    ? blocks.find((b) => (b.name || "").toLowerCase().includes(wanted)) || blocks[0]
    : blocks[0];

  const cardText = primary?.text && primary.text.length > 20 ? primary.text : extractCardText(bodyText);
  const stats = parseStats(bodyText);
  if (primary?.type) stats.type = primary.type;
  const images = extractImages(bodyHtml, url);
  const bodyName = cardNameFromBody(bodyText);
  const titleName = cardNameFromTitle(articleTitle);
  const cardName = primary?.name || bodyName || titleName || undefined;
  const otherCards = blocks.map((b) => b.name).filter((n): n is string => Boolean(n) && n !== cardName);

  if (!cardName && !cardText) {
    return { available: false, sourceUrl: url, articleTitle, images, stats, confidence: "low", reason: "The article contains no recognisable card name or card text." };
  }

  const confidence: NewsCardExtraction["confidence"] =
    cardText.length > 40 && Object.keys(stats).length >= 2 ? "high" : cardText.length > 0 ? "medium" : "low";

  return {
    available: true,
    sourceUrl: url,
    articleTitle,
    cardName,
    text: cardText || undefined,
    images,
    stats,
    confidence,
    otherCards: otherCards.length ? otherCards : undefined
  };
}
