/**
 * Official judge corpus.
 *
 * Ingests the documents a Yu-Gi-Oh! judge is actually expected to know:
 *   - Tournament Policy (KDE-US)
 *   - Tournament Infractions and Penalties Policy (the "penalty guidelines")
 *   - Speed Duel / Remote Duel addenda + Remote Duel best practices
 *   - Fast Effect Timing
 *   - Advanced Rules, 2021 Rules Update
 *   - Konami Judge Program page + Judge Program FAQ
 *
 * Every answer is verbatim from the source, with the document name, version and
 * page/section. Nothing is paraphrased, and nothing is invented when a document
 * cannot be downloaded.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { rankChunks, makeSnippet, type SearchableChunk } from "./text-search.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const CACHE_DIR = path.join(ROOT, "data", "judge");
const FILE_DIR = path.join(CACHE_DIR, "files");
const MANIFEST_PATH = path.join(CACHE_DIR, "manifest.json");
const PARSER_VERSION = 4;
const FRESHNESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Set when a sync attempt could not reach Konami, to back off politely. */
let lastSyncFailureAt = 0;

export const ORGANIZED_PLAY_PAGE = "https://www.yugioh-card.com/en/events/organizedplay/";

export interface DocChunk {
  id: string;
  page?: number;
  section?: string;
  text: string;
}

export interface DocHeading {
  title: string;
  page?: number;
}

export interface DocIndex {
  id: string;
  title: string;
  kind: "pdf" | "html";
  version?: string;
  url: string;
  sourcePage: string;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  sha256: string;
  bytes: number;
  chunkCount: number;
  charCount: number;
  headings: DocHeading[];
  parserVersion: number;
  chunks: DocChunk[];
}

export interface DocStatus {
  id: string;
  title: string;
  kind: "pdf" | "html";
  available: boolean;
  version?: string;
  url?: string;
  fetchedAt?: string;
  ageDays?: number;
  pageCount?: number;
  sections?: number;
  charCount?: number;
  sha256?: string;
  stale?: boolean;
  reason?: string;
}

export interface CorpusStatus {
  available: boolean;
  loaded: boolean;
  totalDocs: number;
  totalChars: number;
  totalChunks: number;
  newestFetch?: string;
  oldestFetch?: string;
  docs: DocStatus[];
  reason?: string;
}

export interface JudgeSearchHit {
  docId: string;
  document: string;
  version?: string;
  page?: number;
  section?: string;
  score: number;
  snippet: string;
}

