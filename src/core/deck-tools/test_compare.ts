import { compareDecks } from './deck-compare.js';
import type { DeckData } from '../../types/deck.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`ok - ${message}`);
}

const ASH = 14558127;
const DM = 46986414;
const BEWD = 89631139;
const RED_EYES = 74677427;

const names = new Map<number, string>([
  [ASH, 'Ash Blossom & Joyous Spring'],
  [DM, 'Dark Magician'],
  [BEWD, 'Blue-Eyes White Dragon'],
  [RED_EYES, 'Red-Eyes Black Dragon']
]);
const nameOf = (id: number) => names.get(id) || `#${id}`;

const a: DeckData = { main: [ASH, ASH, ASH, DM, BEWD], extra: [], side: [] };
const b: DeckData = { main: [ASH, ASH, DM, RED_EYES], extra: [], side: [] };

const diff = compareDecks(a, b, nameOf);
const main = diff.sections[0];

console.log('onlyA:', main.onlyA.map(r => r.name), '| onlyB:', main.onlyB.map(r => r.name));
console.log('shared:', main.shared.map(r => `${r.name} ${r.copiesA}/${r.copiesB}`));

assert(!diff.summary.identical, 'different lists are not identical');
assert(main.onlyA.some(r => r.passcode === BEWD), 'a card only in A is reported');
assert(main.onlyB.some(r => r.passcode === RED_EYES), 'a card only in B is reported');
assert(
  main.changedCopies.some(r => r.passcode === ASH && r.copiesA === 3 && r.copiesB === 2),
  'copy-count differences are reported'
);
assert(main.shared.some(r => r.passcode === DM), 'shared cards are reported');
assert(main.overlapPct > 0 && main.overlapPct < 100, 'overlap percentage is between 0 and 100');

const same = compareDecks(a, a, nameOf);
assert(same.summary.identical, 'a deck compared with itself is identical');
assert(same.summary.overlapPct === 100, 'self-comparison is 100% overlap');
assert(same.sections.every(s => s.changedCopies.length === 0), 'self-comparison has no copy differences');

const empty = compareDecks({ main: [], extra: [], side: [] }, a, nameOf);
assert(empty.summary.overlapPct === 0, 'an empty deck has 0% overlap');

console.log('\nAll deck-comparison checks passed.');
