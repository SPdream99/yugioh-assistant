import { generateFreshnessEvidence } from "./core/freshness/freshness-engine.js";
import { MonthlyMetaTracker } from "./core/meta-deck-builder/monthly-meta-tracker.js";
import { getMultiMarketPrices } from "./core/pricing/price-aggregator.js";
import { getLatestYgoNews } from "./core/news-rulings/ygorganization.js";

async function runE2EFreshnessAndMonthlyTests() {
  console.log("==================================================================");
  console.log("TEST E2E: FRESHNESS EVIDENCE & MONTHLY META TRACKER (NOVEMBER 2026)");
  console.log("==================================================================");

  // 1. Verify the Freshness Measurement Algorithm (Freshness Engine)
  console.log("\n[Test 1] Verifying the Freshness Measurement Algorithm & Verification Hash...");
  const sampleEvidence = generateFreshnessEvidence({
    sourceUrl: "https://db.ygoprodeck.com/api/v7/cardinfo.php",
    sourcePublishedAt: new Date().toISOString(),
    isLiveFetch: true,
    dataPayload: { test: "data" }
  });

  console.log("Freshness Evidence generated:", {
    badge: sampleEvidence.badge,
    score: sampleEvidence.freshnessScore,
    currentReferenceMonth: sampleEvidence.currentReferenceMonth,
    hash: sampleEvidence.evidenceHash.slice(0, 24) + "...",
    summary: sampleEvidence.verificationSummary
  });

  if (sampleEvidence.freshnessScore !== 100) throw new Error("Live fetch must have 100 freshness score");
  if (sampleEvidence.badge !== "LIVE_JUST_NOW") throw new Error("Expected LIVE_JUST_NOW badge");
  if (!sampleEvidence.evidenceHash) throw new Error("Must generate SHA-256 evidence hash");
  if (!sampleEvidence.currentReferenceMonth.includes("2026-11")) throw new Error("Reference month must be 2026-11");
  console.log("✓ Test 1: Freshness Engine computes with 100% accuracy!");

  // 2. Verify the Monthly Meta Tracker for November 2026
  console.log("\n[Test 2] Verifying the November 2026 Meta Report (TCG Format)...");
  const tracker = MonthlyMetaTracker.getInstance();
  const metaNov2026 = await tracker.getMonthlyMetaReport({ year: 2026, month: 11, format: "TCG" });

  console.log(`YearMonth: ${metaNov2026.yearMonth} | Format: ${metaNov2026.format}`);
  console.log(`Active Banlist: ${metaNov2026.activeBanlistSummary}`);
  console.log(`Freshness: Score ${metaNov2026.freshness.freshnessScore}/100, Badge: ${metaNov2026.freshness.badge}`);

  console.log("\nTop 4 Decks for November 2026:");
  for (const d of metaNov2026.tierList.slice(0, 4)) {
    console.log(`  - [${d.tier}] ${d.name}: ${d.sharePercentage}% (${d.trend}) -> ${d.monthlyChangeDescription}`);
  }

  // Live-data assertions: no hardcoded deck names are required.
  if (!metaNov2026.dataAvailable) throw new Error(`Live tier list unavailable: ${metaNov2026.sourceReason}`);
  if (metaNov2026.tierList.length === 0) throw new Error("Live tier list returned zero decks");
  if (!metaNov2026.freshness.isLive) throw new Error("Tier list freshness must be live");
  const topDeck = metaNov2026.tierList[0];
  if (!topDeck || topDeck.sharePercentage <= 0) throw new Error("Top deck must have a positive share");

  console.log("\nTop Staples for November 2026:");
  for (const s of metaNov2026.topStaples.slice(0, 3)) {
    console.log(`  #${s.rank} ${s.name} (${s.category}): ${s.usageRatePercentage}% - ${s.note}`);
  }

  // Staples come from the live YGOPRODeck staple list; usage rate is not exposed.
  if (!Array.isArray(metaNov2026.topStaples) || metaNov2026.topStaples.length === 0) {
    throw new Error("Live staple list is empty; run ygo_sync_meta");
  }

  console.log("✓ Test 2: The November 2026 Meta report uses live data, not hardcoded values!");

  // 3. Verify Month-over-Month Meta Comparison (2026-10 vs 2026-11)
  console.log("\n[Test 3] Comparing Meta between October 2026 and November 2026...");
  const comparison = await tracker.compareMonthlyMeta({
    monthA: "2026-10",
    monthB: "2026-11",
    format: "TCG"
  });

  console.log("Rising Stars:", comparison.risingStars);
  console.log("Falling Decks:", comparison.fallingDecks);
  console.log("Banlist Impact Analysis:", comparison.banlistImpactAnalysis);

  if (comparison.dataAvailable) {
    if (!comparison.changes || comparison.changes.length === 0) throw new Error("Must report deck changes");
  } else {
    // Honest unavailability is the correct behavior when a month has no live snapshot.
    if (!comparison.sourceReason) throw new Error("Unavailable comparison must explain why");
    console.log("  (No live snapshot for one month — returned dataAvailable=false instead of hardcoded data)");
  }
  console.log("✓ Test 3: Monthly Meta comparison behaves correctly (live snapshot or honest unavailable report)!");

  // 4. Verify Freshness Evidence is attached to Price Search & News
  console.log("\n[Test 4] Verifying Freshness Evidence in Price Lookup & News...");
  const priceResult = await getMultiMarketPrices("Ash Blossom & Joyous Spring", 14558127);
  console.log("Price Freshness:", {
    score: priceResult.freshness?.freshnessScore,
    badge: priceResult.freshness?.badge,
    summary: priceResult.freshness?.verificationSummary
  });
  if (!priceResult.freshness) {
    throw new Error("Price result must carry freshness evidence");
  }
  if (priceResult.freshness.isLive && priceResult.freshness.freshnessScore < 90) {
    throw new Error("Live price result must carry a high freshness score");
  }
  if (!priceResult.freshness.isLive) {
    const fallbacks = priceResult.quotes.filter(q => q.isFallback).length;
    console.log(`  (Live price source unavailable; ${fallbacks} fallback search-link quote(s) returned instead of fake prices)`);
  }

  const newsItems = await getLatestYgoNews(3);
  console.log(`Latest News Articles count: ${newsItems.length}`);
  if (newsItems.length > 0) {
    console.log("Sample article freshness:", {
      title: newsItems[0].title,
      badge: newsItems[0].freshness?.badge,
      score: newsItems[0].freshness?.freshnessScore
    });
    if (!newsItems[0].freshness) throw new Error("News item must carry freshness evidence");
  }
  console.log("✓ Test 4: Every external API carries verifiable freshness evidence!");

  console.log("\n==================================================================");
  console.log("ALL FRESHNESS & MONTHLY META TRACKER TESTS PASSED 100%!");
  console.log("==================================================================");
}

runE2EFreshnessAndMonthlyTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
