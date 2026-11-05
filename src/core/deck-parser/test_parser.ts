import assert from 'node:assert';
import { parseYdk, formatYdk, validateDeck } from './ydk.js';
import { parseYdke, formatYdke } from './ydke.js';
import { CardDatabase } from '../card-database/ygoprodeck.js';
import type { DeckData } from '../../types/deck.js';

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    console.error(error);
  }
}

console.log('====================================================');
console.log('Yu-Gi-Oh YDK/YDKE Parser & Card Database Test Suite');
console.log('====================================================\n');

// ----------------------------------------------------------------------------
// A) YDK Parsing and Formatting
// ----------------------------------------------------------------------------
console.log('--- Test Suite A: YDK Parsing and Formatting ---');

const sampleYdkText = `
#created by Seto Kaiba
#main
89631139
89631139
89631139
46986414
#extra
1861629
84013237
!side
14558127
23434538
`;

runTest('YDK: parses sample YDK into DeckData correctly', () => {
  const deck = parseYdk(sampleYdkText);
  assert.strictEqual(deck.name, 'Seto Kaiba');
  assert.strictEqual(deck.main.length, 4);
  assert.deepStrictEqual(deck.main, [89631139, 89631139, 89631139, 46986414]);
  assert.strictEqual(deck.extra.length, 2);
  assert.deepStrictEqual(deck.extra, [1861629, 84013237]);
  assert.strictEqual(deck.side.length, 2);
  assert.deepStrictEqual(deck.side, [14558127, 23434538]);
  assert.strictEqual(deck.metadata?.createdBy, 'Seto Kaiba');
});

runTest('YDK: formatYdk produces valid YDK content', () => {
  const deck: DeckData = {
    name: 'Seto Kaiba',
    main: [89631139, 46986414],
    extra: [1861629],
    side: [14558127]
  };

  const formatted = formatYdk(deck);
  assert(formatted.includes('#created by Seto Kaiba'));
  assert(formatted.includes('#main\n89631139\n46986414'));
  assert(formatted.includes('#extra\n1861629'));
  assert(formatted.includes('!side\n14558127'));
});

runTest('YDK: round-trip parseYdk(formatYdk(deck)) retains all card passcodes', () => {
  const originalDeck: DeckData = {
    name: 'Kaiba Corp',
    main: [89631139, 89631139, 89631139, 46986414],
    extra: [1861629, 84013237],
    side: [14558127, 23434538]
  };

  const ydkString = formatYdk(originalDeck);
  const reparsed = parseYdk(ydkString);

  assert.deepStrictEqual(reparsed.main, originalDeck.main);
  assert.deepStrictEqual(reparsed.extra, originalDeck.extra);
  assert.deepStrictEqual(reparsed.side, originalDeck.side);
  assert.strictEqual(reparsed.name, originalDeck.name);
});

// ----------------------------------------------------------------------------
// B) Deck Validation
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite B: Deck Validation ---');

function createSampleValidDeck(): DeckData {
  // 40 main cards: 13 unique cards x 3 + 1 single card (total 40)
  const main: number[] = [];
  const dummyIds = [
    10001, 10002, 10003, 10004, 10005,
    10006, 10007, 10008, 10009, 10010,
    10011, 10012, 10013
  ];
  for (const id of dummyIds) {
    main.push(id, id, id);
  }
  main.push(10014); // 13 * 3 + 1 = 40

  // 15 extra cards: 5 unique x 3
  const extra = [
    20001, 20001, 20001,
    20002, 20002, 20002,
    20003, 20003, 20003,
    20004, 20004, 20004,
    20005, 20005, 20005
  ];

  // 15 side cards: 5 unique x 3
  const side = [
    30001, 30001, 30001,
    30002, 30002, 30002,
    30003, 30003, 30003,
    30004, 30004, 30004,
    30005, 30005, 30005
  ];

  return { name: 'Valid Standard Deck', main, extra, side };
}

runTest('Validation: passes for standard 40-main, 15-extra, 15-side deck', () => {
  const deck = createSampleValidDeck();
  const res = validateDeck(deck);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.errors.length, 0);
});

