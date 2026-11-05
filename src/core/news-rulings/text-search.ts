/**
 * Shared retrieval layer for official document corpora (rulebook, tournament
 * policy, penalty guidelines, judge FAQ...).
 *
 * Ranking is BM25 over text chunks, plus two boosts that matter for rules text:
 *   - contiguous multi-word phrase matches ("damage step" ≠ "damage" + "step")
 *   - judge vocabulary expansion ("revive" → "properly Special Summoned")
 *
 * Expansion only rewrites the query. It never injects text into an answer.
 */

export interface SearchableChunk {
  /** Stable id within the corpus. */
  id: string;
  /** Page number as printed/derived from the source document. */
  page?: number;
  /** Section/heading this chunk belongs to. */
  section?: string;
  /** Which document the chunk came from. */
  docId?: string;
  text: string;
}

export interface RankedChunk extends SearchableChunk {
  score: number;
  snippet: string;
}

export interface SearchOptions {
  limit?: number;
  /** Restrict to one document id. */
  docId?: string;
  /** Boost chunks whose section name contains the raw query. */
  sectionBoost?: boolean;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be", "it", "this", "that",
  "with", "as", "at", "by", "from", "can", "you", "your", "if", "not", "but", "when", "which", "what",
  "how", "does", "do", "has", "have", "was", "were", "will", "would", "there", "their", "they", "them"
]);

/**
 * Judge vocabulary → document phrasing.
 * Players say "revive"; the rulebook says "properly Special Summoned".
 */
