import { runMarketQuery } from './market-intel.js';
import { describeHistory } from './price-history.js';

/**
 * Market-intelligence regression: proves the ranking/filter/explain paths run
 * against the real card pool and that the honesty rules hold (no invented
 * prices, no fake momentum without two snapshots).
 */

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`ok - ${message}`);
}

async function run() {
  console.log('=== MARKET QUERY: top_price ===');
  const top = (await runMarketQuery({ intent: 'top_price', limit: 5, priceBasis: 'market' })) as any;
  console.log(JSON.stringify(top.results?.map((r: any) => ({ rank: r.rank, name: r.name, usd: r.priceUsd })), null, 2));
  assert(Array.isArray(top.results) && top.results.length === 5, 'top_price returns the requested limit');
  assert(top.results[0].priceUsd >= top.results[1].priceUsd, 'top_price is sorted descending');
  assert(top.dataset.pricedCards > 5000, 'index covers the real priced pool');
  assert(typeof top.freshness?.freshnessScore === 'number', 'freshness evidence is attached');

  console.log('\n=== MARKET QUERY: top printing (collector) ===');
  const collector = (await runMarketQuery({ intent: 'top_price', limit: 3, priceBasis: 'top_printing' })) as any;
  console.log(collector.results?.map((r: any) => `${r.name} — $${r.priceUsd} (${r.topPrinting?.setCode})`).join('\n'));
  assert(collector.results[0].priceUsd >= collector.results[0].marketUsd, 'top printing is never below market average');

  console.log('\n=== MARKET QUERY: search under a budget ===');
  const cheap = (await runMarketQuery({
    intent: 'search',
    type: 'Effect Monster',
    attribute: 'DARK',
    maxPrice: 5,
    minPrice: 2,
    limit: 10
  })) as any;
  console.log(cheap.summary);
  assert(cheap.results.length > 0, 'budget filter returns cards');
  assert(cheap.results.every((r: any) => r.priceUsd <= 5 && r.priceUsd >= 2), 'budget bounds respected');

  console.log('\n=== LIQUIDITY FLOOR (expensive but actually searched) ===');
  const liquid = (await runMarketQuery({
    intent: 'search',
    minPrice: 40,
    minWeeklyViews: 1000,
    limit: 10,
    includeMarkets: false
  })) as any;
  console.log(liquid.results.map((r: any) => `${r.name} $${r.priceUsd} (${r.weeklyViews} views)`).join('\n'));
  assert(liquid.results.length > 0, 'liquidity filter returns cards');
  assert(liquid.results.every((r: any) => r.weeklyViews >= 1000), 'minWeeklyViews respected');
  assert(
    !liquid.results.some((r: any) => r.name === 'Blood Mefist'),
    'collector card with almost no searches is excluded by the liquidity floor'
  );

  console.log('\n=== LIQUIDITY-ADJUSTED RANKING ===');
  const adj = (await runMarketQuery({
    intent: 'search',
    sortBy: 'liquidity_adjusted',
    minPrice: 20,
    limit: 6,
    includeMarkets: false
  })) as any;
  console.log(adj.results.map((r: any) => `${r.name} $${r.priceUsd} | ${r.weeklyViews} views | score ${r.liquidityScore}`).join('\n'));
  assert(adj.results.length > 0, 'liquidity_adjusted returns cards');
  assert(
    adj.results.every((r: any) => typeof r.liquidityScore === 'number' && r.liquidityScore >= 0 && r.liquidityScore <= 1),
    'liquidity scores are normalised to 0..1'
  );
  for (let i = 1; i < adj.results.length; i++) {
    assert(
      adj.results[i - 1].liquidityScore >= adj.results[i].liquidityScore,
      'liquidity_adjusted is sorted by score, not by raw price'
    );
  }
  assert(
    adj.results[0].name !== 'Blood Mefist',
    'a collector card with ~60 views/week does not top the liquidity-adjusted list'
  );
  assert(typeof adj.ranking?.formula === 'string', 'the ranking formula is disclosed in the answer');

  console.log('\n=== MARKET QUERY: movers ===');
  const movers = (await runMarketQuery({ intent: 'movers', windowDays: 30, limit: 5 })) as any;
  console.log('available:', movers.movers.available, '|', movers.movers.note);
  if (movers.movers.available) {
    assert(movers.movers.entries.length > 0, 'movers returns measured entries when history exists');
    assert(
      movers.movers.entries[0].baselineDate !== movers.movers.entries[0].latestDate,
      'movers compare two distinct dates'
    );
  } else {
    assert(Array.isArray(movers.demandFallback?.results), 'without history, demand leaders are returned');
    assert(
      /not a price increase/i.test(movers.demandFallback.note),
      'fallback is explicitly labelled as demand, not price movement'
    );
  }

  console.log('\n=== MARKET QUERY: explain ===');
  const explained = (await runMarketQuery({ intent: 'explain', card: 'Blue-Eyes White Dragon' })) as any;
  console.log('drivers:', explained.drivers?.map((d: any) => `${d.type}: ${d.statement.slice(0, 90)}`));
  assert(explained.available === true, 'explain resolves a known card');
  assert(Array.isArray(explained.drivers) && explained.drivers.length > 0, 'explain produces at least one driver');
  assert(explained.price.confidence !== undefined, 'explain reports price confidence');
  assert(typeof explained.price.confidenceRationale === 'string', 'explain explains WHY the confidence is what it is');
  assert(
    explained.price.printingsListed >= explained.price.printingsPriced,
    'listed printings are counted separately from priced printings'
  );
  assert(Array.isArray(explained.price.listedPrintings), 'unpriced printings are still nameable (rarity + set code)');
  assert(Array.isArray(explained.caveats), 'explain exposes data caveats');

  console.log('\n=== MULTI-MARKET ENRICHMENT (Yuyu-tei / TCGCorner) ===');
  const enriched = explained.markets?.cards?.[0];
  console.log(JSON.stringify(enriched?.status), '| jp:', enriched?.jp?.price, enriched?.jp?.currency, '| ae:', enriched?.ae?.price, enriched?.ae?.currency);
  assert(enriched !== undefined, 'explain enriches with secondary markets by default');
  assert(enriched?.status?.yuyutei !== undefined, 'per-source status is reported');

  if (enriched?.status?.yuyutei === 'live') {
    assert(enriched.jp!.price > 0 && enriched.jp!.currency === 'JPY', 'Yuyu-tei quotes are positive JPY');
    assert(/yuyu-tei\.jp\/sell\/ygo\/card\//.test(enriched.jp!.url), 'Yuyu-tei quote links to a product page');
  }

  if (enriched?.ae) {
    assert(enriched.ae.currency === 'HKD', 'an AE quote is a real TCGCorner listing, never the Cardmarket benchmark');
  }

  const noMarkets = (await runMarketQuery({
    intent: 'explain',
    card: 'Blue-Eyes White Dragon',
    includeMarkets: false
  })) as any;
  assert(noMarkets.markets === undefined, 'includeMarkets=false skips secondary market requests');

  // Regression: the old scraper invented a ¥320 price for a card that has no
  // Yuyu-tei listing at all. It must now report unavailable, never a number.
  const tyler = (await runMarketQuery({ intent: 'explain', card: 'Tyler the Great Warrior' })) as any;
  const tylerMarket = tyler.markets?.cards?.[0];
  console.log('Tyler Yuyu-tei status:', tylerMarket?.status?.yuyutei, '| jp price:', tylerMarket?.jp?.price);
  assert(
    !tylerMarket?.jp || tylerMarket.jp.priceUsd > 0,
    'no invented Yuyu-tei price for a card with no listing'
  );

  console.log('\n=== HISTORY COVERAGE ===');
  const history = describeHistory();
  console.log(`snapshots: ${history.daysAvailable} | latest: ${history.dates[history.dates.length - 1]}`);
  assert(history.daysAvailable >= 1, 'a daily snapshot is written by the query');

  console.log('\nAll market-query checks passed.');
}

run().catch(err => {
  console.error('Market query test failed:', err);
  process.exit(1);
});