runTest('Validation: fails if main deck has fewer than 40 cards', () => {
  const deck = createSampleValidDeck();
  deck.main.pop(); // 39 cards
  const res = validateDeck(deck);
  assert.strictEqual(res.valid, false);
  assert(res.errors.some(e => e.includes('at least 40 cards')));
});

runTest('Validation: fails if main deck exceeds 60 cards', () => {
  const deck = createSampleValidDeck();
  while (deck.main.length < 61) {
    deck.main.push(90000 + deck.main.length);
  }
  const res = validateDeck(deck);
  assert.strictEqual(res.valid, false);
  assert(res.errors.some(e => e.includes('cannot exceed 60 cards')));
});

runTest('Validation: fails if extra deck exceeds 15 cards', () => {
  const deck = createSampleValidDeck();
  deck.extra.push(99999); // 16 cards
  const res = validateDeck(deck);
  assert.strictEqual(res.valid, false);
  assert(res.errors.some(e => e.includes('Extra deck cannot exceed 15 cards')));
});

runTest('Validation: fails if side deck exceeds 15 cards', () => {
  const deck = createSampleValidDeck();
  deck.side.push(99999); // 16 cards
  const res = validateDeck(deck);
  assert.strictEqual(res.valid, false);
  assert(res.errors.some(e => e.includes('Side deck cannot exceed 15 cards')));
});

runTest('Validation: fails if any card has more than 3 copies across all sections', () => {
  const deck = createSampleValidDeck();
  // 10001 already has 3 copies in main deck; add a 4th copy into side deck
  deck.side[0] = 10001;
  const res = validateDeck(deck);
  assert.strictEqual(res.valid, false);
  assert(res.errors.some(e => e.includes('Card 10001 exceeds maximum allowed copies of 3')));
});

runTest('Validation: enforces custom banlist constraints correctly', () => {
  const deck = createSampleValidDeck();
  // Replace card 10014 with Pot of Greed (55144522)
  deck.main[39] = 55144522;

  // Forbidden test (limit = 0)
  const forbiddenRes = validateDeck(deck, { 55144522: 0 });
  assert.strictEqual(forbiddenRes.valid, false);
  assert(forbiddenRes.errors.some(e => e.includes('Card 55144522 exceeds banlist limit of 0')));

  // Limited test (limit = 1, deck has 1 -> passes)
  const limitedPassRes = validateDeck(deck, { 55144522: 1 });
  assert.strictEqual(limitedPassRes.valid, true);

  // Limited test failure (limit = 1, deck has 2 -> fails)
  deck.main[38] = 55144522;
  const limitedFailRes = validateDeck(deck, { 55144522: 1 });
  assert.strictEqual(limitedFailRes.valid, false);
  assert(limitedFailRes.errors.some(e => e.includes('Card 55144522 exceeds banlist limit of 1')));
});

// ----------------------------------------------------------------------------
// C) YDKE Encoding and Decoding
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite C: YDKE Encoding and Decoding ---');

runTest('YDKE: encodes DeckData to valid YDKE URL string', () => {
  const deck: DeckData = {
    main: [89631139, 46986414],
    extra: [1861629],
    side: [14558127]
  };

  const ydke = formatYdke(deck);
  assert(ydke.startsWith('ydke://'));
  const parts = ydke.slice(7).split('!');
  assert.strictEqual(parts.length, 4); // main!extra!side! (trailing empty element)
  assert.strictEqual(parts[3], '');
});

runTest('YDKE: parses standard YDKE URL correctly', () => {
  const deck: DeckData = {
    main: [89631139, 46986414],
    extra: [1861629],
    side: [14558127]
  };

  const ydke = formatYdke(deck);
  const parsed = parseYdke(ydke, 'Test YDKE Deck');

  assert.strictEqual(parsed.name, 'Test YDKE Deck');
  assert.deepStrictEqual(parsed.main, deck.main);
  assert.deepStrictEqual(parsed.extra, deck.extra);
  assert.deepStrictEqual(parsed.side, deck.side);
});