export interface JudgeSearchResult {
  query: string;
  available: boolean;
  totalMatches: number;
  hits: JudgeSearchHit[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// Document registry
// ---------------------------------------------------------------------------

interface DocDefinition {
  id: string;
  title: string;
  kind: "pdf" | "html";
  /** Exact URL for HTML pages. PDFs are discovered live from the OTS page. */
  url?: string;
  /** Filename pattern used to find the current PDF version. */
  filePattern?: RegExp;
  sourcePage: string;
  note?: string;
}

export const JUDGE_DOCS: DocDefinition[] = [
  {
    id: "tournament-policy",
    title: "Official KDE-US Tournament Policy",
    kind: "pdf",
    filePattern: /Tournament_Policy.*\.pdf$/i,
    sourcePage: ORGANIZED_PLAY_PAGE,
    note: "Tournament rules: procedures, deck checks, time limits, conduct."
  },
  {
    id: "penalties",
    title: "Tournament Infractions and Penalties Policy",
    kind: "pdf",
    filePattern: /Penalty_Guidelines.*\.pdf$/i,
    sourcePage: ORGANIZED_PLAY_PAGE,
    note: "Penalty framework: Warning / Game Loss / Match Loss / DQ."
  },
  {
    id: "speed-duel-addendum",
    title: "Tournament Policy – Speed Duel Addendum",
    kind: "pdf",
    filePattern: /Speed_Duel_Addendum.*\.pdf$/i,
    sourcePage: ORGANIZED_PLAY_PAGE
  },
  {
    id: "remote-duel-addendum",
    title: "Tournament Policy – Remote Duel Addendum",
    kind: "pdf",
    filePattern: /Remote_Duel_Addendum.*\.pdf$/i,
    sourcePage: ORGANIZED_PLAY_PAGE
  },
  {
    id: "remote-duel-guide",
    title: "Remote Duel Best Practice Guide",
    kind: "pdf",
    filePattern: /Remote_Duel_Best_Practice.*\.pdf$/i,
    sourcePage: ORGANIZED_PLAY_PAGE
  },
  {
    id: "fast-effect-timing",
    title: "Fast Effect Timing",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/fast-effect-timing/",
    sourcePage: "https://www.yugioh-card.com/en/play/fast-effect-timing/",
    note: "Who may activate the next fast effect: Box A/B/C, priority, chains."
  },
  {
    id: "advanced-rules",
    title: "Advanced Rules Information",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/advanced-rules/",
    sourcePage: "https://www.yugioh-card.com/en/play/advanced-rules/",
    note: "Hub page that links to Fast Effect Timing and the Card FAQ (both already in the corpus)."
  },
  {
    id: "rules-update-2021",
    title: "2021 Rules Update",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/2021_rules_update/",
    sourcePage: "https://www.yugioh-card.com/en/play/2021_rules_update/"
  },
  {
    id: "card-faq-rivalry-gozen",
    title: "Card FAQ: Rivalry of Warlords & Gozen Match",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/card-faq-1/",
    sourcePage: "https://www.yugioh-card.com/en/play/advanced-rules/",
    note: "Official FAQ for Rivalry of Warlords & Gozen Match."
  },
  {
    id: "psct",
    title: "Problem-Solving Card Text (series index)",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/psct/",
    sourcePage: "https://www.yugioh-card.com/en/play/psct/",
    note: "Index page for the seven official PSCT articles."
  },
  {
    id: "psct-1",
    title: "PSCT Part 1: Reading the Cards of Tomorrow",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/psct/psct-1/",
    sourcePage: "https://www.yugioh-card.com/en/play/psct/"
  },
  {
    id: "psct-2",
    title: "PSCT Part 2: New Words & Phrases",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/psct/psct-2/",
    sourcePage: "https://www.yugioh-card.com/en/play/psct/"
  },
  {
    id: "psct-3",
    title: "PSCT Part 3: Conditions, Activations, and Effects",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/psct/psct-3/",
    sourcePage: "https://www.yugioh-card.com/en/play/psct/",
    note: "Timing, targeting, cost vs effect — the most important article in the series."
  },
  {
    id: "psct-4",
    title: "PSCT Part 4: The Clues on Your Cards",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/psct/psct-4/",
    sourcePage: "https://www.yugioh-card.com/en/play/psct/"
  },
  {
    id: "psct-5",
    title: "PSCT Part 5: Special Summons",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/psct/psct-5/",
    sourcePage: "https://www.yugioh-card.com/en/play/psct/"
  },
  {
    id: "psct-6",
    title: "PSCT Part 6: Finding Clues in TU6 & GENF",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/psct/psct-6/",
    sourcePage: "https://www.yugioh-card.com/en/play/psct/"
  },
  {
    id: "psct-7",
    title: "PSCT Part 7: 2012 Update – Conjunction Functions",
    kind: "html",
    url: "https://www.yugioh-card.com/en/play/psct/psct-7/",
    sourcePage: "https://www.yugioh-card.com/en/play/psct/",
    note: "'and if you do', 'also', 'then' — the decisive distinction when ruling."
  },
  {
    id: "judge-program",
    title: "KONAMI Judge Program",
    kind: "html",
    url: "https://www.yugioh-card.com/en/judges/",
    sourcePage: "https://www.yugioh-card.com/en/judges/",
    note: "Judge program: levels, testing, authority."
  },
  {
    id: "judge-faq",
    title: "KONAMI Judge Program FAQ",
    kind: "html",
    url: "https://www.yugioh-card.com/en/judges/judge-faq/",
    sourcePage: "https://www.yugioh-card.com/en/judges/judge-faq/",
    note: "Official Q&A on judge roles and responsibilities."
  },
  {
    id: "eu-tournament-policy",
    title: "KDE-EU Tournament Policy",
    kind: "pdf",
    url: "https://www.yugioh-card.com/eu/wp-content/uploads/2025/09/Official-KDE-E-Yu-Gi-Oh-TRADING-CARD-GAME-Tournament-Policy-Version-2.5.pdf",
    sourcePage: "https://www.yugioh-card.com/eu/play/policy-documents/",
    note: "Europe/Middle East/Africa/Oceania region policy."
  },
  {
    id: "eu-penalties",
    title: "KDE-EU Tournament Infractions and Penalties Policy",
    kind: "pdf",
    url: "https://www.yugioh-card.com/eu/wp-content/uploads/2025/09/Official-KDE-E-Tournament-Infractions-and-Penalties-Policy-Ver-2.3.pdf",
    sourcePage: "https://www.yugioh-card.com/eu/play/policy-documents/",
    note: "Europe/Middle East/Africa/Oceania region penalties."
  },
  {
    id: "eu-speed-duel-addendum",
    title: "KDE-EU Tournament Policy – Speed Duel Addendum",
    kind: "pdf",
    url: "https://www.yugioh-card.com/eu/wp-content/uploads/2022/07/Official-KDE-E-Yu-Gi-Oh-TRADING-CARD-GAME-Tournament-Policy-Speed-Duel-Addendum.pdf",
    sourcePage: "https://www.yugioh-card.com/eu/play/policy-documents/"
  },
  {
    id: "eu-remote-duel-addendum",
    title: "KDE-EU Tournament Policy – Remote Duel Addendum",
    kind: "pdf",
    url: "https://www.yugioh-card.com/eu/wp-content/uploads/2022/07/Official-KDE-E-Yu-Gi-Oh-TRADING-CARD-GAME-Tournament-Policy-Remote-Duel-Addendum.pdf",
    sourcePage: "https://www.yugioh-card.com/eu/play/policy-documents/"
  },
  {
    id: "eu-covid-addendum",
    title: "KDE-EU Tournament Policy – COVID-19 Addendum",
    kind: "pdf",
    url: "https://www.yugioh-card.com/eu/wp-content/uploads/2022/07/Official-KDEE-Yu-Gi-Oh-TRADING-CARD-GAME-Tournament-Policy-COVID-19-Addendum.pdf",
    sourcePage: "https://www.yugioh-card.com/eu/play/policy-documents/"
  }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UA = { "User-Agent": "yugioh-assistant-mcp/1.1 (+judge corpus sync)" };

function ensureDirs(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(FILE_DIR, { recursive: true });
}

function docPath(id: string): string {
  return path.join(CACHE_DIR, `${id}.json`);
}

export function loadDoc(id: string): DocIndex | null {
  try {
    const file = docPath(id);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed?.chunks?.length) return null;
    return parsed as DocIndex;
  } catch {
    return null;
  }
}

/**
 * Registry ids plus anything already on disk. Documents discovered at runtime
 * (for example a new PSCT article) stay visible without a code change.
 */
function allDocIds(): string[] {
  const ids = new Set(JUDGE_DOCS.map((d) => d.id));
  try {
    for (const file of fs.readdirSync(CACHE_DIR)) {
      if (!file.endsWith(".json")) continue;
      if (file === "manifest.json") continue;
      ids.add(file.slice(0, -5));
    }
  } catch {
    // Cache dir missing: registry only.
  }
  return Array.from(ids);
}

function saveDoc(index: DocIndex): void {
  ensureDirs();
  fs.writeFileSync(docPath(index.id), JSON.stringify(index), "utf-8");
}

function ageDays(iso?: string): number | undefined {
  if (!iso) return undefined;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return undefined;
  return Math.max(0, Math.round((ms / 86_400_000) * 10) / 10);
}

function detectVersion(text: string): string | undefined {
  const patterns = [/v(?:ersion)?[\s._-]*(\d+(?:[._]\d+)+)/i, /ver[\s._-]*(\d+(?:[._]\d+)+)/i];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].replace(/_/g, ".");
  }
  return undefined;
}