const QUERY_EXPANSIONS: Record<string, string[]> = {
  revive: ["special", "summoned", "graveyard"],
  revived: ["special", "summoned", "graveyard"],
  reborn: ["special", "summoned", "graveyard"],
  gy: ["graveyard"],
  grave: ["graveyard"],
  graveyard: ["graveyard"],
  mill: ["send", "graveyard"],
  milled: ["sent", "graveyard"],
  pop: ["destroy"],
  popped: ["destroy"],
  banish: ["banished"],
  banished: ["banish", "graveyard"],
  banishment: ["banish"],
  ss: ["special", "summon"],
  ns: ["normal", "summon"],
  hopt: ["once", "per", "turn"],
  sopt: ["once", "per", "turn"],
  floating: ["destroyed", "graveyard"],
  tribute: ["tribute"],
  negate: ["negate"],
  negated: ["negate", "activation", "effect"],
  segoc: ["simultaneous", "chain"],
  summon: ["summon"],
  summoned: ["summoned"],
  token: ["token"],
  counter: ["counter"],
  cost: ["cost"],
  target: ["target"],
  targeting: ["target"],
  chain: ["chain"],
  pendulum: ["pendulum"],
  xyz: ["xyz"],
  synchro: ["synchro"],
  link: ["link"],
  fusion: ["fusion"],
  ritual: ["ritual"],
  penalty: ["penalty", "warning", "disqualification"],
  penalized: ["penalty"],
  cheat: ["cheating", "fraud"],
  cheating: ["cheating"],
  bribe: ["bribery"],
  stall: ["slow", "play", "stalling"],
  stalling: ["stalling", "slow", "play"],
  scoop: ["concession"],
  concede: ["concession"],
  judge: ["judge", "head", "judge"],
  appeal: ["appeal"],
  deckcheck: ["deck", "check"],
  "deck-check": ["deck", "check"],
  proxy: ["proxy"],
  marked: ["marked", "cards"],
  sleeve: ["sleeves"],
  shuffle: ["shuffle"],
  shuffling: ["shuffling"],
  misregister: ["deck", "list", "error"],
  misregistration: ["deck", "list", "error"],
  ot: ["overtime"],
  overtime: ["overtime"],
  scooping: ["concession"],
  loop: ["loop"],
  infinite: ["infinite", "loop"],
  illegal: ["illegal"],
  disconnect: ["disconnect"],
  rematch: ["rematch"],
  intentional: ["intentional", "draw"],
  id: ["intentional", "draw"],
  time: ["time", "limit"],
  slowplay: ["slow", "play"],
  etiquette: ["etiquette", "sportsmanship"],
  unsporting: ["unsporting", "conduct"]
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function tokenizePhrases(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function normalizeForPhrase(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

export function makeSnippet(text: string, terms: string[], maxLength = 420): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();

  const positions: Array<{ at: number; term: string }> = [];
  for (const term of terms) {
    let from = 0;
    while (true) {
      const at = lower.indexOf(term, from);
      if (at === -1) break;
      positions.push({ at, term });
      from = at + term.length;
      if (positions.length > 400) break;
    }
  }

  let bestStart = 0;
  if (positions.length > 0) {
    positions.sort((a, b) => a.at - b.at);
    let bestScore = -1;
    for (const anchor of positions) {
      const start = Math.max(0, anchor.at - Math.floor(maxLength / 3));
      const end = start + maxLength;
      const seen = new Set<string>();
      for (const p of positions) {
        if (p.at >= start && p.at < end) seen.add(p.term);
      }
      if (seen.size > bestScore) {
        bestScore = seen.size;
        bestStart = start;
      }
    }
  }

  const start = Math.max(0, Math.min(bestStart, Math.max(0, flat.length - maxLength)));
  const end = Math.min(flat.length, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return `${prefix}${flat.slice(start, end).trim()}${suffix}`;
}

export interface RankResult {
  hits: RankedChunk[];
  totalMatches: number;
  terms: string[];
}

/**
 * Ranks chunks for a free-text query. Deterministic: same input → same order.
 */
export function rankChunks(query: string, chunks: SearchableChunk[], options: SearchOptions = {}): RankResult {
  const baseTerms = Array.from(new Set(tokenize(query)));
  if (baseTerms.length === 0 || chunks.length === 0) {
    return { hits: [], totalMatches: 0, terms: baseTerms };
  }

  const expansionTerms = new Set<string>();
  for (const term of baseTerms) {
    for (const extra of QUERY_EXPANSIONS[term] || []) {
      if (!baseTerms.includes(extra)) expansionTerms.add(extra);
    }
  }
  const terms = [...baseTerms, ...expansionTerms];
  const weights = new Map<string, number>();
  for (const term of baseTerms) weights.set(term, 1);
  for (const term of expansionTerms) weights.set(term, 0.5);

  const rawTokens = tokenizePhrases(query);
  const windows: string[] = [];
  for (const size of [5, 4, 3]) {
    for (let i = 0; i + size <= rawTokens.length; i++) {
      const win = rawTokens.slice(i, i + size).join(" ");
      if (win.replace(/ /g, "").length >= 8) windows.push(win);
    }
  }

  const pool = options.docId ? chunks.filter((c) => c.docId === options.docId) : chunks;

  const docs = pool.map((c) => {
    const tokens = tokenize(c.text);
    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
    return { chunk: c, freq, length: tokens.length, normalized: normalizeForPhrase(c.text) };
  });

  const avgLength = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const term of terms) {
    df.set(term, docs.reduce((count, d) => count + (d.freq.has(term) ? 1 : 0), 0));
  }

  const k1 = 1.4;
  const b = 0.72;
  const total = docs.length;
  const phrase = query.trim().toLowerCase();

  const scored = docs.map((doc) => {
    let score = 0;
    for (const term of terms) {
      const tf = doc.freq.get(term) || 0;
      if (tf === 0) continue;
      const n = df.get(term) || 0;
      const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
      const weight = weights.get(term) ?? 1;
      score += weight * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.length / Math.max(1, avgLength)))));
    }

    if (score > 0) {
      for (const win of windows) {
        if (doc.normalized.includes(` ${win} `)) {
          const words = win.split(" ").length;
          score += words >= 5 ? 4 : words >= 4 ? 2.5 : 1.5;
        }
      }
      if (options.sectionBoost !== false && doc.chunk.section && doc.chunk.section.toLowerCase().includes(phrase)) {
        score *= 1.35;
      }
      if (phrase.length > 4 && doc.normalized.includes(` ${phrase} `)) score *= 1.6;
    }

    return { chunk: doc.chunk, score };
  });

  const hits = scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score || (a.chunk.page ?? 0) - (b2.chunk.page ?? 0))
    .slice(0, Math.max(1, Math.min(options.limit ?? 5, 40)))
    .map((s) => ({
      ...s.chunk,
      score: Math.round(s.score * 100) / 100,
      snippet: makeSnippet(s.chunk.text, baseTerms)
    }));

  return { hits, totalMatches: scored.filter((s) => s.score > 0).length, terms: baseTerms };
}