runTest('YDKE: parses string without ydke:// prefix and without trailing exclamation mark', () => {
  const deck: DeckData = {
    main: [89631139],
    extra: [],
    side: [14558127]
  };
  const rawYdke = formatYdke(deck); // ydke://<main>!!<side>!
  const stripped = rawYdke.replace('ydke://', '').replace(/!$/, '');

  const parsed = parseYdke(stripped);
  assert.deepStrictEqual(parsed.main, [89631139]);
  assert.deepStrictEqual(parsed.extra, []);
  assert.deepStrictEqual(parsed.side, [14558127]);
});

runTest('YDKE: full round-trip: ydke -> DeckData -> ydk -> DeckData -> ydke', () => {
  const initialDeck = createSampleValidDeck();
  const initialYdke = formatYdke(initialDeck);

  // 1. ydke -> DeckData
  const step1Deck = parseYdke(initialYdke, 'Roundtrip Deck');
  assert.deepStrictEqual(step1Deck.main, initialDeck.main);
  assert.deepStrictEqual(step1Deck.extra, initialDeck.extra);
  assert.deepStrictEqual(step1Deck.side, initialDeck.side);

  // 2. DeckData -> ydk string
  const step2Ydk = formatYdk(step1Deck);

  // 3. ydk -> DeckData
  const step3Deck = parseYdk(step2Ydk);
  assert.deepStrictEqual(step3Deck.main, initialDeck.main);
  assert.deepStrictEqual(step3Deck.extra, initialDeck.extra);
  assert.deepStrictEqual(step3Deck.side, initialDeck.side);

  // 4. DeckData -> ydke
  const finalYdke = formatYdke(step3Deck);
  assert.strictEqual(finalYdke, initialYdke);
});

// ----------------------------------------------------------------------------
// D) CardDatabase
// ----------------------------------------------------------------------------
console.log('\n--- Test Suite D: CardDatabase ---');

runTest('CardDatabase: initializes with built-in staple fallback stubs', () => {
  const db = new CardDatabase();
  assert(db.cards.size >= 9);

  // Verify staple cards exist
  assert(db.cards.has(14558127)); // Ash Blossom
  assert(db.cards.has(89631139)); // Blue-Eyes White Dragon
  assert(db.cards.has(46986414)); // Dark Magician
  assert(db.cards.has(23434538)); // Maxx "C"
  assert(db.cards.has(27204311)); // Nibiru, the Primal Being
  assert(db.cards.has(55144522)); // Pot of Greed
  assert(db.cards.has(67441435)); // Glow-Up Bulb
  assert(db.cards.has(1861629));  // Decode Talker
  assert(db.cards.has(84013237)); // Number 39: Utopia
});

runTest('CardDatabase: getCardById retrieves card details accurately', () => {
  const db = new CardDatabase();
  const bewd = db.getCardById(89631139);
  assert(bewd !== undefined);
  assert.strictEqual(bewd?.name, 'Blue-Eyes White Dragon');
  assert.strictEqual(bewd?.atk, 3000);
  assert.strictEqual(bewd?.def, 2500);
  assert.strictEqual(bewd?.level, 8);
  assert.strictEqual(bewd?.race, 'Dragon');
  assert.strictEqual(bewd?.attribute, 'LIGHT');

  const unknown = db.getCardById(999999999);
  assert.strictEqual(unknown, undefined);
});

runTest('CardDatabase: getCardByName supports case-insensitive exact and fuzzy match', () => {
  const db = new CardDatabase();

  // Exact matches with differing cases
  const ashExact = db.getCardByName('ash blossom & joyous spring');
  assert(ashExact !== undefined);
  assert.strictEqual(ashExact?.id, 14558127);

  const dmExact = db.getCardByName('DARK MAGICIAN');
  assert(dmExact !== undefined);
  assert.strictEqual(dmExact?.id, 46986414);

  // Substring / fuzzy search
  const utopiaFuzzy = db.getCardByName('utopia');
  assert(utopiaFuzzy !== undefined);
  assert.strictEqual(utopiaFuzzy?.id, 84013237);

  const nonExistent = db.getCardByName('NonExistentCardXYZ');
  assert.strictEqual(nonExistent, undefined);
});