function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—",
    hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™",
    eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", uuml: "ü", ouml: "ö", auml: "ä"
  };
  return input
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

// ---------------------------------------------------------------------------
// HTML extraction
// ---------------------------------------------------------------------------

/**
 * Pulls the article body out of a Konami page and turns headings/paragraphs
 * into chunks. The site chrome (nav, footer, cookie bar) is discarded so it
 * never pollutes search results.
 */
export function extractHtmlChunks(html: string): { chunks: DocChunk[]; headings: DocHeading[] } {
  let body = html;

  const startMatch = body.match(/<div[^>]+class="[^"]*entry-content[^"]*"[^>]*>/i);
  if (startMatch && startMatch.index !== undefined) {
    body = body.slice(startMatch.index + startMatch[0].length);
    const end = body.search(/<\/article>|<footer|id="comments"/i);
    if (end > 0) body = body.slice(0, end);
  } else {
    const main = body.match(/<main[\s\S]*?<\/main>/i) || body.match(/<article[\s\S]*?<\/article>/i);
    if (main) body = main[0];
  }

  // Keep same-site links: hub pages ("Advanced Game Mechanics") are pure
  // directories, and the link targets are the actual answer.
  const related: Array<{ text: string; href: string }> = [];
  for (const m of body.matchAll(/<a[^>]+href="([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    if (!href.startsWith("/en/") && !href.startsWith("https://www.yugioh-card.com/en/")) continue;
    if (/\/feed\/?$/.test(href)) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text.length < 4 || text.length > 140) continue;
    if (related.some((r) => r.href === href)) continue;
    related.push({ text, href: href.startsWith("/") ? `https://www.yugioh-card.com${href}` : href });
  }

  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|aside|form|iframe)[\s\S]*?<\/\1>/gi, " ");

  const chunks: DocChunk[] = [];
  const headings: DocHeading[] = [];
  let currentSection = "Introduction";
  let buffer: string[] = [];
  let counter = 0;

  const flush = () => {
    const text = buffer.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    buffer = [];
    if (text.length < 40) return;

    // Long article pages have no headings; split them into readable chunks so
    // ranking stays sharp and snippets stay focused.
    let remainder = text;
    while (remainder.length > 1800) {
      let cut = remainder.lastIndexOf("\n", 1800);
      if (cut < 900) cut = remainder.lastIndexOf(". ", 1800);
      if (cut < 900) cut = 1800;
      else cut += 1;
      chunks.push({ id: `s${++counter}`, section: currentSection, text: remainder.slice(0, cut).trim() });
      remainder = remainder.slice(cut).trim();
    }
    if (remainder.length >= 40) {
      chunks.push({ id: `s${++counter}`, section: currentSection, text: remainder });
    }
  };

  const tokens = body.split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<p[^>]*>[\s\S]*?<\/p>|<li[^>]*>[\s\S]*?<\/li>|<br\s*\/?>)/i);
  for (const token of tokens) {
    const headingMatch = token.match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h\1>$/i);
    if (headingMatch) {
      flush();
      const title = decodeEntities(headingMatch[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (title) {
        currentSection = title;
        headings.push({ title });
      }
      continue;
    }

    // Konami uses styled paragraphs as section titles on some pages.
    const styledTitle = token.match(/^<p[^>]*class="[^"]*(?:titlebox|grey_title|section-title)[^"]*"[^>]*>([\s\S]*?)<\/p>$/i);
    if (styledTitle) {
      flush();
      const title = decodeEntities(styledTitle[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (title) {
        currentSection = title;
        headings.push({ title });
      }
      continue;
    }

    if (/^<li/i.test(token)) {
      buffer.push(`• ${decodeEntities(token.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()}`);
      continue;
    }
    if (/^<br/i.test(token)) {
      buffer.push("");
      continue;
    }
    const text = decodeEntities(token.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) buffer.push(text);
  }
  flush();

  if (related.length > 0) {
    const lines = related.slice(0, 30).map((r) => `• ${r.text} → ${r.href}`);
    chunks.push({
      id: `s${++counter}`,
      section: "Related pages",
      text: `Related pages referenced by this article:\n${lines.join("\n")}`
    });
    headings.push({ title: "Related pages" });
  }

  return { chunks, headings };
}

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform: number[];
}

function linesFromItems(items: PdfTextItem[]): string[] {
  let raw = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    raw += item.str;
    if (item.hasEOL) raw += "\n";
  }
  const out: string[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/[ \t]+/g, " ").trim();
    if (!line) continue;
    if (out.length && out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out;
}

function headingPattern(line: string): boolean {
  if (line.length < 3 || line.length > 95) return false;
  if (/^(l|•|\*)\s/.test(line)) return false;
  if (/^[IVXLC]+\.\s+[A-Z]/.test(line)) return true;
  if (/^[A-Z]\.\s+[A-Z]/.test(line)) return true;
  if (/^\d+(\.\d+)*\.?\s+[A-Z][A-Za-z]/.test(line)) return true;
  if (/^[A-Z][A-Z0-9 &'’/()\-–,]{6,80}$/.test(line)) return true;
  return false;
}

/**
 * Extracts per-page text. Handles both portrait single-page PDFs (policy
 * documents) and landscape two-page spreads (rulebook-style booklets).
 * Running headers/footers repeated on most pages are stripped.
 */
export async function extractPdfChunks(pdfBytes: Uint8Array): Promise<{
  chunks: DocChunk[];
  headings: DocHeading[];
  title: string;
  version?: string;
}> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true
  }).promise;

  const rawPages: Array<{ page: number; lines: string[] }> = [];
  let title = "";

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const pdfPage = await doc.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const content = await pdfPage.getTextContent();
    const items = (content.items as PdfTextItem[]).filter((i) => typeof i.str === "string");
    if (!items.length) continue;

    if (pageNumber === 1) {
      title = items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim().slice(0, 160);
    }

    const isSpread = viewport.width > viewport.height;
    if (!isSpread) {
      rawPages.push({ page: pageNumber, lines: linesFromItems(items) });
      continue;
    }

    // Rulebook-style booklet: one sheet = two printed pages.
    const midpoint = viewport.width / 2;
    const halves = [
      items.filter((i) => i.transform[4] < midpoint),
      items.filter((i) => i.transform[4] >= midpoint)
    ];
    const readFooter = (subset: PdfTextItem[]): number | null => {
      for (const item of subset) {
        if (item.transform[5] > 20) continue;
        const digits = item.str.trim();
        if (/^\d{1,3}$/.test(digits)) return Number(digits);
      }
      return null;
    };
    const fallback = 2 * pageNumber - 6;
    const numbers = [readFooter(halves[0]) ?? fallback, readFooter(halves[1]) ?? fallback + 1];
    halves.forEach((half, i) => {
      const lines = linesFromItems(half);
      if (lines.join("").length > 40 && numbers[i] >= 1) {
        rawPages.push({ page: numbers[i], lines });
      }
    });
  }

  // Strip running headers/footers: lines repeated on most pages.
  const frequency = new Map<string, number>();
  for (const p of rawPages) {
    for (const line of new Set(p.lines)) {
      if (line.length > 120) continue;
      frequency.set(line, (frequency.get(line) || 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.floor(rawPages.length * 0.5));

  const chunks: DocChunk[] = [];
  const headings: DocHeading[] = [];

  for (const p of rawPages) {
    const kept: string[] = [];
    for (const line of p.lines) {
      const repeated = (frequency.get(line) || 0) >= threshold;
      const isPageNumber = /^\d{1,3}$/.test(line) && Number(line) === p.page;
      if (repeated || isPageNumber) continue;
      kept.push(line);
      if (headingPattern(line)) headings.push({ title: line.replace(/\s+/g, " ").trim(), page: p.page });
    }
    const text = kept.join("\n").trim();
    if (text.length < 30) continue;
    chunks.push({ id: `p${p.page}`, page: p.page, text });
  }

  const version = detectVersion(title);
  return { chunks, headings, title, version };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

async function fetchPdfUrls(): Promise<string[]> {
  const resp = await fetch(ORGANIZED_PLAY_PAGE, { headers: UA, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`Could not fetch the Organized Play page (HTTP ${resp.status}).`);
  const html = await resp.text();
  return [...new Set([...html.matchAll(/https?:\/\/[^"'\s<>]+?\.pdf/gi)].map((m) => m[0]))];
}

/**
 * The PSCT hub lists every article in the series. New parts published by Konami
 * are picked up automatically instead of waiting for a code change.
 */
async function discoverPsctDefinitions(): Promise<DocDefinition[]> {
  try {
    const resp = await fetch("https://www.yugioh-card.com/en/play/psct/", {
      headers: UA,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const known = new Set(JUDGE_DOCS.map((d) => d.id));
    const found: DocDefinition[] = [];
    for (const m of html.matchAll(/href="(\/en\/play\/psct\/(psct-\d+)\/?)"/gi)) {
      const id = m[2].toLowerCase();
      if (known.has(id)) continue;
      const url = `https://www.yugioh-card.com${m[1].startsWith("/") ? m[1] : `/${m[1]}`}`;
      const titleMatch = html.slice(Math.max(0, m.index - 400), m.index).match(/>([^<>]{10,120})<\/a>\s*$/);
      found.push({
        id,
        title: titleMatch ? decodeEntities(titleMatch[1]).trim() : `PSCT ${id}`,
        kind: "html",
        url,
        sourcePage: "https://www.yugioh-card.com/en/play/psct/",
        note: "Auto-discovered from the PSCT index page."
      });
    }
    return found;
  } catch {
    return [];
  }
}

export async function syncJudgeCorpus(options: { force?: boolean; only?: string[] } = {}): Promise<{
  available: boolean;
  synced: number;
  skipped: number;
  changed: string[];
  docs: DocStatus[];
  reason?: string;
}> {
  ensureDirs();
  const changed: string[] = [];
  const docs: DocStatus[] = [];
  let synced = 0;
  let skipped = 0;
  const reasons: string[] = [];
  // One page fetch per sync run, reused by every PDF lookup.
  let pdfUrlsPromise: Promise<string[]> | null = null;
  const discover = async (pattern: RegExp): Promise<string | null> => {
    if (!pdfUrlsPromise) pdfUrlsPromise = fetchPdfUrls();
    const urls = await pdfUrlsPromise;
    return urls.find((u) => pattern.test(u)) || null;
  };

  const discoveredDocs = options.only ? [] : await discoverPsctDefinitions();
  const definitions: DocDefinition[] = [...JUDGE_DOCS, ...discoveredDocs];

  for (const def of definitions) {
    if (options.only && !options.only.includes(def.id)) {
      const existing = loadDoc(def.id);
      if (existing) docs.push(statusFor(existing));
      continue;
    }

    const cached = loadDoc(def.id);
    const cacheAge = ageDays(cached?.fetchedAt);
    const fresh = cacheAge !== undefined && cacheAge * 86_400_000 < FRESHNESS_TTL_MS;
    const sameParser = cached?.parserVersion === PARSER_VERSION;

    if (!options.force && cached && fresh && sameParser) {
      docs.push(statusFor(cached));
      skipped++;
      continue;
    }

    try {
      let url: string;
      if (def.kind === "pdf") {
        const discovered = def.url || await discover(def.filePattern as RegExp);
        if (!discovered) throw new Error("No current PDF was found on the Organized Play page.");
        url = discovered;
      } else {
        url = def.url as string;
      }

      const headers: Record<string, string> = { ...UA };
      if (cached && sameParser) {
        if (cached.etag) headers["If-None-Match"] = cached.etag;
        if (cached.lastModified) headers["If-Modified-Since"] = cached.lastModified;
      }

      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(90_000) });

      if (resp.status === 304 && cached) {
        docs.push(statusFor({ ...cached, fetchedAt: new Date().toISOString() }));
        saveDoc({ ...cached, fetchedAt: new Date().toISOString() });
        skipped++;
        continue;
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status} while fetching ${url}`);

      const bytes = new Uint8Array(await resp.arrayBuffer());
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

      if (cached && cached.sha256 === sha256 && sameParser) {
        const refreshed = {
          ...cached,
          fetchedAt: new Date().toISOString(),
          url,
          etag: resp.headers.get("etag") || cached.etag,
          lastModified: resp.headers.get("last-modified") || cached.lastModified
        };
        saveDoc(refreshed);
        docs.push(statusFor(refreshed));
        skipped++;
        continue;
      }

      let extracted: { chunks: DocChunk[]; headings: DocHeading[]; title?: string; version?: string };
      if (def.kind === "pdf") {
        const fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() || `${def.id}.pdf`);
        fs.writeFileSync(path.join(FILE_DIR, fileName), Buffer.from(bytes));
        extracted = await extractPdfChunks(new Uint8Array(bytes));
      } else {
        const html = Buffer.from(bytes).toString("utf-8");
        extracted = extractHtmlChunks(html);
      }

      if (extracted.chunks.length === 0) {
        throw new Error("Could not extract text (the PDF may be an image scan).");
      }

      const charCount = extracted.chunks.reduce((sum, c) => sum + c.text.length, 0);
      const index: DocIndex = {
        id: def.id,
        title: extracted.title && def.kind === "pdf" ? `${def.title}` : def.title,
        kind: def.kind,
        version: extracted.version || detectVersion(url),
        url,
        sourcePage: def.sourcePage,
        fetchedAt: new Date().toISOString(),
        etag: resp.headers.get("etag") || undefined,
        lastModified: resp.headers.get("last-modified") || undefined,
        sha256,
        bytes: bytes.byteLength,
        chunkCount: extracted.chunks.length,
        charCount,
        headings: extracted.headings.slice(0, 400),
        parserVersion: PARSER_VERSION,
        chunks: extracted.chunks
      };

      saveDoc(index);
      docs.push(statusFor(index));
      changed.push(def.id);
      synced++;
    } catch (error) {
      const reason = `${def.title}: ${(error as Error).message}`;
      reasons.push(reason);
      if (cached) {
        docs.push(statusFor(cached));
        continue;
      }
      docs.push({
        id: def.id,
        title: def.title,
        kind: def.kind,
        available: false,
        reason
      });
    }
  }

  const available = docs.some((d) => d.available);
  return {
    available,
    synced,
    skipped,
    changed,
    docs,
    reason: reasons.length ? reasons.join(" | ") : undefined
  };
}

function statusFor(index: DocIndex): DocStatus {
  const days = ageDays(index.fetchedAt);
  return {
    id: index.id,
    title: index.title,
    kind: index.kind,
    available: true,
    version: index.version,
    url: index.url,
    fetchedAt: index.fetchedAt,
    ageDays: days,
    pageCount: index.kind === "pdf" ? index.chunks.filter((c) => typeof c.page === "number").length : undefined,
    sections: index.headings.length,
    charCount: index.charCount,
    sha256: index.sha256,
    stale: days !== undefined ? days * 86_400_000 > FRESHNESS_TTL_MS : true
  };
}

export function getJudgeCorpusStatus(): CorpusStatus {
  const docs: DocStatus[] = [];
  let totalChars = 0;
  let totalChunks = 0;

  for (const id of allDocIds()) {
    const def = JUDGE_DOCS.find((d) => d.id === id);
    const index = loadDoc(id);
    if (!index) {
      if (def) docs.push({ id, title: def.title, kind: def.kind, available: false, reason: "Not synced." });
      continue;
    }
    docs.push(statusFor(index));
    totalChars += index.charCount;
    totalChunks += index.chunkCount;
  }

  const loaded = docs.filter((d) => d.available);
  const fetches = loaded.map((d) => d.fetchedAt as string).sort();

  return {
    available: loaded.length > 0,
    loaded: loaded.length === docs.length,
    totalDocs: loaded.length,
    totalChars,
    totalChunks,
    newestFetch: fetches[fetches.length - 1],
    oldestFetch: fetches[0],
    docs,
    reason: loaded.length === 0 ? "No judge documents have been synced yet." : undefined
  };
}

export async function ensureJudgeCorpus(options: { refresh?: boolean } = {}): Promise<CorpusStatus> {
  const status = getJudgeCorpusStatus();
  const missing = status.docs.some((d) => !d.available);
  const anyStale = status.docs.some((d) => d.available && d.stale);
  if (!missing && !anyStale && !options.refresh) return status;

  // Do not hammer Konami when the network is down: back off for 5 minutes.
  if (!options.refresh && lastSyncFailureAt && Date.now() - lastSyncFailureAt < 5 * 60 * 1000) {
    return status;
  }

  const result = await syncJudgeCorpus({ force: options.refresh });
  if (result.available && result.synced === 0 && result.docs.every((d) => d.available)) {
    lastSyncFailureAt = 0;
  } else if (!result.available) {
    lastSyncFailureAt = Date.now();
  }
  return getJudgeCorpusStatus();
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function listJudgeDocuments(): Array<{
  id: string;
  title: string;
  kind: string;
  available: boolean;
  version?: string;
  chars?: number;
  pages?: number;
  sections?: number;
  note?: string;
}> {
  return allDocIds().map((id) => {
    const def = JUDGE_DOCS.find((d) => d.id === id);
    const index = loadDoc(id);
    return {
      id,
      title: index?.title ?? def?.title ?? id,
      kind: index?.kind ?? def?.kind ?? "html",
      available: Boolean(index),
      version: index?.version,
      chars: index?.charCount,
      pages: index?.kind === "pdf" ? index.chunks.filter((c) => typeof c.page === "number").length : undefined,
      sections: index?.headings.length,
      note: def?.note
    };
  });
}

function chunkPool(docId?: string): SearchableChunk[] {
  const ids = docId ? [docId] : allDocIds();
  const pool: SearchableChunk[] = [];
  for (const id of ids) {
    const index = loadDoc(id);
    if (!index) continue;
    for (const chunk of index.chunks) {
      pool.push({
        id: `${id}:${chunk.id}`,
        docId: id,
        page: chunk.page,
        section: chunk.section,
        text: chunk.text
      });
    }
  }
  return pool;
}

export function searchJudgeDocs(
  query: string,
  options: { document?: string; limit?: number } = {}
): JudgeSearchResult {
  const pool = chunkPool(options.document);
  if (pool.length === 0) {
    return {
      query,
      available: false,
      totalMatches: 0,
      hits: [],
      reason: options.document
        ? `Document "${options.document}" is not synced yet.`
        : "No judge documents are synced. Run a sync first."
    };
  }

  const ranked = rankChunks(query, pool, { limit: options.limit ?? 5 });

  return {
    query,
    available: true,
    totalMatches: ranked.totalMatches,
    hits: ranked.hits.map((hit) => {
      const index = loadDoc(hit.docId as string);
      return {
        docId: hit.docId as string,
        document: index?.title ?? (hit.docId as string),
        version: index?.version,
        page: hit.page,
        section: hit.section,
        score: hit.score,
        snippet: hit.snippet
      };
    })
  };
}

export function getJudgeDocPage(docId: string, page: number): {
  available: boolean;
  document?: string;
  version?: string;
  page?: number;
  text?: string;
  reason?: string;
} {
  const index = loadDoc(docId);
  if (!index) return { available: false, reason: `Document "${docId}" is not synced yet.` };

  if (index.kind === "html") {
    return {
      available: false,
      reason: `"${index.title}" is a web page with no page numbers. Use section instead of page.`
    };
  }

  const chunk = index.chunks.find((c) => c.page === page);
  if (!chunk) {
    const pages = index.chunks.filter((c) => typeof c.page === "number").map((c) => c.page as number);
    const max = pages.length ? Math.max(...pages) : 0;
    return { available: false, reason: `No page ${page}. The document has ${max} pages.` };
  }
  return { available: true, document: index.title, version: index.version, page, text: chunk.text };
}

export function getJudgeDocSection(docId: string, title: string): {
  available: boolean;
  document?: string;
  version?: string;
  section?: string;
  text?: string;
  reason?: string;
  suggestions?: string[];
} {
  const index = loadDoc(docId);
  if (!index) return { available: false, reason: `Document "${docId}" is not synced yet.` };

  const needle = title.trim().toLowerCase();

  if (index.kind === "html") {
    const match = index.chunks.find((c) => (c.section || "").toLowerCase().includes(needle))
      || index.chunks.find((c) => c.text.toLowerCase().includes(needle));
    if (!match) {
      return {
        available: false,
        reason: `No section "${title}" in "${index.title}".`,
        suggestions: index.headings.slice(0, 25).map((h) => h.title)
      };
    }
    return {
      available: true,
      document: index.title,
      section: match.section,
      text: match.text
    };
  }

  const headings = index.headings;
  const exact = headings.find((h) => h.title.toLowerCase() === needle);
  const partial = exact
    || headings.find((h) => h.title.toLowerCase().includes(needle))
    || headings.find((h) => needle.includes(h.title.toLowerCase()));

  if (!partial || typeof partial.page !== "number") {
    return {
      available: false,
      reason: `Section "${title}" was not found in "${index.title}".`,
      suggestions: headings.slice(0, 40).map((h) => `${h.title} (p.${h.page})`)
    };
  }

  const startIndex = headings.indexOf(partial);
  const next = headings[startIndex + 1];
  const startPage = partial.page;
  const endPage = next && typeof next.page === "number" && next.page >= startPage ? next.page : startPage + 3;

  const pages = index.chunks
    .filter((c) => typeof c.page === "number" && c.page >= startPage && c.page <= endPage)
    .sort((a, b) => (a.page as number) - (b.page as number));

  const rendered = pages.map((c, i) => {
    let body = c.text;
    // The heading is usually mid-page: drop everything before it.
    if (i === 0) {
      const at = body.indexOf(partial.title);
      if (at > 0) body = body.slice(at);
    }
    // And stop at the next heading when it shares the last page.
    if (next && c.page === next.page) {
      const at = body.indexOf(next.title);
      if (at > 0) body = body.slice(0, at);
    }
    return `--- page ${c.page} ---\n${body.trim()}`;
  });

  const text = rendered.join("\n\n");

  return {
    available: true,
    document: index.title,
    version: index.version,
    section: partial.title,
    text
  };
}

/** Compact citation string used by the tools. */
export function citationFor(docId: string, page?: number, section?: string): string {
  const index = loadDoc(docId);
  const title = index?.title ?? docId;
  const version = index?.version ? ` v${index.version}` : "";
  const where = page ? `, p.${page}` : section ? `, ${section}` : "";
  return `${title}${version}${where}`;
}

export { makeSnippet };
