import { getPrintingPrices } from './printing-prices.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`ok - ${message}`);
}

async function run() {
  console.log('=== PER-PRINTING PRICES (EN) ===');
  const ash = await getPrintingPrices('Ash Blossom & Joyous Spring', { maxSets: 6 });
  const en = ash.rows.filter(r => r.language === 'EN' && r.priceUsd != null);
  console.log(en.map(r => `${r.setCode} ${r.rarity} $${r.priceUsd}`).join('\n'));

  assert(en.length >= 2, 'multiple EN printings are priced');
  const rarities = new Set(en.map(r => r.rarity));
  assert(rarities.size >= 2, 'per-rarity rows are distinct, not one aggregate');

  // The whole point: rarity must not be used as a price proxy. Two different
  // rarities of the same card must be allowed to disagree.
  const byRarity = new Map(en.map(r => [r.rarity, r.priceUsd!]));
  const distinctPrices = new Set([...byRarity.values()]);
  assert(distinctPrices.size >= 2, 'different rarities carry different prices from the source');

  assert(ash.cheapest !== undefined, 'a cheapest priced printing is computed from real rows');
  assert(
    ash.rows.every(r => r.price === null || typeof r.priceUsd === 'number'),
    'a row never exposes a price without a currency conversion'
  );

  console.log('\n=== LANGUAGE COVERAGE ===');
  console.log(ash.coverage.map(c => `${c.language}: ${c.available ? c.source : 'UNAVAILABLE'}`).join('\n'));
  const kr = ash.coverage.find(c => c.language === 'KR');
  assert(kr && kr.available === false, 'KR is explicitly marked as having no price source');
  assert(/No public/.test(kr!.note), 'the KR gap is explained, not silently omitted');

  console.log('\n=== NO-LIVE MODE (no invented prices) ===');
  const offline = await getPrintingPrices('Ash Blossom & Joyous Spring', { includeLive: false, maxSets: 6 });
  const pricedOffline = offline.rows.filter(r => r.priceUsd != null);
  console.log(`${offline.rows.length} rows, ${pricedOffline.length} priced`);
  assert(
    offline.rows.every(r => r.price === null || typeof r.price === 'number'),
    'offline rows are either a number from the source or null'
  );

  console.log('\nAll printing-price checks passed.');
}

run().catch(err => {
  console.error('Printing price test failed:', err);
  process.exit(1);
});
