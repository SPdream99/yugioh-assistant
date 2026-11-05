/**
 * Official Konami Rulebook ingestion.
 *
 * Source of truth: https://www.yugioh-card.com/en/rulebook/
 * The landing page links the current PDF (e.g. SD_RuleBook_EN_10.pdf).
 *
 * Pipeline:
 *   1. Discover the live PDF URL from the official landing page.
 *   2. Download it (ETag / Last-Modified aware) into data/rulebook/.
 *   3. Extract verbatim text per printed page with pdfjs-dist.
 *   4. Parse the official Table of Contents into sections.
 *   5. Persist a searchable JSON index, then answer queries with real citations.
 *
 * Nothing here is invented: if the PDF cannot be read, the module reports
 * `available: false` instead of returning made-up rule text.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { rankChunks, type SearchableChunk } from "./text-search.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");

export const RULEBOOK_LANDING_PAGE = "https://www.yugioh-card.com/en/rulebook/";
const CACHE_DIR = path.join(ROOT, "data", "rulebook");
const MANIFEST_PATH = path.join(CACHE_DIR, "manifest.json");
const INDEX_PATH = path.join(CACHE_DIR, "index.json");
const FRESHNESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 25_000;
const PARSER_VERSION = 5;

export interface RulebookPage {
  /** Printed page number as shown in the book. */
  page: number;
  /** 1-based PDF spread page that contains it. */
  spread: number;
  text: string;
}

export interface RulebookSection {
  title: string;
  startPage: number;
  endPage: number;
}

export interface RulebookManifest {
  title: string;
  version: string;
  sourceUrl: string;
  sourcePage: string;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  sha256: string;
  pdfBytes: number;
  pageCount: number;
  charCount: number;
  sections: RulebookSection[];
  /** Bumped whenever the extractor changes, forcing a re-index of the cached PDF. */
  parserVersion: number;
}

export interface RulebookIndex extends RulebookManifest {
  pages: RulebookPage[];
}

export interface RulebookStatus {
  available: boolean;
  loaded: boolean;
  stale: boolean;
  title?: string;
  version?: string;
  sourceUrl?: string;
  sourcePage: string;
  fetchedAt?: string;
  ageDays?: number;
  pageCount?: number;
  charCount?: number;
  sections?: number;
  sha256?: string;
  reason?: string;
}

export interface RulebookHit {
  page: number;
  section: string;
  score: number;
  snippet: string;
}

export interface RulebookSearchResult {
  query: string;
  available: boolean;
  totalMatches: number;
  hits: RulebookHit[];
  reason?: string;
}

