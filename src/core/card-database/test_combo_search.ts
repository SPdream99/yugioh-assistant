import { DeckData } from '../../types/card.js';
import { cardSearch } from './card-search.js';
import { findSynergyAndSearchers } from './combo-finder.js';

async function runTest() {
  console.log('===============================================================');
  console.log('YU-GI-OH SMART CARD SEARCH & COMBO PATHWAY ENGINE TEST');
  console.log('===============================================================\n');

  // Step 1: Test Natural Language Card Search
  console.log('--- Test 1: Natural Language Card Search ---');
  const nlQuery = 'atk:1850 race:Spellcaster monster';
  console.log(`Executing query: "${nlQuery}"`);
  const nlResults = await cardSearch(nlQuery);
  console.log(`Found ${nlResults.length} matching cards:`);
  for (const c of nlResults) {
    console.log(`  - [${c.id}] ${c.name} (${c.attribute}/${c.race}, ATK: ${c.atk}, DEF: ${c.def})`);
  }

  const foundSnow = nlResults.some(c => c.name === 'Fairy Tail - Snow');
  const foundLuna = nlResults.some(c => c.name === 'Fairy Tail - Luna');

  if (!foundSnow || !foundLuna) {
    throw new Error('Test 1 Failed: Fairy Tail - Snow or Fairy Tail - Luna was not found.');
  }
  console.log('✓ Test 1 Passed: Correctly identified Fairy Tail - Snow and Fairy Tail - Luna.\n');

  // Step 2: Test Synergy & Combo Pathway with Branded Despia Deck
  console.log('--- Test 2: Synergy & Combo Pathway Analysis (Branded Despia) ---');
  const brandedDespiaDeck: DeckData = {
    name: 'Branded Despia Meta Deck',
    main: [
      'Branded Fusion',
      'Fallen of Albaz',
      'Aluber the Jester of Despia',
      'Branded Opening',
      'Despian Tragedy',
      'Ad Libitum of Despia',
      'Branded in Red',
      'Tri-Brigade Mercourier',
      'Ash Blossom & Joyous Spring',
      'Called by the Grave'
    ],
    extra: [
      'Albion the Branded Dragon',
      'Lubellion the Searing Dragon',
      'Mirrorjade the Iceblade Dragon',
      'Guardian Chimera'
    ],
    side: []
  };

  const synergyResult = await findSynergyAndSearchers({
    filter: { type: 'Monster', atk: 1850, race: 'Spellcaster' },
    deck: brandedDespiaDeck
  });

  console.log(`Detected Engines: ${synergyResult.deckEnginesDetected.join(', ')}`);
  console.log(`Summary: ${synergyResult.summary}\n`);

  // Assert candidates
  const snowCandidate = synergyResult.matchedCards.find(c => c.card.name === 'Fairy Tail - Snow');
  if (!snowCandidate) {
    throw new Error('Test 2 Failed: Fairy Tail - Snow missing from synergy results.');
  }

  console.log(`Candidate: ${snowCandidate.card.name}`);
  console.log(`Payoff:\n  ${snowCandidate.payoff}\n`);
  console.log(`Synergy with Deck:\n  ${snowCandidate.synergyWithDeck}\n`);

  console.log('In-Deck Searchers:');
  for (const s of snowCandidate.searchPathway.inDeckSearchers) {
    console.log(`  [${s.searcherName}] (${s.method})`);
    console.log(`    Direct Access: ${s.directAccess}`);
    console.log(`    Details: ${s.details}`);
  }
  console.log('');

  console.log('Bridge Searchers / Outside Tutors:');
  for (const b of snowCandidate.searchPathway.bridgeSearchers) {
    console.log(`  [${b.bridgeName}] -> ${b.route}`);
  }
  console.log('');

  console.log('Step-by-Step Combo Sequence:');
  for (const step of snowCandidate.comboSteps) {
    console.log(`  ${step}`);
  }
  console.log('');

  console.log('Recommended Additions:');
  for (const rec of snowCandidate.recommendedAdditions) {
    console.log(`  + ${rec.cardName} (${rec.role}): ${rec.reason}`);
  }
  console.log('');

  // Verifications
  // 1. Payoff check: mentions Book of Moon or Quick-Effect disruption
  if (!snowCandidate.payoff.toLowerCase().includes('book of moon') && !snowCandidate.payoff.toLowerCase().includes('quick-effect')) {
    throw new Error('Test 2 Failed: Payoff does not mention Book of Moon / Quick-Effect disruption.');
  }

  // 2. Recognizes Branded Fusion in inDeckSearchers
  const brandedFusionInDeck = snowCandidate.searchPathway.inDeckSearchers.find(
    s => s.searcherName === 'Branded Fusion'
  );
  if (!brandedFusionInDeck) {
    throw new Error('Test 2 Failed: Branded Fusion was not recognized as an in-deck dumper.');
  }
  if (!brandedFusionInDeck.details.includes('Albion') || !brandedFusionInDeck.details.includes('LIGHT')) {
    throw new Error('Test 2 Failed: Branded Fusion details should mention Albion and LIGHT monster material.');
  }

  // 3. Recognizes Aluber the Jester of Despia starter in inDeckSearchers
  const aluberInDeck = snowCandidate.searchPathway.inDeckSearchers.find(
    s => s.searcherName === 'Aluber the Jester of Despia'
  );
  if (!aluberInDeck) {
    throw new Error('Test 2 Failed: Aluber was not recognized as in-deck starter.');
  }

  // 4. Concrete combo steps verification
  const fullComboText = snowCandidate.comboSteps.join(' ');
  if (!fullComboText.includes('Aluber') || !fullComboText.includes('Branded Fusion') || !fullComboText.includes('Albion') || !fullComboText.includes('Mirrorjade') || !fullComboText.includes('Snow')) {
    throw new Error('Test 2 Failed: Combo steps do not contain full Aluber -> Branded Fusion -> Albion -> Mirrorjade -> Snow line.');
  }

  // 5. Recommended additions verification
  if (snowCandidate.recommendedAdditions.length === 0) {
    throw new Error('Test 2 Failed: Recommended additions list is empty.');
  }

  console.log('===============================================================');
  console.log('ALL COMBO PATHWAY & CARD SEARCH ENGINE TESTS PASSED SUCCESSFULLY');
  console.log('===============================================================');
}

runTest().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