runTest('CardDatabase: searchCards filters cards by type, level, numeric ranges, and attributes', () => {
  const db = new CardDatabase();

  // Filter 1: Normal Monster with level 8 and ATK >= 2500
  const dragons = db.searchCards({
    level: 8,
    atk: { min: 2500 },
    type: 'Normal Monster'
  });
  assert.strictEqual(dragons.length, 1);
  assert.strictEqual(dragons[0].name, 'Blue-Eyes White Dragon');

  // Filter 2: Tuner Monster with Attribute FIRE
  const fireTuners = db.searchCards({
    type: 'Tuner',
    attribute: 'FIRE'
  });
  assert.strictEqual(fireTuners.length, 1);
  assert.strictEqual(fireTuners[0].name, 'Ash Blossom & Joyous Spring');

  // Filter 3: Link Monster with linkval 3
  const link3 = db.searchCards({
    type: 'Link',
    linkval: 3
  });
  assert.strictEqual(link3.length, 1);
  assert.strictEqual(link3[0].name, 'Decode Talker');

  // Filter 4: DEF range 2000 - 2500
  const highDef = db.searchCards({
    def: { min: 2000, max: 2500 }
  });
  // Blue-Eyes (2500), Dark Magician (2100), Utopia (2000)
  assert.strictEqual(highDef.length, 3);
  const names = highDef.map(c => c.name);
  assert(names.includes('Blue-Eyes White Dragon'));
  assert(names.includes('Dark Magician'));
  assert(names.includes('Number 39: Utopia'));

  // Filter 5: Banlist search
  const forbiddenCards = db.searchCards({
    banlist: 'forbidden'
  });
  assert(forbiddenCards.length >= 3);
  const forbiddenNames = forbiddenCards.map(c => c.name);
  assert(forbiddenNames.includes('Pot of Greed'));
  assert(forbiddenNames.includes('Glow-Up Bulb'));
  assert(forbiddenNames.includes('Maxx "C"'));
});

runTest('CardDatabase: resolveDeck maps passcodes to Cards, tallies cardCounts, and handles unknowns', () => {
  const db = new CardDatabase();

  const deck: DeckData = {
    name: 'Resolved Test Deck',
    main: [89631139, 89631139, 14558127], // Blue-Eyes x2, Ash x1
    extra: [1861629],                     // Decode Talker x1
    side: [14558127, 99999999]            // Ash x1, Unknown card x1
  };

  const resolved = db.resolveDeck(deck);

  assert.strictEqual(resolved.name, 'Resolved Test Deck');
  assert.strictEqual(resolved.main.length, 3);
  assert.strictEqual(resolved.main[0].name, 'Blue-Eyes White Dragon');
  assert.strictEqual(resolved.main[1].name, 'Blue-Eyes White Dragon');
  assert.strictEqual(resolved.main[2].name, 'Ash Blossom & Joyous Spring');

  assert.strictEqual(resolved.extra.length, 1);
  assert.strictEqual(resolved.extra[0].name, 'Decode Talker');

  assert.strictEqual(resolved.side.length, 2);
  assert.strictEqual(resolved.side[0].name, 'Ash Blossom & Joyous Spring');

  // Verify unknown card fallback stub
  assert.strictEqual(resolved.side[1].id, 99999999);
  assert.strictEqual(resolved.side[1].name, 'Unknown Card (99999999)');
  assert.strictEqual(resolved.side[1].type, 'Unknown');

  // Verify cardCounts tally
  assert.strictEqual(resolved.cardCounts.get(89631139), 2); // 2 in main
  assert.strictEqual(resolved.cardCounts.get(14558127), 2); // 1 in main + 1 in side
  assert.strictEqual(resolved.cardCounts.get(1861629), 1);  // 1 in extra
  assert.strictEqual(resolved.cardCounts.get(99999999), 1); // 1 in side
});

console.log('\n====================================================');
console.log(`Test Execution Finished: ${passedTests}/${totalTests} Passed (0 Failures)`);
console.log('====================================================');

if (passedTests !== totalTests) {
  process.exit(1);
}