export interface RulebookSyncResult {
  available: boolean;
  changed: boolean;
  manifest?: RulebookManifest;
  reason?: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function httpText(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "yugioh-assistant-mcp/1.1 (+rulebook sync)" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} while fetching ${url}`);
  return await resp.text();
}

/**
 * Finds the current official rulebook PDF from the Konami landing page.
 * The main rulebook (SD_RuleBook_EN_*.pdf) is preferred over the beginner's
 * guide and the Speed Duel guide.
 */
export async function discoverRulebookPdf(): Promise<{ url: string; candidates: string[] }> {
  const html = await httpText(RULEBOOK_LANDING_PAGE);
  const found = new Set<string>();
  const re = /https?:\/\/[^"'\s<>]+?\.pdf/gi;
  for (const match of html.match(re) || []) found.add(match);

  const candidates = Array.from(found).filter((u) => /rulebook|\/downloads\//i.test(u));
  const core = candidates.find((u) => /SD_RuleBook_EN_\d+\.pdf/i.test(u))
    || candidates.find((u) => /rulebook.*\.pdf/i.test(u) && !/speed|beginner|bg_/i.test(u))
    || candidates[0];

  if (!core) {
    throw new Error("Could not find the rulebook PDF link on Konami's official page.");
  }
  return { url: core, candidates };
}

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform: number[];
}

function collapseDuplicateLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length < 8 || trimmed.length % 2 !== 0) return trimmed;
  const half = trimmed.slice(0, trimmed.length / 2);
  if (half === trimmed.slice(trimmed.length / 2)) return half.trim();
  return trimmed;
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
    const line = collapseDuplicateLine(rawLine.replace(/[ \t]+/g, " "));
    if (!line) continue;
    if (out.length && out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out;
}

/**
 * Some sheets (cover, back cover) are a single full-width page instead of a
 * two-page spread. Mirrored artwork text is also drawn twice there, so short
 * pages get their verbatim duplicates collapsed.
 */
function cleanPageText(lines: string[]): string {
  const deduped = lines.length <= 24 ? Array.from(new Set(lines)) : lines;
  return deduped.join("\n").trim();
}

/**
 * The printed page number sits in the bottom gutter and is sometimes emitted on
 * the same baseline as the last body line ("SPELL SPEED44"). Strip it only when
 * it is glued to a word and matches this page's own number.
 */
function stripRunningPageNumber(text: string, pageNumber: number): string {
  if (pageNumber < 1) return text;
  return text
    .split("\n")
    .map((line) => {
      const glued = new RegExp(`^(.*[A-Za-z’)\\].])\\s?${pageNumber}$`);
      const match = line.match(glued);
      return match ? match[1] : line;
    })
    .join("\n")
    .trim();
}

/**
 * Extracts verbatim text per printed page.
 *
 * Every PDF sheet is a two-page spread (476 x 326 pt). The printed page number
 * sits in the bottom-left / bottom-right gutter; when present it is used as the
 * citation number, otherwise the number is derived from the spread index.
 */
async function extractPages(pdfBytes: Uint8Array): Promise<{ pages: RulebookPage[]; title: string; version: string; frontMatter: string }> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: pdfBytes,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true
  }).promise;

  const pages: RulebookPage[] = [];
  let title = "";
  let version = "";
  const frontMatterLines: string[] = [];

  for (let spread = 1; spread <= doc.numPages; spread++) {
    const pdfPage = await doc.getPage(spread);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const midpoint = viewport.width / 2;
    const content = await pdfPage.getTextContent();

    const items = (content.items as PdfTextItem[]).filter((i) => typeof i.str === "string");

    if (spread === 1) {
      const first = items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      title = first.slice(0, 120);
      const v = first.match(/Version\s*(\d+(?:\.\d+)?)/i);
      if (v) version = v[1];
    }

    const leftItems = items.filter((i) => i.transform[4] < midpoint);
    const rightItems = items.filter((i) => i.transform[4] >= midpoint);

    // Footer page numbers live in the bottom 20pt of each half.
    const readFooter = (subset: PdfTextItem[]): number | null => {
      for (const item of subset) {
        if (item.transform[5] > 20) continue;
        const digits = item.str.trim();
        if (/^\d{1,3}$/.test(digits)) return Number(digits);
      }
      return null;
    };

    const fallbackLeft = 2 * spread - 6;
    const leftNumber = readFooter(leftItems) ?? fallbackLeft;
    const rightNumber = readFooter(rightItems) ?? fallbackLeft + 1;

    const leftLines = linesFromItems(leftItems).filter((l) => !/^\d{1,3}$/.test(l) || l.length > 3);
    const rightLines = linesFromItems(rightItems).filter((l) => !/^\d{1,3}$/.test(l) || l.length > 3);
    let leftText = cleanPageText(leftLines);
    let rightText = cleanPageText(rightLines);
    let leftPageNumber = leftNumber;
    let rightPageNumber = rightNumber;

    // Full-width sheets (cover / back cover) must not be split into a phantom page.
    if (leftText.length < 60 && rightText.length > 200) {
      rightText = `${rightText}\n${leftText}`.trim();
      leftText = "";
    } else if (rightText.length < 60 && leftText.length > 200) {
      leftText = `${leftText}\n${rightText}`.trim();
      rightText = "";
      if (leftPageNumber < 1 && rightPageNumber >= 1) leftPageNumber = rightPageNumber;
    }

    if (spread <= 3) {
      // Keep the unsplit stream order here: TOC lines can straddle the gutter,
      // and splitting them would tear the dotted leader away from the page number.
      frontMatterLines.push(...linesFromItems(items));
    }

    // Front matter uses roman numerals; only numbered printed pages are citable.
    if (leftText.length >= 40 && leftPageNumber >= 1) {
      pages.push({ page: leftPageNumber, spread, text: stripRunningPageNumber(leftText, leftPageNumber) });
    }
    if (rightText.length >= 40 && rightPageNumber >= 1) {
      pages.push({ page: rightPageNumber, spread, text: stripRunningPageNumber(rightText, rightPageNumber) });
    }
  }

  pages.sort((a, b) => a.page - b.page || a.spread - b.spread);
  return { pages, title, version, frontMatter: frontMatterLines.filter(Boolean).join("\n") };
}

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

function parseSections(tocText: string, lastPage: number): RulebookSection[] {
  const entries: Array<{ title: string; startPage: number }> = [];

  for (const line of tocText.split("\n")) {
    const match = line.match(/^\s*(?:l|•|\*)?\s*(.+?)\s*\.{3,}\s*(\d{1,3})\s*$/);
    if (!match) continue;
    const title = match[1].replace(/\s+/g, " ").trim();
    const startPage = Number(match[2]);
    if (!title || !Number.isFinite(startPage)) continue;
    entries.push({ title, startPage });
  }

  if (entries.length === 0) return [];

  const unique = new Map<string, number>();
  for (const entry of entries) {
    if (!unique.has(entry.title) || (unique.get(entry.title) as number) > entry.startPage) {
      unique.set(entry.title, entry.startPage);
    }
  }

  const ordered = Array.from(unique.entries())
    .map(([title, startPage]) => ({ title, startPage }))
    .sort((a, b) => a.startPage - b.startPage);

  return ordered.map((entry, index) => ({
    title: entry.title,
    startPage: entry.startPage,
    endPage: Math.min(
      index + 1 < ordered.length ? ordered[index + 1].startPage - 1 : lastPage,
      lastPage
    )
  }));
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function ensureCacheDir(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function loadRulebookIndex(): RulebookIndex | null {
  try {
    if (!fs.existsSync(INDEX_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
    if (!parsed?.pages?.length) return null;
    return parsed as RulebookIndex;
  } catch {
    return null;
  }
}

function saveIndex(index: RulebookIndex): void {
  ensureCacheDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index), "utf-8");
  const { pages, ...manifest } = index;
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

function ageDays(fetchedAt?: string): number | undefined {
  if (!fetchedAt) return undefined;
  const ms = Date.now() - new Date(fetchedAt).getTime();
  if (!Number.isFinite(ms)) return undefined;
  return Math.max(0, Math.round((ms / 86_400_000) * 10) / 10);
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Downloads (or refreshes) the official rulebook and rebuilds the local index.
 * Safe to call repeatedly: respects ETag/Last-Modified and exits early when the
 * cached copy is still fresh.
 */
export async function syncOfficialRulebook(options: { force?: boolean } = {}): Promise<RulebookSyncResult> {
  const cached = loadRulebookIndex();
  const cacheAge = cached ? ageDays(cached.fetchedAt) : undefined;

  if (!options.force && cached && cached.parserVersion === PARSER_VERSION && cacheAge !== undefined && cacheAge * 86_400_000 < FRESHNESS_TTL_MS) {
    return { available: true, changed: false, manifest: stripPages(cached) };
  }

  let source: { url: string; candidates: string[] };
  try {
    source = await discoverRulebookPdf();
  } catch (error) {
    return {
      available: cached ? true : false,
      changed: false,
      manifest: cached ? stripPages(cached) : undefined,
      reason: `Could not resolve the rulebook link: ${(error as Error).message}`
    };
  }

  const headers: Record<string, string> = { "User-Agent": "yugioh-assistant-mcp/1.1 (+rulebook sync)" };
  // Conditional requests are only safe when the cached index matches this parser,
  // otherwise a 304 would pin an outdated extraction in place.
  if (cached?.parserVersion === PARSER_VERSION) {
    if (cached.etag) headers["If-None-Match"] = cached.etag;
    if (cached.lastModified) headers["If-Modified-Since"] = cached.lastModified;
  }

  let response: Response;
  try {
    response = await fetch(source.url, { headers, signal: AbortSignal.timeout(90_000) });
  } catch (error) {
    return {
      available: cached ? true : false,
      changed: false,
      manifest: cached ? stripPages(cached) : undefined,
      reason: `Could not download the rulebook PDF: ${(error as Error).message}`
    };
  }

  if (response.status === 304 && cached) {
    const refreshed: RulebookIndex = { ...cached, fetchedAt: new Date().toISOString() };
    saveIndex(refreshed);
    return { available: true, changed: false, manifest: stripPages(refreshed) };
  }

  if (!response.ok) {
    return {
      available: cached ? true : false,
      changed: false,
      manifest: cached ? stripPages(cached) : undefined,
      reason: `Konami returned HTTP ${response.status} for ${source.url}`
    };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  // Persist the raw PDF immediately: pdfjs transfers the buffer it is given,
  // which would otherwise detach our copy before it can be written to disk.
  ensureCacheDir();
  const fileName = decodeURIComponent(new URL(source.url).pathname.split("/").pop() || "rulebook.pdf");
  const pdfPath = path.join(CACHE_DIR, fileName.endsWith(".pdf") ? fileName : "rulebook.pdf");
  fs.writeFileSync(pdfPath, Buffer.from(bytes));

  if (cached && cached.sha256 === sha256 && cached.parserVersion === PARSER_VERSION) {
    const refreshed: RulebookIndex = {
      ...cached,
      fetchedAt: new Date().toISOString(),
      sourceUrl: source.url,
      pdfBytes: bytes.byteLength,
      etag: response.headers.get("etag") || cached.etag,
      lastModified: response.headers.get("last-modified") || cached.lastModified
    };
    saveIndex(refreshed);
    return { available: true, changed: false, manifest: stripPages(refreshed) };
  }

  let extracted: { pages: RulebookPage[]; title: string; version: string; frontMatter: string };
  try {
    extracted = await extractPages(new Uint8Array(bytes));
  } catch (error) {
    return {
      available: cached ? true : false,
      changed: false,
      manifest: cached ? stripPages(cached) : undefined,
      reason: `Could not read the PDF: ${(error as Error).message}`
    };
  }

  if (extracted.pages.length === 0) {
    return {
      available: cached ? true : false,
      changed: false,
      manifest: cached ? stripPages(cached) : undefined,
      reason: "The downloaded PDF contains no text (it may be an image scan)."
    };
  }

  const lastPage = Math.max(...extracted.pages.map((p) => p.page));
  const sections = parseSections(extracted.frontMatter, lastPage);
  const charCount = extracted.pages.reduce((sum, p) => sum + p.text.length, 0);

  const index: RulebookIndex = {
    title: extracted.title || "OFFICIAL RULEBOOK",
    version: extracted.version || "unknown",
    sourceUrl: source.url,
    sourcePage: RULEBOOK_LANDING_PAGE,
    fetchedAt: new Date().toISOString(),
    etag: response.headers.get("etag") || undefined,
    lastModified: response.headers.get("last-modified") || undefined,
    sha256,
    pdfBytes: bytes.byteLength,
    pageCount: extracted.pages.length,
    charCount,
    sections,
    parserVersion: PARSER_VERSION,
    pages: extracted.pages
  };

  saveIndex(index);
  return { available: true, changed: true, manifest: stripPages(index) };
}

function stripPages(index: RulebookIndex): RulebookManifest {
  const { pages, ...manifest } = index;
  return manifest;
}

/**
 * Loads the cached rulebook, syncing on demand if it is missing or stale.
 * Returns null when the official text genuinely cannot be obtained.
 */
export async function ensureRulebook(options: { refresh?: boolean } = {}): Promise<RulebookIndex | null> {
  const cached = loadRulebookIndex();
  const cacheAge = cached ? ageDays(cached.fetchedAt) : undefined;
  const fresh = cacheAge !== undefined && cacheAge * 86_400_000 < FRESHNESS_TTL_MS;
  const sameParser = cached?.parserVersion === PARSER_VERSION;

  if (cached && fresh && sameParser && !options.refresh) return cached;

  const result = await syncOfficialRulebook({ force: options.refresh });
  if (result.available) {
    const updated = loadRulebookIndex();
    if (updated) return updated;
  }
  return cached;
}

export function getRulebookStatus(): RulebookStatus {
  const index = loadRulebookIndex();
  if (!index) {
    return {
      available: false,
      loaded: false,
      stale: true,
      sourcePage: RULEBOOK_LANDING_PAGE,
      reason: "No official rulebook has been stored yet. Call ygo_get_rulebook with topic=\"status\" and refresh=true to sync."
    };
  }
  const days = ageDays(index.fetchedAt);
  return {
    available: true,
    loaded: true,
    stale: days !== undefined ? days * 86_400_000 > FRESHNESS_TTL_MS : true,
    title: index.title,
    version: index.version,
    sourceUrl: index.sourceUrl,
    sourcePage: index.sourcePage,
    fetchedAt: index.fetchedAt,
    ageDays: days,
    pageCount: index.pageCount,
    charCount: index.charCount,
    sections: index.sections.length,
    sha256: index.sha256
  };
}

export function getRulebookText(page: number): { available: boolean; page?: RulebookPage; section?: string; reason?: string } {
  const index = loadRulebookIndex();
  if (!index) return { available: false, reason: "Rulebook is not synced yet." };
  const found = index.pages.find((p) => p.page === page);
  if (!found) {
    return {
      available: false,
      reason: `No page ${page}. The rulebook has ${index.pageCount} printed pages.`
    };
  }
  return { available: true, page: found, section: sectionFor(index, page) };
}

export function getRulebookSections(): { available: boolean; sections: RulebookSection[]; reason?: string } {
  const index = loadRulebookIndex();
  if (!index) return { available: false, sections: [], reason: "Rulebook is not synced yet." };
  return { available: true, sections: index.sections };
}

export function getRulebookSectionPage(title: string): { available: boolean; section?: RulebookSection; text?: string; reason?: string } {
  const index = loadRulebookIndex();
  if (!index) return { available: false, reason: "Rulebook is not synced yet." };
  const needle = title.trim().toLowerCase();
  const exact = index.sections.find((s) => s.title.toLowerCase() === needle);
  const section = exact || index.sections.find((s) => s.title.toLowerCase().includes(needle) || needle.includes(s.title.toLowerCase()));
  if (!section) {
    return { available: false, reason: `No section "${title}". Sections: ${index.sections.map((s) => s.title).join(", ")}` };
  }
  const text = index.pages
    .filter((p) => p.page >= section.startPage && p.page <= section.endPage)
    .map((p) => `--- page ${p.page} ---\n${p.text}`)
    .join("\n\n");
  return { available: true, section, text };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function sectionFor(index: RulebookIndex, page: number): string {
  const found = index.sections.find((s) => page >= s.startPage && page <= s.endPage);
  return found ? found.title : "General";
}

/**
 * Ranked keyword search (BM25 over printed pages, phrase + judge-vocabulary
 * boosts). Returns page-level citations taken straight from the official text.
 */
export function searchRulebook(query: string, limit = 5): RulebookSearchResult {
  const index = loadRulebookIndex();
  if (!index) {
    return { query, available: false, totalMatches: 0, hits: [], reason: "Rulebook is not synced yet." };
  }

  if (query.trim().length === 0) {
    return { query, available: true, totalMatches: 0, hits: [], reason: "Empty query." };
  }

  const chunks: SearchableChunk[] = index.pages.map((page) => ({
    id: `p${page.page}`,
    page: page.page,
    section: sectionFor(index, page.page),
    text: page.text
  }));

  const ranked = rankChunks(query, chunks, { limit });

  return {
    query,
    available: true,
    totalMatches: ranked.totalMatches,
    hits: ranked.hits.map((hit) => ({
      page: hit.page ?? 0,
      section: hit.section ?? "General",
      score: hit.score,
      snippet: hit.snippet
    }))
  };
}

/** Full text of a section, with page markers, for verbatim quoting. */
export function getOfficialRulebookExcerpt(query: string, limit = 3): {
  available: boolean;
  query: string;
  citations: Array<{ page: number; section: string; score: number; snippet: string }>;
  reason?: string;
} {
  const result = searchRulebook(query, limit);
  if (!result.available) {
    return { available: false, query, citations: [], reason: result.reason };
  }
  if (result.hits.length === 0) {
    return {
      available: true,
      query,
      citations: [],
      reason: "No matching passage in the official rulebook. Not answering with hand-written content."
    };
  }
  return {
    available: true,
    query,
    citations: result.hits.map((h) => ({
      page: h.page,
      section: h.section,
      score: h.score,
      snippet: h.snippet
    }))
  };
}
