import fs from 'node:fs';
import path from 'node:path';
import { getDataRoot } from '../../utils/paths.js';
import type { MarketRecord } from './market-index.js';

/**
 * Daily price snapshots.
 *
 * There is no free, public, per-card price-history API for Yu-Gi-Oh! (YGOPRODeck
 * exposes today's price only; TCGplayer's history is keyed; TCGCSV archives are
 * bulk 7z files of every category). So the honest design is to record what we
 * see, once per day, and say how much coverage exists instead of inventing a
 * seven-day delta on day one.
 *
 * Shape on disk: data/market/history/YYYY-MM-DD.json
 *   { "date": "...", "source": "...", "prices": { "<id>": [market, top] }, "views": { "<id>": n } }
 */

const RETENTION_DAYS = 180;

export interface MoverEntry {
  id: number;
  name: string;
  fromUsd: number;
  toUsd: number;
  changeUsd: number;
  changePct: number;
  baselineDate: string;
  latestDate: string;
}

export interface MoverReport {
  available: boolean;
  basis: 'snapshot';
  windowDays: number;
  daysAvailable: number;
  samples: number;
  baselineDate?: string;
  latestDate?: string;
  entries: MoverEntry[];
  note: string;
}

function historyDir(): string {
  return path.join(getDataRoot(), 'data', 'market', 'history');
}

function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function listSnapshotDates(): string[] {
  try {
    return fs
      .readdirSync(historyDir())
      .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map(name => name.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Records today's prices. Idempotent: the file is written once per UTC day, so
 * calling the tool ten times does not create ten samples or ten files.
 */
export function recordDailySnapshot(records: MarketRecord[]): {
  created: boolean;
  alreadyRecorded: boolean;
  date: string;
  cards: number;
} {
  const date = utcDate();
  const dir = historyDir();
  const file = path.join(dir, `${date}.json`);

  try {
    fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(file)) {
      return { created: false, alreadyRecorded: true, date, cards: 0 };
    }

    const prices: Record<string, [number, number]> = {};
    const views: Record<string, number> = {};
    let cards = 0;

    for (const record of records) {
      const market = Number(record.marketUsd.toFixed(2));
      const top = Number(record.topUsd.toFixed(2));
      if (market <= 0 && top <= 0) continue;
      prices[String(record.id)] = [market, top];
      views[String(record.id)] = record.weeklyViews;
      cards++;
    }

    fs.writeFileSync(
      file,
      JSON.stringify({ date, source: 'ygoprodeck_cardinfo', prices, views }),
      'utf8'
    );

    pruneOldSnapshots(date);
    return { created: true, alreadyRecorded: false, date, cards };
  } catch {
    // A read-only data root must not break a price answer.
    return { created: false, alreadyRecorded: false, date, cards: 0 };
  }
}

function pruneOldSnapshots(today: string): void {
  const cutoff = addDays(today, -RETENTION_DAYS);
  for (const date of listSnapshotDates()) {
    if (date < cutoff) {
      try {
        fs.unlinkSync(path.join(historyDir(), `${date}.json`));
      } catch {
        // ignore
      }
    }
  }
}

interface Snapshot {
  date: string;
  prices: Record<string, [number, number]>;
  views?: Record<string, number>;
}

function readSnapshot(date: string): Snapshot | undefined {
  try {
    const raw = fs.readFileSync(path.join(historyDir(), `${date}.json`), 'utf8');
    const parsed = JSON.parse(raw) as Snapshot;
    if (!parsed || typeof parsed !== 'object' || !parsed.prices) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function describeHistory(): { daysAvailable: number; dates: string[] } {
  const dates = listSnapshotDates();
  return { daysAvailable: dates.length, dates };
}

/**
 * Compares the oldest snapshot inside the window with the newest one.
 * Requires at least two distinct days; otherwise returns available:false with
 * the real coverage instead of a made-up percentage.
 */
export function computeMovers(
  records: MarketRecord[],
  windowDays = 30,
  limit = 15,
  basis: 'market' | 'top_printing' = 'market'
): MoverReport {
  const dates = listSnapshotDates();
  const today = utcDate();
  const cutoff = addDays(today, -windowDays);
  const inWindow = dates.filter(d => d >= cutoff);

  const base: Omit<MoverReport, 'entries' | 'note' | 'available' | 'daysAvailable'> = {
    basis: 'snapshot',
    windowDays,
    samples: inWindow.length,
    baselineDate: inWindow[0],
    latestDate: inWindow[inWindow.length - 1]
  };

  if (inWindow.length < 2) {
    return {
      ...base,
      available: false,
      daysAvailable: dates.length,
      entries: [],
      note:
        dates.length === 0
          ? 'No price snapshots recorded yet. The first snapshot is written now; deltas become available after the next daily snapshot.'
          : `Only ${dates.length} day(s) of snapshots exist (latest ${dates[dates.length - 1]}). A real price change needs at least 2 distinct days.`
    };
  }

  const oldest = readSnapshot(inWindow[0]);
  const newest = readSnapshot(inWindow[inWindow.length - 1]);
  if (!oldest || !newest) {
    return {
      ...base,
      available: false,
      daysAvailable: dates.length,
      entries: [],
      note: 'Snapshot files exist but could not be read.'
    };
  }

  const byId = new Map(records.map(r => [r.id, r]));
  const entries: MoverEntry[] = [];

  for (const [idStr, latestPair] of Object.entries(newest.prices)) {
    const fromPair = oldest.prices[idStr];
    if (!fromPair) continue;

    const from = basis === 'top_printing' ? fromPair[1] : fromPair[0];
    const to = basis === 'top_printing' ? latestPair[1] : latestPair[0];
    if (from <= 0 || to <= 0) continue;

    const changeUsd = to - from;
    const changePct = (changeUsd / from) * 100;
    const record = byId.get(Number(idStr));

    entries.push({
      id: Number(idStr),
      name: record?.name || `Card ${idStr}`,
      fromUsd: Number(from.toFixed(2)),
      toUsd: Number(to.toFixed(2)),
      changeUsd: Number(changeUsd.toFixed(2)),
      changePct: Number(changePct.toFixed(1)),
      baselineDate: oldest.date,
      latestDate: newest.date
    });
  }

  entries.sort((a, b) => b.changePct - a.changePct);

  return {
    ...base,
    available: true,
    daysAvailable: dates.length,
    entries: entries.slice(0, limit),
    note: `Measured from our own daily snapshots: ${oldest.date} -> ${newest.date} (${inWindow.length} samples, ${entries.length} comparable cards). Prices are YGOPRODeck/TCGPlayer aggregates, not sale-by-sale data.`
  };
}
