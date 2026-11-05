import { CardDatabase } from '../card-database/ygoprodeck.js';
import { httpFetch } from '../http/fetch-client.js';
import { formatYdke } from '../deck-parser/ydke.js';
import { parseYdk } from '../deck-parser/ydk.js';
import type { DeckData } from '../../types/deck.js';

/**
 * Community decklists + combos from public sources.
 *
 * Sources (both are the sites' own public JSON, the same endpoints their search
 * pages call — no scraping of rendered HTML):
 *  - YGOPRODeck  /api/decks/getDecks.php   (TCG community + curated tournament decks)
 *  - Master Duel Meta /api/v1/top-decks    (Master Duel community decks)
 *  - Master Duel Meta /api/v1/combos       (structured combo guides)
 *
 * Every deck keeps its canonical page URL. The ydke link is built from the
 * passcodes so the other tools (legality, cost, consistency, optimize) can
 * consume the deck directly.
 */

const UA = {
  'User-Agent': 'Mozilla/5.0 (compatible; yugioh-assistant-mcp/0.9.4; +https://github.com/SPdream99/yugioh-assistant-mcp)',
  Accept: 'application/json'
};

const YGOPRO_DECKS = 'https://ygoprodeck.com/api/decks/getDecks.php';
const MDM_TOP_DECKS = 'https://www.masterduelmeta.com/api/v1/top-decks';
const MDM_DECK_TYPES = 'https://www.masterduelmeta.com/api/v1/deck-types';
const MDM_COMBOS = 'https://www.masterduelmeta.com/api/v1/combos';
const MDM_COUNTERS = 'https://www.masterduelmeta.com/api/v1/counters';
const KONAMI_DECK_SEARCH = 'https://www.db.yugioh-card.com/yugiohdb/deck_search.action';
const KONAMI_BASE = 'https://www.db.yugioh-card.com';

export type DeckSource = 'ygoprodeck' | 'masterduelmeta' | 'konami' | 'formatlibrary';
export type DeckSort = 'popular' | 'recent' | 'comments';

export interface DeckComboEvidence {
  kind: 'description' | 'youtube' | 'guide' | 'replay';
  text?: string;
  url?: string;
}

export interface TournamentInfo {
  name?: string;
  placement?: string;
  player?: string;
  playerCount?: number;
  approximate?: boolean;
}

export interface CommunityDeck {
  source: DeckSource;
  id: string;
  name: string;
  author?: string;
  url: string;
  format?: string;
  submittedAt?: string;
  views?: number;
  priceUsd?: number;
  tournament?: TournamentInfo;
  counts: { main: number; extra: number; side: number };
  cards: { main: number[]; extra: number[]; side: number[] };
  cardNames?: { main: string[]; extra: string[]; side: string[] };
  unresolvedCards?: number;
  ydke: string;
  combos: DeckComboEvidence[];
  /** Same list found on another source (deduped by ydke). */
  alsoFoundIn?: Array<{ source: DeckSource; url: string; name: string }>;
}

export interface CommunityCombo {
  source: 'masterduelmeta';
  id: string;
  title: string;
  archetype: string;
  startingCards: string[];
  steps: Array<{ step: number; actions: string[] }>;
  notes?: string;
  upvotes?: number;
  url: string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parsePasscodeJson(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0);
  } catch {
    // Some payloads use a comma separated list.
    return value
      .split(',')
      .map(v => Number(v.trim()))
      .filter(n => Number.isFinite(n) && n > 0);
  }
  return [];
}

/** Pull combo-like lines out of a free-text deck write-up. */
function extractComboText(descriptionHtml: string): string[] {
  const text = stripHtml(descriptionHtml);
  if (!text) return [];
  const segments = text
    .split(/\n|(?<=[.!?])\s{2,}/)
    .map(s => s.trim())
    .filter(s => s.length >= 20);
  const markers = /combo|starter|one[- ]card|two[- ]card|end board|extend|line|→|->|then summon|ends on/i;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const segment of segments) {
    if (!markers.test(segment)) continue;
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(segment);
    if (out.length >= 5) break;
  }
  return out;
}

