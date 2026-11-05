import fs from 'node:fs';
import path from 'node:path';
import { parseYuyuteiHtml } from './core/pricing/yuyutei.js';
import { isSamePrintingName } from './core/pricing/printing-prices.js';
import { isSameCardTitle } from './core/pricing/tcgcorner.js';
import { parseKonamiRecipe, mapCombo, mapCounter } from './core/deck-community/community-decks.js';
import { parseYdk } from './core/deck-parser/ydk.js';

/**
 * Offline contract tests for the HTML/JSON parsers.
 *
 * These run against recorded responses in test/fixtures/ so a source changing
 * its markup fails CI loudly instead of returning a plausible wrong number.
 * Refresh with: node scripts/capture-fixtures.mjs
 */

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`ok - ${message}`);
}

function fixture(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'test', 'fixtures', name), 'utf8');
}

function run() {
  console.log('=== YUYU-TEI ===');
  const yuyu = fixture('yuyutei-alpha.html');
  const quotes = parseYuyuteiHtml(yuyu, 'Alpha', 'Alpha');
  console.log(quotes.slice(0, 3).map(q => `${q.price} JPY ${q.rarity} ${q.details}`).join('\n'));
  assert(quotes.length > 0, 'Yuyu-tei fixture yields matching listings');
  assert(quotes.every(q => q.price > 0 && q.currency === 'JPY'), 'prices are positive JPY');
  assert(quotes.every(q => /Alpha/.test(String(q.details))), 'only the requested card is accepted');

  const wrongCard = parseYuyuteiHtml(yuyu, 'Beta', 'Beta');
  assert(wrongCard.length === 0, 'a non-matching title produces no quote (no invented price)');

  console.log('\n=== KONAMI RECIPE ===');
  const recipe = parseKonamiRecipe(fixture('konami-recipe.html'));
  console.log(`main=${recipe.main.length} extra=${recipe.extra.length} side=${recipe.side.length}`);
  assert(recipe.main.length === 40, 'main deck count is parsed exactly');
  assert(recipe.extra.length === 15 && recipe.side.length === 7, 'extra and side decks are parsed');
  assert(recipe.main.includes('Alpha'), 'HTML entities are decoded');
  assert(!recipe.main.some(n => /^&/.test(n)), 'no raw entities leak into card names');

  console.log('\n=== TCGCSV PER-PRINTING ===');
  const tcg = JSON.parse(fixture('tcgcsv-alpha.json'));
  const matched = tcg.products.filter((p: any) => isSamePrintingName('Alpha', p.name));
  const rarities = matched.map((p: any) => (p.extendedData || []).find((e: any) => e.name === 'Rarity')?.value);
  console.log('matched rarities:', rarities.join(', '));
  assert(matched.length >= 3, 'variant printings "(UR)" / "(Secret Rare)" are matched');
  assert(new Set(rarities).size >= 3, 'each variant keeps its own rarity');
  assert(!isSamePrintingName('Alpha', 'Alpha Girl'), 'a longer card name is not a variant');
  assert(isSamePrintingName('Alpha', 'Alpha (UR)'), 'a parenthesised variant is accepted');

  const priced = matched.filter((p: any) => tcg.prices.some((x: any) => x.productId === p.productId && x.marketPrice > 0));
  const distinct = new Set(priced.map((p: any) => tcg.prices.find((x: any) => x.productId === p.productId)?.marketPrice));
  console.log('distinct market prices:', [...distinct].join(', '));
  assert(distinct.size >= 2, 'different rarities carry different market prices');

  console.log('\n=== TCGCORNER ===');
  const corner = JSON.parse(fixture('tcgcorner-suggest.json'));
  const cornerMatches = corner.products.filter((p: any) => isSameCardTitle(p.title, 'Alpha'));
  console.log('matched products:', cornerMatches.map((p: any) => p.title).join(' | ') || 'none');
  assert(corner.products.length > 0, 'fixture contains products');
  assert(!isSameCardTitle('Plush Toy', 'Alpha'), 'unrelated store products are rejected');
  assert(isSameCardTitle('Alpha (TST-001)', 'Alpha'), 'a real listing title is accepted');

  console.log('\n=== FORMAT LIBRARY ===');
  const fl = JSON.parse(fixture('formatlibrary-deck.json'));
  const deck = parseYdk(fl.ydk);
  console.log(`main=${deck.main.length} extra=${deck.extra.length} side=${deck.side.length}`);
  assert(deck.main.length >= 40, 'the fixture ydk parses into a real main deck');
  assert(deck.main.every(id => typeof id === 'number' && id > 0), 'ydk entries are passcodes');

  console.log('\n=== MASTER DUEL META COMBOS / COUNTERS ===');
  const combos = JSON.parse(fixture('mdm-combos.json'));
  const combo = mapCombo(combos[0], 'https://www.masterduelmeta.com/api/v1/combos');
  console.log(combo.title, '| steps:', combo.steps.length, '| starters:', combo.startingCards.join(', '));
  assert(combo.steps.length > 0, 'a combo fixture maps to ordered steps');
  assert(combo.startingCards.length > 0, 'a combo fixture lists its starting cards');
  assert(combo.url.startsWith('https://www.masterduelmeta.com/'), 'a combo carries a source URL');

  const counters = JSON.parse(fixture('mdm-counters.json'));
  const counter = mapCounter(counters[0], 'https://www.masterduelmeta.com/combos-and-counters');
  console.log(counter.archetype, '| counters:', counter.counterCards.map(c => `${c.name}(${c.impact})`).join(', '));
  assert(counter.counterCards.length > 0, 'a counter fixture maps to counter cards');
  assert(typeof counter.upvotes === 'number', 'upvotes are a count, not a raw id array');
  assert(counter.url.endsWith('#counters'), 'a counter links to the counters section');

  console.log('\nAll fixture checks passed.');
}

try {
  run();
} catch (error) {
  console.error('Fixture test failed:', error);
  process.exit(1);
}
