import fs from 'node:fs';
import path from 'node:path';
import type { DeckData } from './types/deck.js';
import { findSynergyAndSearchers } from './core/card-database/combo-finder.js';
import { parseYdk, formatYdk, validateDeck } from './core/deck-parser/ydk.js';
import { parseYdke, formatYdke } from './core/deck-parser/ydke.js';
import { analyzeCardMechanics, judgeInteraction } from './core/card-scripts/judge-engine.js';
import { buildCompetitiveDeck } from './core/meta-deck-builder/deck-synthesizer.js';
import { registerCustomCard, migrateTempId, getCustomCard } from './core/custom-cards/registry.js';
import { getMultiMarketPrices } from './core/pricing/price-aggregator.js';
import { getFastEffectTimingGuide } from './core/news-rulings/rulebook.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED]: ${message}`);
  }
}

async function runE2ETests(): Promise<void> {
  console.log('================================================================');
  console.log('YU-GI-OH! ASSISTANT COMPREHENSIVE END-TO-END TEST SUITE');
  console.log('================================================================\n');

  // ============================================================================
  // TEST 1: The User's Exact Prompt (Branded Despia & Spellcaster 1850 ATK Synergy)
  // ============================================================================
  console.log('>>> [Test 1] The User\'s Exact Prompt: Branded Synergy & Searchers');
  {
    // Simulate Branded deck with passcodes
    const brandedDeck: DeckData = {
      name: 'Branded Despia Deck',
      main: [
        61245789, // Aluber the Jester of Despia
        32603893, // Fallen of Albaz
        44146295, // Branded Fusion
        78942511  // Branded Opening
      ],
      extra: [
        8730435,  // Albion the Branded Dragon
        44097050  // Mirrorjade the Iceblade Dragon
      ],
      side: []
    };

    console.log('Simulating Branded deck with passcodes:');
    console.log('  Main:', brandedDeck.main);
    console.log('  Extra:', brandedDeck.extra);

    const synergyResult = await findSynergyAndSearchers({
      filter: { race: 'Spellcaster', atk: 1850 },
      desiredPayoff: 'disruption',
      deck: brandedDeck
    });

    console.log(`Detected Engines: ${synergyResult.deckEnginesDetected.join(', ')}`);
    console.log(`Found ${synergyResult.matchedCards.length} matched card(s).`);

    // 1. Verify it finds Fairy Tail - Snow and Fairy Tail - Luna
    const snowCandidate = synergyResult.matchedCards.find(c => c.card.name === 'Fairy Tail - Snow');
    const lunaCandidate = synergyResult.matchedCards.find(c => c.card.name === 'Fairy Tail - Luna');

    assert(!!snowCandidate, 'Must find "Fairy Tail - Snow" in matchedCards');
    assert(!!lunaCandidate, 'Must find "Fairy Tail - Luna" in matchedCards');
    console.log('  ✓ Found "Fairy Tail - Snow" and "Fairy Tail - Luna"');

    // 2. Verify it identifies that Branded Fusion is IN THE DECK and can send Snow directly from Deck to GY
    const inDeckSearchers = snowCandidate!.searchPathway.inDeckSearchers;
    const brandedFusionSearcher = inDeckSearchers.find(s => s.searcherName === 'Branded Fusion');

    assert(!!brandedFusionSearcher, 'Must identify "Branded Fusion" in inDeckSearchers');
    assert(brandedFusionSearcher!.directAccess === true, 'Branded Fusion must be flagged with directAccess: true');
    assert(
      brandedFusionSearcher!.method.toLowerCase().includes('deck to gy') ||
      brandedFusionSearcher!.details.toLowerCase().includes('directly into the gy') ||
      brandedFusionSearcher!.details.toLowerCase().includes('from your deck to summon "albion'),
      'Branded Fusion details must explain sending Snow from Deck to GY as Fusion Material for Albion'
    );
    console.log('  ✓ Identified "Branded Fusion" IN THE DECK (Direct Access: Deck -> GY for Albion)');

    // 3. Verify it provides the step-by-step combo sequence
    const comboSteps = snowCandidate!.comboSteps;
    assert(Array.isArray(comboSteps) && comboSteps.length >= 4, 'Must provide detailed combo steps');
    const comboText = comboSteps.join(' ');
    assert(
      comboText.includes('Aluber') &&
      comboText.includes('Branded Fusion') &&
      comboText.includes('Albion') &&
      comboText.includes('Mirrorjade') &&
      comboText.includes('Snow'),
      'Combo steps must detail the Aluber -> Branded Fusion -> Albion -> Mirrorjade -> Snow line'
    );
    console.log(`  ✓ Step-by-step combo sequence provided (${comboSteps.length} steps)`);

    // 4. Verify it suggests Secret Village of the Spellcasters
    const recs = snowCandidate!.recommendedAdditions;
    const hasSecretVillage = recs.some(r => r.cardName === 'Secret Village of the Spellcasters');
    assert(hasSecretVillage, 'Must recommend "Secret Village of the Spellcasters" as floodgate synergy');
    console.log('  ✓ Suggested "Secret Village of the Spellcasters" as payoff recommendation');
  }
  console.log('✓ [Test 1 PASSED]\n');

  // ============================================================================
  // TEST 2: YDK & YDKE Roundtrip
  // ============================================================================
  console.log('>>> [Test 2] YDK & YDKE Lossless Roundtrip Encoding/Decoding');
  {
    const sampleDeck: DeckData = {
      name: 'E2E Roundtrip Test Deck',
      main: [
        61245789, 61245789, 61245789, // Aluber
        32603893, 32603893, 32603893, // Fallen of Albaz
        44146295,                     // Branded Fusion
        78942511, 78942511, 78942511, // Branded Opening
        14558127, 14558127, 14558127, // Ash Blossom
        10045474, 10045474, 10045474, // Infinite Impermanence
        24299458, 24299458, 24299458, // Forbidden Droplet
        6007213,  6007213,  6007213,  // Mulcharmy Fuwalos
        55623480,                     // Fairy Tail - Snow
        7902349,                      // Fairy Tail - Luna
        72302403,                     // Secret Village of the Spellcasters
        88453933, 88453933, 88453933, // Triple Tactics Thrust
        44095762, 44095762, 44095762, // Triple Tactics Talent (3)
        24224830,                     // Called by the Grave
        48130397, 48130397, 48130397, // Super Polymerization
        18144506,                     // Harpie's Feather Duster
        81439173,                     // Foolish Burial
        40640057,                     // Spirit Charmers
        38668704,                     // Despian Tragedy
        28865322                      // Grand Spiritual Art - Ichirin
      ],
      extra: [
        8730435,  8730435,  // Albion the Branded Dragon
        44097050, 44097050, // Mirrorjade the Iceblade Dragon
        49814180,           // Lubellion the Searing Dragon (1)
        74997493,           // Granguignol the Dusk Dragon
        29301450,           // S:P Little Knight
        83965310,           // Super Starslayer TY-PHON
        73580471,           // Promethean Princess
        65741786,           // I:P Masquerena
        86066372,           // Accesscode Talker
        66506689,           // Mudragon of the Swamp
        41209827,           // Garura
        74586817,           // Starving Venom Fusion Dragon
        10002346            // Guardian Chimera
      ],
      side: [
        91800273, 91800273, 91800273, // Dimension Shifter
        15693423, 15693423, 15693423, // Evenly Matched
        86327225, 86327225, 86327225, // Dark Ruler No More
        94145021, 94145021, 94145021, // Droll & Lock Bird
        27204311, 27204311, 27204311  // Nibiru
      ]
    };

    console.log(`Original Deck: ${sampleDeck.main.length} Main, ${sampleDeck.extra.length} Extra, ${sampleDeck.side.length} Side`);

    // Step 1: Encode DeckData -> YDKE
    const ydkeUrl = formatYdke(sampleDeck);
    assert(ydkeUrl.startsWith('ydke://'), 'YDKE URL must start with ydke://');
    console.log(`  YDKE String: ${ydkeUrl.slice(0, 45)}...`);

    // Step 2: Decode YDKE -> DeckData
    const decodedFromYdke = parseYdke(ydkeUrl, sampleDeck.name);
    assert(decodedFromYdke.main.length === sampleDeck.main.length, 'YDKE decoded main deck size must match');
    assert(decodedFromYdke.extra.length === sampleDeck.extra.length, 'YDKE decoded extra deck size must match');
    assert(decodedFromYdke.side.length === sampleDeck.side.length, 'YDKE decoded side deck size must match');

    // Step 3: Export DeckData -> YDK text
    const ydkContent = formatYdk(decodedFromYdke);
    assert(ydkContent.includes('#main') && ydkContent.includes('#extra') && ydkContent.includes('!side'), 'YDK must include standard sections');

    // Step 4: Parse YDK text -> DeckData
    const decodedFromYdk = parseYdk(ydkContent, sampleDeck.name);

    // Step 5: 100% Passcode verification across all 3 sections
    const comparePasscodes = (actual: number[], expected: number[], sectionName: string) => {
      assert(actual.length === expected.length, `${sectionName} size mismatch: got ${actual.length}, expected ${expected.length}`);
      for (let i = 0; i < actual.length; i++) {
        assert(actual[i] === expected[i], `${sectionName}[${i}] passcode mismatch: got ${actual[i]}, expected ${expected[i]}`);
      }
    };

    comparePasscodes(decodedFromYdk.main as number[], sampleDeck.main as number[], 'Main Deck');
    comparePasscodes(decodedFromYdk.extra as number[], sampleDeck.extra as number[], 'Extra Deck');
    comparePasscodes(decodedFromYdk.side as number[], sampleDeck.side as number[], 'Side Deck');

    console.log('  ✓ 100% Match: Main (40), Extra (15), Side (15) passcodes identical after YDKE and YDK roundtrip');

    const validation = validateDeck(decodedFromYdk);
    assert(validation.valid, `Deck validation should pass: ${validation.errors.join(', ')}`);
    console.log('  ✓ Official Deck Validation: Valid');
  }
  console.log('✓ [Test 2 PASSED]\n');

  // ============================================================================
  // TEST 3: Judge Engine with Lua script (Ash Blossom & Baronne de Fleur)
  // ============================================================================
  console.log('>>> [Test 3] Judge Engine with ocgcore Lua Analysis');
  {
    const ashPasscode = 14558127;
    const ashAnalysis = await analyzeCardMechanics(ashPasscode, 'Ash Blossom & Joyous Spring');

    console.log(`Analyzed Mechanics for: ${ashAnalysis.cardName} (${ashAnalysis.passcode})`);
    console.log(`  Lua Source Available: ${ashAnalysis.luaSourceAvailable}`);
    console.log(`  Effects Count: ${ashAnalysis.effects.length}`);

    // 1. Verify HOPT analysis
    const hasHopt = ashAnalysis.effects.some(e => e.isHOPT);
    assert(hasHopt, 'Ash Blossom must be classified as Hard Once Per Turn (HOPT)');
    console.log('  ✓ Correctly identified HOPT count limit restriction (e:SetCountLimit(1, id))');

    // 2. Verify Discard as Cost analysis
    assert(ashAnalysis.costProperties.hasCost === true, 'Ash Blossom must have activation cost');
    const hasDiscardCost = ashAnalysis.costProperties.costDetails.some(d =>
      d.toLowerCase().includes('discard') || d.toLowerCase().includes('bỏ')
    );
    assert(hasDiscardCost, 'Ash Blossom cost must be recognized as discard (Cost.SelfDiscard)');
    console.log('  ✓ Correctly identified discard as cost (Cost.SelfDiscard before semicolon)');

    // 3. Verify Effect Negation vs Activation Negation
    assert(ashAnalysis.negationProperties.negatesEffect === true, 'Ash Blossom must negate EFFECT (CATEGORY_DISABLE)');
    assert(ashAnalysis.negationProperties.negatesActivation === false, 'Ash Blossom does NOT negate activation');
    console.log('  ✓ Correctly categorized as Negate Effect (CATEGORY_DISABLE), NOT Negate Activation');

    // 4. Test judgeInteraction between Baronne de Fleur and Ash Blossom
    const adjudication = await judgeInteraction(
      'Baronne de Fleur',
      'Ash Blossom & Joyous Spring',
      'If Baronne de Fleur negates the activation of Ash Blossom, can another Ash Blossom be activated?'
    );

    assert(adjudication.includes('FINAL JUDGE VERDICT'), 'Must return formatted judge adjudication');
    assert(
      adjudication.includes('negating the ACTIVATION') || adjudication.includes('Negate Activation'),
      'Must explain negate activation mechanics'
    );
    assert(
      adjudication.toLowerCase().includes('negating the effect'),
      'Must explain negate effect mechanics'
    );
    console.log('  ✓ Judge interaction between Baronne de Fleur and Ash Blossom generated with full ruling distinction');
  }
  console.log('✓ [Test 3 PASSED]\n');

  // ============================================================================
  // TEST 4: Competitive Meta Deck Builder (Tenpai Dragon TCG)
  // ============================================================================
  console.log('>>> [Test 4] Competitive Meta Deck Builder');
  {
    const buildResult = await buildCompetitiveDeck({
      archetype: 'Tenpai Dragon',
      format: 'TCG'
    });

    const deck = buildResult.deck;
    console.log(`Generated Deck: "${deck.name}"`);
    console.log(`  Main: ${deck.main.length} cards`);
    console.log(`  Extra: ${deck.extra.length} cards`);
    console.log(`  Side: ${deck.side.length} cards`);

    // 1. Verify 40 Main, 15 Extra, 15 Side
    assert(deck.main.length === 40, `Main deck must have exactly 40 cards, got ${deck.main.length}`);
    assert(deck.extra.length === 15, `Extra deck must have exactly 15 cards, got ${deck.extra.length}`);
    assert(deck.side.length === 15, `Side deck must have exactly 15 cards, got ${deck.side.length}`);
    console.log('  ✓ Exact Deck Dimensions: 40 Main, 15 Extra, 15 Side');

    // 2. Verify modern staples included
    const spLittleKnightPasscode = 29301450;
    const fuwalosPasscode = 6007213;
    const dropletPasscode = 24299458;
    const ashPasscode = 14558127;
    const impermPasscode = 10045474;

    const hasSP = deck.extra.includes(spLittleKnightPasscode);
    const hasFuwalos = deck.main.includes(fuwalosPasscode);
    const hasDroplet = deck.main.includes(dropletPasscode) || deck.side.includes(dropletPasscode);
    const hasAsh = deck.main.includes(ashPasscode);
    const hasImperm = deck.main.includes(impermPasscode);

    assert(hasSP, 'Must include S:P Little Knight in Extra Deck');
    assert(hasFuwalos, 'Must include Mulcharmy Fuwalos in Main Deck');
    assert(hasDroplet, 'Must include Forbidden Droplet in Main or Side Deck');
    assert(hasAsh, 'Must include Ash Blossom & Joyous Spring in Main Deck');
    assert(hasImperm, 'Must include Infinite Impermanence in Main Deck');
    console.log('  ✓ Modern staples verified: S:P Little Knight, Mulcharmy Fuwalos, Forbidden Droplet, Ash Blossom, Imperm');

    // 3. Verify valid YDK
    assert(typeof buildResult.ydk === 'string' && buildResult.ydk.includes('#main'), 'Must generate valid YDK string');
    const parsedYdk = parseYdk(buildResult.ydk);
    assert(parsedYdk.main.length === 40, 'Parsed YDK must have 40 main cards');
    assert(parsedYdk.extra.length === 15, 'Parsed YDK must have 15 extra cards');
    console.log('  ✓ Valid YDK export generated');

    // 4. Verify valid YDKE
    assert(typeof buildResult.ydke === 'string' && buildResult.ydke.startsWith('ydke://'), 'Must generate valid YDKE string');
    const parsedYdke = parseYdke(buildResult.ydke);
    assert(parsedYdke.main.length === 40, 'Parsed YDKE must decode 40 main cards');
    assert(parsedYdke.extra.length === 15, 'Parsed YDKE must decode 15 extra cards');
    console.log('  ✓ Valid YDKE URL generated');
  }
  console.log('✓ [Test 4 PASSED]\n');

  // ============================================================================
  // TEST 5: Custom Card Lifecycle (Registration, Lua, SVG Art, and Migration)
  // ============================================================================
  console.log('>>> [Test 5] Custom Card Full Lifecycle');
  {
    const cardName = 'Void Charmer';
    const cwd = process.cwd();

    // 1. Register a new custom card "Void Charmer" (1850 ATK Spellcaster)
    const registered = registerCustomCard({
      name: cardName,
      cardData: {
        type: 'Effect Monster',
        frameType: 'effect',
        race: 'Spellcaster',
        attribute: 'DARK',
        atk: 1850,
        def: 1500,
        level: 4,
        archetype: 'Charmer',
        desc: 'You can Special Summon this card (from your hand) by sending 1 Spellcaster monster from your hand or field to the GY. If this card is Normal or Special Summoned: You can add 1 "Charmer" or "Familiar-Possessed" Spell/Trap from your Deck to your hand.'
      }
    });

    console.log(`Registered custom card: "${registered.name}"`);
    console.log(`  Assigned Temp ID: ${registered.tempId}`);
    console.log(`  Status: ${registered.status}`);

    // Verify assigned tempId >= 990000001
    assert(registered.tempId >= 990000001, `Temp ID must be >= 990000001, got ${registered.tempId}`);
    console.log('  ✓ Assigned tempId >= 990000001');

    // Verify generated Lua script file in data/custom_cards/
    const expectedLuaFile = path.resolve(cwd, `data/custom_cards/c${registered.tempId}.lua`);
    assert(fs.existsSync(expectedLuaFile), `Generated Lua script file must exist at ${expectedLuaFile}`);
    const luaContent = fs.readFileSync(expectedLuaFile, 'utf-8');
    assert(luaContent.includes(String(registered.tempId)), 'Lua script must include assigned tempId');
    assert(luaContent.includes('Void Charmer'), 'Lua script must include card name');
    console.log(`  ✓ Generated Lua script confirmed at: data/custom_cards/c${registered.tempId}.lua`);

    // Verify generated SVG art in data/rendered_cards/
    const expectedSvgFile = path.resolve(cwd, `data/rendered_cards/${registered.tempId}.svg`);
    assert(fs.existsSync(expectedSvgFile), `Generated SVG art must exist at ${expectedSvgFile}`);
    const svgContent = fs.readFileSync(expectedSvgFile, 'utf-8');
    assert(svgContent.includes('Void Charmer'), 'SVG art must include card name text');
    assert(svgContent.includes('1850'), 'SVG art must include 1850 ATK text');
    console.log(`  ✓ Generated SVG card artwork confirmed at: data/rendered_cards/${registered.tempId}.svg`);

    // 2. Migrate the card to official ID 87654321
    const officialId = 87654321;
    console.log(`Migrating card from temp ID ${registered.tempId} to official ID ${officialId}...`);
    const migration = migrateTempId(registered.tempId, officialId);

    assert(migration.success, `Migration failed: ${migration.message}`);
    assert(migration.oldId === registered.tempId, 'Old ID should match tempId');
    assert(migration.newId === officialId, 'New ID should match officialId');

    // Verify script is updated
    const migratedLuaFile = path.resolve(cwd, `data/custom_cards/c${officialId}.lua`);
    assert(fs.existsSync(migratedLuaFile), `Migrated Lua script must exist at ${migratedLuaFile}`);
    const migratedLuaContent = fs.readFileSync(migratedLuaFile, 'utf-8');
    assert(migratedLuaContent.includes(String(officialId)), 'Migrated Lua script must reference official ID');
    console.log(`  ✓ Migrated Lua script confirmed at: data/custom_cards/c${officialId}.lua`);

    // Verify status is 'migrated'
    const updatedRecord = getCustomCard(officialId);
    assert(!!updatedRecord, 'Card must be retrievable by official ID');
    assert(updatedRecord!.status === 'migrated', `Status must be "migrated", got "${updatedRecord!.status}"`);
    assert(updatedRecord!.officialId === officialId, 'Official ID must be stored in registry record');
    console.log('  ✓ Registry record status updated to "migrated" with officialId stored');
  }
  console.log('✓ [Test 5 PASSED]\n');

  // ============================================================================
  // TEST 6: Multi-Market Pricing & Rulebook News
  // ============================================================================
  console.log('>>> [Test 6] Multi-Market Pricing & Fast Effect Timing Guide');
  {
    // 1. Multi-Market Pricing
    const ashName = 'Ash Blossom & Joyous Spring';
    const ashPasscode = 14558127;
    console.log(`Fetching multi-market prices for "${ashName}" (${ashPasscode})...`);

    const priceReport = await getMultiMarketPrices(ashName, ashPasscode);
    assert(priceReport.cardName === ashName, 'Report cardName must match');
    assert(Array.isArray(priceReport.quotes), 'Quotes must be an array');
    assert(priceReport.quotes.length > 0, 'Quotes must contain at least 1 entry');

    // Verify quotes for TCGPlayer, Yuyu-tei, and TCGCorner
    const hasTcgPlayer = priceReport.quotes.some(q => q.platform === 'TCGPlayer');
    const hasYuyutei = priceReport.quotes.some(q => q.platform === 'Yuyu-tei');
    const hasTcgCorner = priceReport.quotes.some(q => q.platform === 'TCGCorner');

    assert(hasTcgPlayer, 'Must include TCGPlayer quote');
    assert(hasYuyutei, 'Must include Yuyu-tei quote');
    assert(hasTcgCorner, 'Must include TCGCorner quote');
    console.log('  ✓ Multi-market quotes verified for: TCGPlayer, Yuyu-tei, TCGCorner');
    console.log(`    - TCGPlayer Summary: ${priceReport.summary.enTcg}`);
    console.log(`    - Yuyu-tei Summary:   ${priceReport.summary.jpOcg}`);
    console.log(`    - TCGCorner Summary:  ${priceReport.summary.aeOcg}`);
    if (priceReport.summary.lowestUsdEquivalent) {
      console.log(`    - Lowest USD Equivalent: $${priceReport.summary.lowestUsdEquivalent}`);
    }

    // 2. Fast Effect Timing Guide
    console.log('Fetching Fast Effect Timing Guide...');
    const timingGuide = getFastEffectTimingGuide();
    assert(typeof timingGuide === 'string' && timingGuide.length > 200, 'Timing guide must be non-empty string');

    // Verify timing boxes and steps are explained
    assert(timingGuide.includes('BOX A: OPEN GAME STATE'), 'Must explain Box A (Open Game State)');
    assert(timingGuide.includes('BOX B: TURN PLAYER FAST EFFECT WINDOW'), 'Must explain Box B (Turn Player Fast Effect)');
    assert(timingGuide.includes('BOX C: OPPONENT FAST EFFECT WINDOW'), 'Must explain Box C (Opponent Fast Effect)');
    assert(timingGuide.includes('TRIGGER EFFECTS'), 'Must explain Trigger Effects / Yellow Box');
    assert(timingGuide.includes('CHAIN RESOLUTION'), 'Must explain Chain Resolution');
    console.log('  ✓ Timing guide verified: Explains Box A, Box B, Box C, Trigger Effects, and Chain Resolution');
  }
  console.log('✓ [Test 6 PASSED]\n');

  console.log('================================================================');
  console.log('ALL 6 END-TO-END TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================');
}

runE2ETests().catch((err: any) => {
  console.error('\n❌ E2E TEST SUITE RUNTIME ERROR:', err);
  process.exit(1);
});