function buildYdke(cards: { main: number[]; extra: number[]; side: number[] }): string {
  const deck: DeckData = { main: cards.main, extra: cards.extra, side: cards.side };
  return formatYdke(deck);
}

// ---------------------------------------------------------------------------
// YGOPRODeck
// ---------------------------------------------------------------------------

interface YgoProDeckRow {
  deckNum?: number;
  pretty_url?: string;
  deck_name?: string;
  username?: string;
  deck_description?: string;
  deck_excerpt?: string;
  youtube_link?: string | null;
  main_deck?: unknown;
  extra_deck?: unknown;
  side_deck?: unknown;
  format?: string;
  submit_date?: string;
  deck_views?: number;
  deck_price?: string | number;
  tournamentName?: string | null;
  tournamentPlacement?: string | null;
  tournamentPlayerName?: string | null;
  tournamentPlayerCount?: number | null;
  tournamentPlayerCountIsApproximate?: number | null;
}

export interface CommunityDeckQuery {
  query?: string;
  archetype?: string;
  format?: string;
  sort?: DeckSort;
  limit?: number;
  offset?: number;
  includeNames?: boolean;
  /** Raw taxonomy: "type/elfnote", a full /category/... URL, or a bare archetype. */
  category?: string;
  tournament?: string;
  deckSize?: number;
  minPrice?: number;
  maxPrice?: number;
  from?: string;
  to?: string;
  containsCard?: string;
  excludeCard?: string;
}

/**
 * YGOPRODeck exposes one category taxonomy publicly: /category/type/<slug>, which
 * is the same `_sft_post_tag` filter the deck search uses. Accept the URL, the
 * "type/slug" pair, or a bare archetype so the caller can paste what it sees.
 */
