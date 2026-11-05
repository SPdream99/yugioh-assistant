import assert from 'node:assert';
import { simulateDuelScenario } from './duel-simulator.js';

async function runSimulatorTests() {
  console.log('=== STARTING DUEL SCENARIO SIMULATOR & JUDGE ENGINE TESTS ===\n');

  // Test 1: Standard Chain with Counter-Negation
  console.log('[Test 1] Simulating a counter chain: Branded Fusion -> Ash Blossom -> Called by the Grave...');
  const res1 = await simulateDuelScenario({
    scenario: 'Player A activates "Branded Fusion". Player B responds with "Ash Blossom & Joyous Spring", discarding it to the Graveyard. Player A activates "Called by the Grave", targeting Ash Blossom in the Graveyard.',
    format: 'TCG'
  });

  assert(res1.isValidPlaySequence === true, 'The chain must be valid');
  assert.strictEqual(res1.chainExecution.chainLinkCount, 3, 'There must be exactly 3 Chain Links');
  assert.strictEqual(res1.chainExecution.resolutionOrderLIFO[0].cardName, 'Called by the Grave', 'CL3 Called by the Grave must resolve first');
  assert.strictEqual(res1.chainExecution.resolutionOrderLIFO[1].resolvesSuccessfully, false, 'CL2 Ash Blossom must be negated');
  assert.strictEqual(res1.chainExecution.resolutionOrderLIFO[2].resolvesSuccessfully, true, 'CL1 Branded Fusion must resolve successfully');
  console.log('✓ Test 1: LIFO chain resolution is exact, just like EDOPro/Omega/Master Duel!');

  // Test 2: Illegal Action Detection (Target Invalid Location)
  console.log('\n[Test 2] Detecting an illegal action: Called by the Grave targeting a monster on the field...');
  const res2 = await simulateDuelScenario({
    scenario: 'Player A activates "Called by the Grave", targeting "Ash Blossom & Joyous Spring" on the field.',
    format: 'TCG'
  });

  assert(res2.isValidPlaySequence === false, 'The action must be judged illegal');
  assert.strictEqual(res2.officialJudgeRuling.verdict, 'ILLEGAL');
  assert(res2.officialJudgeRuling.detailedExplanation.includes('CANNOT target a monster on the field'), 'It must state the rule violation reason clearly');
  console.log('✓ Test 2: The judge correctly detected the targeting-condition violation and issued the penalty!');

  // Test 3: Face-up continuous requirement
  console.log('\n[Test 3] Checking the Field Spell / Continuous Spell face-up resolution principle...');
  const res3 = await simulateDuelScenario({
    scenario: 'Player A activates the Continuous Spell "Light and Darkness Ritual". Player B responds with a chain.',
    format: 'TCG'
  });
  assert(res3.officialJudgeRuling.coreRulebookPrinciples.some(p => p.includes('Face-up Resolution Requirement')), 'It must cite the Face-up resolution principle');
  console.log('✓ Test 3: Correctly cites the Konami rule for face-up continuous cards on the field!');

  console.log('\n=============================================================');
  console.log('ALL DUEL SCENARIO SIMULATOR TESTS PASSED 100%!');
  console.log('=============================================================');
}

runSimulatorTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
