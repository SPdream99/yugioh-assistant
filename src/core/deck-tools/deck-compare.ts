import type { DeckData } from '../../types/deck.js';

/**
 * Structural comparison of two decklists: what is shared, what only one list
 * runs, and where copy counts differ. Useful for "core vs tech" questions and
 * for spotting which half of a community list is actually the engine.
 */

export type DeckSection = 'main' | 'extra' | 'side';

export interface DeckCardRow {
  passcode: number;
  name: string;
  copiesA: number;
  copiesB: number;
  delta: number;
}

export interface SectionDiff {
  section: DeckSection;
  onlyA: DeckCardRow[];
  onlyB: DeckCardRow[];
  shared: DeckCardRow[];
  changedCopies: DeckCardRow[];
  overlapPct: number;
}

export interface DeckComparison {
  sections: SectionDiff[];
  summary: {
    uniqueA: number;
    uniqueB: number;
    sharedUnique: number;
    overlapPct: number;
    identical: boolean;
  };
  note: string;
}

function countsOf(list: DeckData['main']): Map<number, number> {
  const counts = new Map<number, number>();
  for (const entry of list || []) {
    const id = typeof entry === 'number' ? entry : typeof entry === 'string' ? parseInt(entry, 10) : entry?.id;
    if (!Number.isFinite(id) || id <= 0) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function diffSection(
  section: DeckSection,
  a: DeckData['main'],
  b: DeckData['main'],
  nameOf: (id: number) => string
): SectionDiff {
  const countsA = countsOf(a);
  const countsB = countsOf(b);
  const ids = new Set<number>([...countsA.keys(), ...countsB.keys()]);

  const onlyA: DeckCardRow[] = [];
  const onlyB: DeckCardRow[] = [];
  const shared: DeckCardRow[] = [];
  const changedCopies: DeckCardRow[] = [];

  for (const id of ids) {
    const copiesA = countsA.get(id) || 0;
    const copiesB = countsB.get(id) || 0;
    const row: DeckCardRow = { passcode: id, name: nameOf(id), copiesA, copiesB, delta: copiesB - copiesA };
    if (copiesA > 0 && copiesB > 0) {
      shared.push(row);
      if (copiesA !== copiesB) changedCopies.push(row);
    } else if (copiesA > 0) onlyA.push(row);
    else onlyB.push(row);
  }

  const uniqueA = [...countsA.keys()].length;
  const uniqueB = [...countsB.keys()].length;
  const sharedUnique = shared.length;
  const overlapPct = uniqueA + uniqueB === 0 ? 100 : Math.round((2 * sharedUnique * 100) / (uniqueA + uniqueB));

  const byName = (x: DeckCardRow, y: DeckCardRow) => x.name.localeCompare(y.name);
  return {
    section,
    onlyA: onlyA.sort(byName),
    onlyB: onlyB.sort(byName),
    shared: shared.sort(byName),
    changedCopies: changedCopies.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)),
    overlapPct
  };
}

export function compareDecks(
  a: DeckData,
  b: DeckData,
  nameOf: (id: number) => string
): DeckComparison {
  const sections = [
    diffSection('main', a.main || [], b.main || [], nameOf),
    diffSection('extra', a.extra || [], b.extra || [], nameOf),
    diffSection('side', a.side || [], b.side || [], nameOf)
  ];

  const main = sections[0];
  const sharedUnique = sections.reduce((sum, s) => sum + s.shared.length, 0);
  const uniqueA = sections.reduce((sum, s) => sum + s.onlyA.length + s.shared.length, 0);
  const uniqueB = sections.reduce((sum, s) => sum + s.onlyB.length + s.shared.length, 0);
  const overlapPct = uniqueA + uniqueB === 0 ? 100 : Math.round((2 * sharedUnique * 100) / (uniqueA + uniqueB));

  return {
    sections,
    summary: {
      uniqueA,
      uniqueB,
      sharedUnique,
      overlapPct,
      identical:
        sections.every(s => s.onlyA.length === 0 && s.onlyB.length === 0 && s.changedCopies.length === 0)
    },
    note:
      'Copy counts are compared per sections (Main/Extra/Side). A high overlap means the same engine; the differences are the tech or the side plan.',
  };
}