function parseCategory(value: string): { archetype: string; categoryUrl: string } {
  const fromUrl = value.match(/\/category\/[a-z-]+\/([^/?#]+)/i);
  const fromPair = value.match(/^[a-z-]+\/([^/?#]+)$/i);
  const slug = fromUrl?.[1] || fromPair?.[1] || value.trim();
  const decoded = decodeURIComponent(slug).replace(/-/g, ' ').trim();
  return {
    archetype: decoded.replace(/\b\w/g, c => c.toUpperCase()),
    categoryUrl: `https://ygoprodeck.com/category/type/${slug}`
  };
}

function sortToYgoPro(sort: DeckSort | undefined): string {
  if (sort === 'recent') return 'Updated';
  if (sort === 'comments') return 'Comments';
  return 'Deck Views';
}

export interface CommunityDeckSearchResult {
  decks: CommunityDeck[];
  appliedFilters: Record<string, unknown>;
  categoryUrl?: string;
  sourceUrl: string;
}

async function resolvePasscode(name: string | undefined): Promise<number | undefined> {
  if (!name) return undefined;
  const db = CardDatabase.getInstance();
  const local = db.getCardByName(name);
  if (local) return local.id;
  const fetched = await db.fetchCardOnline(name).catch(() => undefined);
  return fetched?.id;
}

export async function searchYgoproDecksDetailed(options: CommunityDeckQuery): Promise<CommunityDeckSearchResult> {
  const params = new URLSearchParams();
  const applied: Record<string, unknown> = {};

  const category = options.category ? parseCategory(options.category) : undefined;
  const archetype = options.archetype || category?.archetype;

  if (options.query) {
    params.set('name', options.query);
    applied.name = options.query;
  }
  if (archetype) {
    params.set('_sft_post_tag', archetype);
    applied.archetype = archetype;
  }
  if (options.format) {
    params.set('_sft_category', options.format);
    applied.format = options.format;
  }
  if (options.tournament) {
    params.set('tournament', options.tournament);
    applied.tournament = options.tournament;
  }
  if (typeof options.deckSize === 'number' && options.deckSize > 0) {
    params.set('decksize', String(options.deckSize));
    applied.deckSize = options.deckSize;
  }
  if (typeof options.minPrice === 'number') {
    params.set('fromprice', String(options.minPrice));
    applied.minPrice = options.minPrice;
  }
  if (typeof options.maxPrice === 'number') {
    params.set('toprice', String(options.maxPrice));
    applied.maxPrice = options.maxPrice;
  }
  if (options.from) {
    params.set('from', options.from);
    applied.from = options.from;
  }
  if (options.to) {
    params.set('to', options.to);
    applied.to = options.to;
  }

  const containsId = await resolvePasscode(options.containsCard);
  if (containsId) {
    params.set('cardcode', `${containsId}|`);
    applied.containsCard = { name: options.containsCard, passcode: containsId };
  } else if (options.containsCard) {
    applied.containsCard = { name: options.containsCard, unresolved: true };
  }

  const excludeId = await resolvePasscode(options.excludeCard);
  if (excludeId) {
    params.set('notcardcode', `${excludeId}|`);
    applied.excludeCard = { name: options.excludeCard, passcode: excludeId };
  } else if (options.excludeCard) {
    applied.excludeCard = { name: options.excludeCard, unresolved: true };
  }

  params.set('sort', sortToYgoPro(options.sort));
  params.set('offset', String(options.offset ?? 0));
  applied.sort = options.sort || 'popular';

  const sourceUrl = `${YGOPRO_DECKS}?${params.toString()}`;
  const response = await httpFetch(sourceUrl, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `YGOPRODeck deck search returned HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}`
    );
  }

  const rows = (await response.json()) as YgoProDeckRow[];
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 20);
  const decks = (Array.isArray(rows) ? rows : []).slice(0, limit).map(row => toCommunityDeck(row));

  return {
    decks,
    appliedFilters: applied,
    categoryUrl: category?.categoryUrl,
    sourceUrl
  };
}

export async function searchYgoproDecks(options: CommunityDeckQuery): Promise<CommunityDeck[]> {
  return (await searchYgoproDecksDetailed(options)).decks;
}

function toCommunityDeck(row: YgoProDeckRow): CommunityDeck {
  const cards = {
    main: parsePasscodeJson(row.main_deck),
    extra: parsePasscodeJson(row.extra_deck),
    side: parsePasscodeJson(row.side_deck)
  };

  const combos: DeckComboEvidence[] = extractComboText(String(row.deck_description || '')).map(text => ({
    kind: 'description' as const,
    text
  }));
  if (row.youtube_link) combos.push({ kind: 'youtube', url: row.youtube_link, text: 'Author combo/guide video' });

  const deck: CommunityDeck = {
    source: 'ygoprodeck',
    id: String(row.deckNum ?? row.pretty_url ?? ''),
    name: row.deck_name || 'Untitled deck',
    author: row.username,
    url: `https://ygoprodeck.com/deck/${row.pretty_url}`,
    format: row.format,
    submittedAt: row.submit_date,
    views: typeof row.deck_views === 'number' ? row.deck_views : undefined,
    priceUsd: row.deck_price != null ? Number(row.deck_price) : undefined,
    counts: { main: cards.main.length, extra: cards.extra.length, side: cards.side.length },
    cards,
    ydke: buildYdke(cards),
    combos
  };

  if (row.tournamentName || row.tournamentPlacement) {
    deck.tournament = {
      name: row.tournamentName || undefined,
      placement: row.tournamentPlacement || undefined,
      player: row.tournamentPlayerName || undefined,
      playerCount: row.tournamentPlayerCount ?? undefined,
      approximate: Boolean(row.tournamentPlayerCountIsApproximate)
    };
  }

  return deck;
}

// ---------------------------------------------------------------------------
// Master Duel Meta decks
// ---------------------------------------------------------------------------

interface MdmCardEntry {
  card?: { name?: string };
  amount?: number;
}

interface MdmDeckRow {
  _id: string;
  url?: string;
  created?: string;
  deckType?: { name?: string };
  rankedType?: string;
  main?: MdmCardEntry[];
  extra?: MdmCardEntry[];
  side?: MdmCardEntry[];
  srPrice?: number;
  urPrice?: number;
  hasReplays?: boolean;
  linkedArticle?: string | null;
  duelRating?: number;
}

const MDM_DECK_TYPE_CACHE_MS = 10 * 60 * 1000;

function resolveNames(entries: MdmCardEntry[] | undefined, db: CardDatabase): { ids: number[]; names: string[] } {
  const ids: number[] = [];
  const names: string[] = [];
  for (const entry of entries || []) {
    const name = entry?.card?.name;
    const amount = Math.max(1, Number(entry?.amount) || 1);
    if (!name) continue;
    const card = db.getCardByName(name);
    for (let i = 0; i < amount; i++) {
      names.push(name);
      if (card) ids.push(card.id);
    }
  }
  return { ids, names };
}

export async function searchMasterDuelDecks(options: CommunityDeckQuery): Promise<CommunityDeck[]> {
  const response = await httpFetch(`${MDM_TOP_DECKS}?limit=200&sort=-created`, {
    headers: UA,
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Master Duel Meta top-decks returned HTTP ${response.status}`);
  const payload = await response.json();
  const rows = (Array.isArray(payload) ? payload : payload.docs || payload.data || []) as MdmDeckRow[];

  const needle = (options.query || options.archetype || '').trim().toLowerCase();
  const filtered = needle
    ? rows.filter(row => {
        const haystack = `${row.deckType?.name || ''} ${(row.main || []).map(c => c.card?.name || '').join(' ')}`.toLowerCase();
        return haystack.includes(needle);
      })
    : rows;

  const db = CardDatabase.getInstance();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 20);

  return filtered.slice(0, limit).map(row => {
    const main = resolveNames(row.main, db);
    const extra = resolveNames(row.extra, db);
    const side = resolveNames(row.side, db);
    const cards = { main: main.ids, extra: extra.ids, side: side.ids };
    const resolved = main.ids.length + extra.ids.length + side.ids.length;
    const expected = main.names.length + extra.names.length + side.names.length;

    const combos: DeckComboEvidence[] = [];
    if (row.hasReplays) combos.push({ kind: 'replay', text: 'Author replays available on the deck page' });
    if (row.linkedArticle) combos.push({ kind: 'guide', url: row.linkedArticle, text: 'Linked guide' });

    return {
      source: 'masterduelmeta' as const,
      id: row._id,
      name: row.deckType?.name || 'Master Duel deck',
      author: undefined,
      url: `https://www.masterduelmeta.com${row.url || ''}`,
      format: row.rankedType || 'Master Duel',
      submittedAt: row.created,
      priceUsd: undefined,
      counts: { main: main.names.length, extra: extra.names.length, side: side.names.length },
      cards,
      cardNames: { main: main.names, extra: extra.names, side: side.names },
      unresolvedCards: expected - resolved,
      ydke: buildYdke(cards),
      combos
    };
  });
}

// ---------------------------------------------------------------------------
// Master Duel Meta combos
// ---------------------------------------------------------------------------

interface MdmComboRow {
  _id: string;
  title?: string;
  deckType?: { _id?: string; name?: string };
  startingCards?: Array<{ card?: { name?: string } }>;
  steps?: Array<{ entries?: Array<{ card?: { name?: string }; label?: string }> }>;
  notes?: string;
  upvotes?: number;
}

let comboCache: { at: number; rows: MdmComboRow[] } | undefined;

async function loadAllCombos(): Promise<MdmComboRow[]> {
  if (comboCache && Date.now() - comboCache.at < MDM_DECK_TYPE_CACHE_MS) return comboCache.rows;
  const response = await httpFetch(`${MDM_COMBOS}?limit=300`, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Master Duel Meta combos returned HTTP ${response.status}`);
  const payload = await response.json();
  const rows = (Array.isArray(payload) ? payload : payload.docs || payload.data || []) as MdmComboRow[];
  comboCache = { at: Date.now(), rows };
  return rows;
}

export async function findCombos(options: { archetype?: string; card?: string; limit?: number }): Promise<{
  available: boolean;
  archetype?: string;
  combos: CommunityCombo[];
  knownArchetypes?: string[];
  reason?: string;
  sourceUrl: string;
  corpusSize: number;
}> {
  const sourceUrl = 'https://www.masterduelmeta.com/api/v1/combos';
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 30);
  const rows = await loadAllCombos();
  const knownArchetypes = [...new Set(rows.map(r => r.deckType?.name).filter((n): n is string => Boolean(n)))].sort();

  // Filter on the combo rows themselves. The /deck-types endpoint does not list
  // every deck type that has combos (Dracotail is a real example), so using it as
  // a gate produced false "unknown archetype" answers.
  if (options.archetype) {
    const needle = options.archetype.trim().toLowerCase();
    const exact = rows.filter(r => (r.deckType?.name || '').toLowerCase() === needle);
    const fuzzy = exact.length > 0
      ? exact
      : rows.filter(r => {
          const name = (r.deckType?.name || '').toLowerCase();
          return name.includes(needle) || needle.includes(name);
        });

    if (fuzzy.length === 0) {
      return {
        available: false,
        combos: [],
        corpusSize: rows.length,
        reason: `No combo entry in the ${rows.length} newest public combos belongs to "${options.archetype}".`,
        knownArchetypes: knownArchetypes.slice(0, 25),
        sourceUrl
      };
    }

    return {
      available: true,
      archetype: fuzzy[0].deckType?.name,
      corpusSize: rows.length,
      combos: fuzzy.slice(0, limit).map(row => mapCombo(row, sourceUrl)),
      sourceUrl
    };
  }

  if (options.card) {
    const needle = options.card.trim().toLowerCase();
    const matching = rows.filter(row => {
      const haystack = [
        ...(row.startingCards || []).map(c => c.card?.name || ''),
        ...(row.steps || []).flatMap(s => (s.entries || []).map(e => e.card?.name || ''))
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });

    return {
      available: matching.length > 0,
      corpusSize: rows.length,
      combos: matching.slice(0, limit).map(row => mapCombo(row, sourceUrl)),
      reason:
        matching.length === 0
          ? `No combo in the ${rows.length} newest public combos uses "${options.card}".`
          : undefined,
      knownArchetypes: matching.length === 0 ? knownArchetypes.slice(0, 25) : undefined,
      sourceUrl
    };
  }

  return {
    available: false,
    combos: [],
    corpusSize: rows.length,
    reason: 'Provide an archetype (or a card name).',
    knownArchetypes: knownArchetypes.slice(0, 25),
    sourceUrl
  };
}

export function mapCombo(row: MdmComboRow, sourceUrl: string): CommunityCombo {
  return {
    source: 'masterduelmeta',
    id: row._id,
    title: row.title || 'Untitled combo',
    archetype: row.deckType?.name || '',
    startingCards: (row.startingCards || []).map(c => c.card?.name).filter((n): n is string => Boolean(n)),
    steps: (row.steps || []).map((step, index) => ({
      step: index + 1,
      actions: (step.entries || []).map(entry => {
        const name = entry.card?.name;
        if (name && entry.label) return `${entry.label}: ${name}`;
        if (name) return `Use ${name}`;
        if (entry.label) return entry.label;
        return 'Unspecified step';
      })
    })),
    notes: row.notes ? stripHtml(row.notes).slice(0, 500) : undefined,
    upvotes: row.upvotes,
    url: `${sourceUrl}?deckType=${row.deckType?._id || ''}`
  };
}

// ---------------------------------------------------------------------------
// Konami official card database (Neuron) — public deck recipes
// ---------------------------------------------------------------------------

interface KonamiSession {
  cookie: string;
  ytkn: string;
}

async function konamiSession(): Promise<KonamiSession> {
  const response = await httpFetch(`${KONAMI_DECK_SEARCH}?request_locale=en`, {
    headers: {
      'User-Agent': UA['User-Agent'],
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(20_000)
  });
  const html = await response.text();
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const cookie = cookies.map(c => c.split(';')[0]).join('; ');
  const ytkn = (html.match(/name="ytkn"[^>]*value="([^"]*)"/i) || [])[1] || '';
  return { cookie, ytkn };
}

const KONAMI_BASE_BODY: Record<string, string> = {
  ope: '1',
  sess: '1',
  request_locale: 'en',
  cardid: '',
  wname: 'MemberDeck',
  deck_code: '',
  cardname: '',
  keyword: '',
  deck_type: '',
  deckStyle: '',
  sort: '1',
  page: '1'
};

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Parses one Konami recipe page into Main / Extra / Side names with counts. */
export function parseKonamiRecipe(html: string): { main: string[]; extra: string[]; side: string[] } {
  const readTable = (id: string): string[] => {
    const start = html.indexOf(`id="${id}"`);
    if (start < 0) return [];
    const end = html.indexOf('</table>', start);
    if (end < 0) return [];
    const block = html.slice(start, end);
    const out: string[] = [];
    for (const row of block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cell = row[1];
      if (!/class="row_num"/.test(cell)) continue;
      // The copy count is the trailing <td class="num"><span>N</span></td>;
      // class="row_num" is only the row index.
      const count = Number((cell.match(/<td class="num">\s*<span>\s*(\d+)\s*<\/span>/) || [])[1] || 0);
      const name = (cell.match(/class="card_name">[\s\S]*?<span>([^<]+)<\/span>/) || [])[1];
      if (!name || count <= 0) continue;
      for (let i = 0; i < Math.min(count, 3); i++) out.push(decodeEntities(name));
    }
    return out;
  };

  return {
    main: [...readTable('monster_list'), ...readTable('spell_list'), ...readTable('trap_list')],
    extra: readTable('extra_list'),
    side: readTable('side_list')
  };
}

/**
 * Konami's public deck search (Neuron). It is a POST form guarded by a session
 * cookie + `ytkn` token, and each recipe is a second request. Deck pages are
 * public (verified), so the returned URL works without the session.
 */
export async function searchKonamiDecks(options: { query: string; limit?: number }): Promise<CommunityDeck[]> {
  const query = options.query?.trim();
  if (!query) throw new Error('Konami deck search requires a deck name or keyword.');

  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const session = await konamiSession();
  const body = new URLSearchParams({
    ...KONAMI_BASE_BODY,
    ytkn: session.ytkn,
    deckname: query,
    rp: String(Math.min(limit * 2, 20))
  });

  const response = await httpFetch(`${KONAMI_DECK_SEARCH}?request_locale=en`, {
    method: 'POST',
    headers: {
      'User-Agent': UA['User-Agent'],
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${KONAMI_DECK_SEARCH}?request_locale=en`,
      Cookie: session.cookie
    },
    body: body.toString(),
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw new Error(`Konami deck search returned HTTP ${response.status}`);
  const html = await response.text();

  const rows = html.split(/<div class="t_row deck_type_l/i).slice(1);
  const db = CardDatabase.getInstance();
  const decks: CommunityDeck[] = [];

  for (const row of rows) {
    if (decks.length >= limit) break;

    const name = decodeEntities((row.match(/<span class="name">\s*([^<]+?)\s*<\/span>/) || [])[1] || '');
    const href = (row.match(/href="(\/yugiohdb\/member_deck\.action\?[^"]+)"/) || [])[1];
    if (!name || !href) continue;

    const url = `${KONAMI_BASE}${href.replace(/&amp;/g, '&')}`;
    let recipe = { main: [] as string[], extra: [] as string[], side: [] as string[] };
    try {
      const detail = await httpFetch(url, {
        headers: { 'User-Agent': UA['User-Agent'], 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(25_000)
      });
      if (detail.ok) recipe = parseKonamiRecipe(await detail.text());
    } catch {
      // A missing detail page must not kill the whole search.
    }

    const toIds = (names: string[]): number[] =>
      names.map(cardName => db.getCardByName(cardName)?.id).filter((id): id is number => Boolean(id));

    const main = toIds(recipe.main);
    const extra = toIds(recipe.extra);
    const side = toIds(recipe.side);
    const expected = recipe.main.length + recipe.extra.length + recipe.side.length;
    const cards = { main, extra, side };

    decks.push({
      source: 'konami',
      id: (href.match(/cgid=([a-f0-9]+)/) || [])[1] || url,
      name,
      url,
      format: 'TCG (Konami deck recipe)',
      counts: { main: recipe.main.length, extra: recipe.extra.length, side: recipe.side.length },
      cards,
      unresolvedCards: expected - (main.length + extra.length + side.length),
      ydke: buildYdke(cards),
      combos: []
    });
  }

  return decks;
}

// ---------------------------------------------------------------------------
// Format Library (retro/community formats: GOAT, Edison, Fiber, ...)
// ---------------------------------------------------------------------------

interface FormatLibraryRow {
  id: number;
  name: string | null;
  deckTypeName: string;
  builderName?: string;
  formatName?: string;
  origin?: string;
  eventAbbreviation?: string;
  placement?: number;
  communityName?: string;
  publishDate?: string;
  event?: { name?: string };
  format?: { name?: string };
}

/**
 * Format Library exposes a direct `ydk` string per deck, so no card parsing is
 * needed. Its list endpoint ignores query parameters, so we fetch a batch and
 * filter locally.
 */
export async function searchFormatLibraryDecks(options: {
  query?: string;
  format?: string;
  limit?: number;
}): Promise<CommunityDeck[]> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const listResponse = await httpFetch('https://www.formatlibrary.com/api/decks?limit=100', {
    headers: UA,
    signal: AbortSignal.timeout(25_000)
  });
  if (!listResponse.ok) throw new Error(`Format Library decks returned HTTP ${listResponse.status}`);
  const payload = await listResponse.json();
  const rows = (Array.isArray(payload) ? payload : payload.data || payload.decks || []) as FormatLibraryRow[];

  const needle = options.query?.trim().toLowerCase();
  const formatNeedle = options.format?.trim().toLowerCase();
  const filtered = rows.filter(row => {
    const haystack = `${row.deckTypeName} ${row.builderName || ''} ${row.formatName || ''} ${row.event?.name || ''}`.toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
    if (formatNeedle && !(row.formatName || '').toLowerCase().includes(formatNeedle)) return false;
    return true;
  });

  const decks: CommunityDeck[] = [];
  for (const row of filtered.slice(0, limit)) {
    let deck: DeckData = { main: [], extra: [], side: [] };
    try {
      const detail = await httpFetch(`https://www.formatlibrary.com/api/decks/${row.id}`, {
        headers: UA,
        signal: AbortSignal.timeout(20_000)
      });
      if (detail.ok) {
        const body: any = await detail.json();
        if (typeof body?.ydk === 'string') deck = parseYdk(body.ydk);
      }
    } catch {
      // Keep the deck row even if the ydk fetch fails.
    }

    const toNumbers = (list: DeckData['main']): number[] =>
      list
        .map(entry => (typeof entry === 'number' ? entry : typeof entry === 'string' ? parseInt(entry, 10) : entry.id))
        .filter((id): id is number => Number.isFinite(id) && id > 0);

    const cards = {
      main: toNumbers(deck.main),
      extra: toNumbers(deck.extra),
      side: toNumbers(deck.side)
    };
    decks.push({
      source: 'formatlibrary',
      id: String(row.id),
      name: row.deckTypeName || row.name || 'Untitled deck',
      author: row.builderName,
      url: `https://www.formatlibrary.com/decks/${row.id}`,
      format: row.formatName || row.format?.name,
      submittedAt: row.publishDate,
      counts: { main: cards.main.length, extra: cards.extra.length, side: cards.side.length },
      cards,
      ydke: buildYdke(cards),
      combos: []
    });
  }

  return decks;
}

// ---------------------------------------------------------------------------
// Master Duel Meta counters
// ---------------------------------------------------------------------------

export interface MdmCounterRow {
  _id: string;
  author?: { username?: string };
  deckType?: { _id?: string; name?: string };
  counterCards?: Array<{ card?: { name?: string }; impact?: string }>;
  chokepoints?: Array<{ card?: { name?: string } }>;
  chokepointExplanation?: string;
  explanation?: string;
  upvotes?: number;
}

export interface CounterEntry {
  id: string;
  archetype: string;
  counterCards: Array<{ name: string; impact?: string }>;
  chokepoints: string[];
  explanation?: string;
  chokepointExplanation?: string;
  author?: string;
  upvotes?: number;
  url: string;
}

let counterCache: { at: number; rows: MdmCounterRow[] } | undefined;

async function loadCounters(): Promise<MdmCounterRow[]> {
  if (counterCache && Date.now() - counterCache.at < MDM_DECK_TYPE_CACHE_MS) return counterCache.rows;
  const response = await httpFetch(`${MDM_COUNTERS}?limit=300`, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Master Duel Meta counters returned HTTP ${response.status}`);
  const payload = await response.json();
  const rows = (Array.isArray(payload) ? payload : payload.docs || payload.data || []) as MdmCounterRow[];
  counterCache = { at: Date.now(), rows };
  return rows;
}

export function mapCounter(row: MdmCounterRow, sourceUrl: string): CounterEntry {
  return {
    id: row._id,
    archetype: row.deckType?.name || '',
    counterCards: (row.counterCards || [])
      .map(c => ({ name: c.card?.name || '', impact: c.impact }))
      .filter(c => c.name),
    chokepoints: (row.chokepoints || []).map(c => c.card?.name || '').filter(Boolean),
    explanation: row.explanation ? stripHtml(row.explanation).slice(0, 800) : undefined,
    chokepointExplanation: row.chokepointExplanation ? stripHtml(row.chokepointExplanation).slice(0, 400) : undefined,
    author: row.author?.username,
    upvotes: Array.isArray(row.upvotes) ? row.upvotes.length : (row.upvotes as number | undefined),
    url: `${sourceUrl}#counters`
  };
}

export async function findCounters(options: { archetype?: string; card?: string; limit?: number }): Promise<{
  available: boolean;
  archetype?: string;
  counters: CounterEntry[];
  knownArchetypes?: string[];
  reason?: string;
  corpusSize: number;
  sourceUrl: string;
}> {
  const sourceUrl = 'https://www.masterduelmeta.com/combos-and-counters';
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
  const rows = await loadCounters();
  const knownArchetypes = [...new Set(rows.map(r => r.deckType?.name).filter((n): n is string => Boolean(n)))].sort();

  const mapRow = (row: MdmCounterRow): CounterEntry => mapCounter(row, sourceUrl);

  if (options.archetype) {
    const needle = options.archetype.trim().toLowerCase();
    const exact = rows.filter(r => (r.deckType?.name || '').toLowerCase() === needle);
    const fuzzy = exact.length > 0
      ? exact
      : rows.filter(r => {
          const name = (r.deckType?.name || '').toLowerCase();
          return name.includes(needle) || needle.includes(name);
        });
    return {
      available: fuzzy.length > 0,
      archetype: fuzzy[0]?.deckType?.name,
      counters: fuzzy.slice(0, limit).map(mapRow),
      knownArchetypes: fuzzy.length === 0 ? knownArchetypes.slice(0, 25) : undefined,
      reason: fuzzy.length === 0 ? `No counter entry for "${options.archetype}" in the ${rows.length} newest public counters.` : undefined,
      corpusSize: rows.length,
      sourceUrl
    };
  }

  if (options.card) {
    const needle = options.card.trim().toLowerCase();
    const matching = rows.filter(row =>
      [...(row.counterCards || []), ...(row.chokepoints || [])]
        .some(c => (c.card?.name || '').toLowerCase().includes(needle))
    );
    return {
      available: matching.length > 0,
      counters: matching.slice(0, limit).map(mapRow),
      knownArchetypes: matching.length === 0 ? knownArchetypes.slice(0, 25) : undefined,
      reason: matching.length === 0 ? `No counter entry in the ${rows.length} newest public counters uses "${options.card}".` : undefined,
      corpusSize: rows.length,
      sourceUrl
    };
  }

  return {
    available: false,
    counters: [],
    knownArchetypes: knownArchetypes.slice(0, 25),
    reason: 'Provide an archetype or a card name.',
    corpusSize: rows.length,
    sourceUrl
  };
}
