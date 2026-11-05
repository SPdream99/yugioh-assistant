import { getMultiMarketPrices } from './price-aggregator.js';
import { getLatestYgoNews } from '../news-rulings/ygorganization.js';
import { getDamageStepGuide, explainMechanic, getSegocGuide } from '../news-rulings/rulebook.js';

async function runTests() {
  console.log('================================================================');
  console.log('TEST 1: MULTI-MARKET CARD PRICING (TCGPlayer, Yuyu-tei, TCGCorner)');
  console.log('================================================================');

  const cardToTest = 'Ash Blossom & Joyous Spring';
  console.log(`Querying multi-market prices for: "${cardToTest}"...`);
  const priceReport = await getMultiMarketPrices(cardToTest, 14558127);

  console.log(`Card: ${priceReport.cardName} (Passcode: ${priceReport.passcode})`);
  console.log(`Timestamp: ${priceReport.timestamp}`);
  console.log('Summary:', JSON.stringify(priceReport.summary, null, 2));
  console.log(`Total Quotes Received: ${priceReport.quotes.length}`);
  priceReport.quotes.forEach((q, idx) => {
    console.log(`  [Quote #${idx + 1}] Platform: ${q.platform} | Currency: ${q.currency} | Price: ${q.price} | Rarity: ${q.rarity || 'N/A'}`);
    console.log(`    URL: ${q.url}`);
    if (q.details) console.log(`    Details: ${q.details}`);
  });

  console.log('\n================================================================');
  console.log('TEST 2: YORGANIZATION RSS NEWS & SPOILER ENGINE');
  console.log('================================================================');

  console.log('Fetching latest Yu-Gi-Oh! news articles...');
  const news = await getLatestYgoNews(5);
  console.log(`Retrieved ${news.length} articles:`);
  news.forEach((item, idx) => {
    console.log(`\nArticle #${idx + 1}: ${item.title}`);
    console.log(`  Link: ${item.link}`);
    console.log(`  Published: ${item.pubDate}`);
    console.log(`  Is Card Reveal: ${item.isCardReveal ? 'YES [NEW CARD/SET]' : 'NO [NEWS/RULING]'}`);
    console.log(`  Snippet: ${item.snippet.slice(0, 120)}...`);
  });

  console.log('\n================================================================');
  console.log('TEST 3: OFFICIAL RULEBOOK & MECHANICS ENGINE');
  console.log('================================================================');

  const damageStep = getDamageStepGuide();
  console.log('Damage Step Guide (Sample First 350 chars):');
  console.log(damageStep.slice(0, 350) + '...\n');

  const costVsEffect = explainMechanic('cost vs effect');
  console.log('Mechanic Explanation: "cost vs effect":');
  console.log(costVsEffect);

  console.log('\n================================================================');
  console.log('ALL TESTS EXECUTED SUCCESSFULLY!');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
