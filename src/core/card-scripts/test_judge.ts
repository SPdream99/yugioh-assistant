import { analyzeCardMechanics, judgeInteraction } from './judge-engine.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('   Yu-Gi-Oh Judge Engine & Lua Parser Test Suite    ');
  console.log('====================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Ash Blossom & Joyous Spring (14558127)
  // --------------------------------------------------------------------------
  console.log('TEST 1: Ash Blossom & Joyous Spring (14558127)');
  const ash = await analyzeCardMechanics(14558127, 'Ash Blossom & Joyous Spring');

  assert(ash.luaSourceAvailable === true, 'Lua script successfully fetched and available');
  assert(ash.effects.length >= 1, `Parsed at least 1 effect (found: ${ash.effects.length})`);

  const ashEff = ash.effects[0];
  assert(ashEff.isHOPT === true, 'Effect is Hard Once Per Turn (isHOPT === true)');
  assert(ashEff.countLimit === 1, 'Count limit is 1');
  assert(ashEff.effectType.includes('EFFECT_TYPE_QUICK_O'), 'Effect is Quick Effect (EFFECT_TYPE_QUICK_O)');
  assert(ashEff.code === 'EVENT_CHAINING', 'Effect triggers on EVENT_CHAINING');
  assert(ash.costProperties.hasCost === true, 'Has activation cost (hasCost === true)');
  assert(
    !!ashEff.costDescription && ashEff.costDescription.toLowerCase().includes('discard'),
    `Discards as cost: "${ashEff.costDescription}"`
  );
  assert(
    ash.negationProperties.negatesEffect === true,
    'Negates effect (negatesEffect === true, CATEGORY_DISABLE)'
  );
  assert(
    ash.negationProperties.negatesActivation === false,
    'Does NOT negate activation (negatesActivation === false)'
  );
  assert(
    ashEff.categories.includes('CATEGORY_DISABLE'),
    'Categories includes CATEGORY_DISABLE'
  );
  assert(
    !ashEff.categories.includes('CATEGORY_NEGATE'),
    'Categories does NOT include CATEGORY_NEGATE'
  );
  assert(ash.targetingProperties.targets === false, 'Ash Blossom does not target');
  console.log(`  Verdict: ${ash.summaryVerdict}\n`);

  // --------------------------------------------------------------------------
  // TEST 2: Nibiru, the Primal Being (27204311)
  // --------------------------------------------------------------------------
  console.log('TEST 2: Nibiru, the Primal Being (27204311)');
  const nibiru = await analyzeCardMechanics(27204311, 'Nibiru, the Primal Being');

  assert(nibiru.luaSourceAvailable === true, 'Lua script successfully fetched and available');
  assert(nibiru.effects.length >= 1, `Parsed at least 1 effect (found: ${nibiru.effects.length})`);

  const nibEff = nibiru.effects[0];
  assert(nibEff.isHOPT === true, 'Nibiru is HOPT');
  assert(
    nibiru.costProperties.hasCost === false,
    'Nibiru has NO activation cost (hasCost === false)'
  );
  assert(
    nibEff.costDescription === undefined,
    'Nibiru costDescription is undefined (tribute is NOT cost)'
  );
  assert(
    nibEff.categories.includes('CATEGORY_RELEASE'),
    'Categories include CATEGORY_RELEASE'
  );
  assert(
    !!nibEff.operationDescription && nibEff.operationDescription.includes('Tributes monster(s) as effect'),
    `Tributes in operation as EFFECT: "${nibEff.operationDescription}"`
  );
  assert(
    nibEff.isTargeting === false,
    'Nibiru does NOT target (isTargeting === false)'
  );
  assert(
    nibiru.targetingProperties.targets === false,
    'targetingProperties.targets is false'
  );
  console.log(`  Verdict: ${nibiru.summaryVerdict}\n`);

  // --------------------------------------------------------------------------
  // TEST 3: Effect Veiler (97268402)
  // --------------------------------------------------------------------------
  console.log('TEST 3: Effect Veiler (97268402)');
  const veiler = await analyzeCardMechanics(97268402, 'Effect Veiler');

  assert(veiler.luaSourceAvailable === true, 'Lua script successfully fetched and available');
  assert(veiler.effects.length >= 1, `Parsed at least 1 effect (found: ${veiler.effects.length})`);

  const veilerEff = veiler.effects[0];
  assert(veilerEff.isTargeting === true, 'Effect Veiler targets (isTargeting === true)');
  assert(
    veilerEff.flags.includes('EFFECT_FLAG_CARD_TARGET'),
    'Contains EFFECT_FLAG_CARD_TARGET flag'
  );
  assert(
    veiler.targetingProperties.targets === true,
    'targetingProperties.targets is true'
  );
  assert(
    veiler.costProperties.hasCost === true,
    'Effect Veiler has cost (hasCost === true)'
  );
  assert(
    !!veilerEff.costDescription &&
      (veilerEff.costDescription.includes('GY') || veilerEff.costDescription.includes('Grave')),
    `Sends itself to GY as cost: "${veilerEff.costDescription}"`
  );
  assert(
    veilerEff.effectType.includes('EFFECT_TYPE_QUICK_O'),
    'Effect is Quick Effect (EFFECT_TYPE_QUICK_O)'
  );
  assert(
    veiler.damageStepUsable.usable === false,
    'Effect Veiler CANNOT activate in Damage Step (damageStepUsable.usable === false)'
  );
  console.log(`  Verdict: ${veiler.summaryVerdict}\n`);

  // --------------------------------------------------------------------------
  // TEST 4: Ruling Question 1 - Ash Blossom vs Dark World Discard
  // --------------------------------------------------------------------------
  console.log('TEST 4: Ruling Question - Ash Blossom vs Dark World Discard');
  const ruling1 = await judgeInteraction(
    14558127,
    74117290,
    'Does Ash Blossom discarding itself trigger Dark World monster effects when sent to GY?'
  );

  assert(
    ruling1.includes('REASON_COST') || ruling1.includes('COST'),
    'Ruling mentions discard as COST (REASON_COST)'
  );
  assert(
    ruling1.includes('Dark World') && ruling1.includes('NOT trigger'),
    'Ruling confirms it will NOT trigger Dark World effects'
  );
  console.log('--- Excerpt from ruling output ---');
  console.log(ruling1.slice(0, 450) + '...\n');

  // --------------------------------------------------------------------------
  // TEST 5: Ruling Question 2 - Effect Veiler in Damage Step
  // --------------------------------------------------------------------------
  console.log('TEST 5: Ruling Question - Effect Veiler in Damage Step');
  const ruling2 = await judgeInteraction(
    97268402,
    14558127,
    'Can Effect Veiler activate during the Damage Step?'
  );

  assert(
    ruling2.includes('CANNOT activate in the Damage Step'),
    'Ruling confirms Effect Veiler CANNOT activate in Damage Step'
  );
  console.log('--- Excerpt from ruling output ---');
  console.log(ruling2.slice(0, 400) + '...\n');

  // --------------------------------------------------------------------------
  // TEST 6: Ruling Question 3 - Activation Negated HOPT Re-activation
  // --------------------------------------------------------------------------
  console.log('TEST 6: Ruling Question - Activation Negated HOPT Re-activation');
  const ruling3 = await judgeInteraction(
    14558127,
    41420027,
    'If Ash Blossom activation is negated, can another copy be activated this turn?'
  );

  assert(
    ruling3.includes('ACTIVATION is negated'),
    'Ruling distinguishes activation negation'
  );
  assert(
    ruling3.includes('CAN activate another copy'),
    'Ruling explains that another copy CAN be activated if activation was negated'
  );
  assert(
    ruling3.includes('EFFECT is negated') && ruling3.includes('CANNOT activate another copy'),
    'Ruling explains that another copy CANNOT be activated if only effect was negated'
  );
  console.log('--- Excerpt from ruling output ---');
  console.log(ruling3.slice(0, 450) + '...\n');

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('====================================================');
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner encountered an error:', err);
  process.exit(1);
});
