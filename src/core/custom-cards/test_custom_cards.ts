import fs from 'node:fs';
import path from 'node:path';
import {
  registerCustomCard,
  migrateTempId,
  getCustomCard,
  listCustomCards,
} from './registry.js';
import { renderCardSvg } from './card-renderer.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== Running Custom Card Engine Tests ===\n');

  const cwd = process.cwd();
  const testDeckPath = path.resolve(cwd, 'data/test_migration_deck.ydk');

  // Prepare a test YDK file with a temp ID
  const initialYdkContent = [
    '#created by Yu-Gi-Oh! Assistant',
    '#main',
    '990000001',
    '990000001',
    '89631139',
    '#extra',
    '!side',
    '990000001',
  ].join('\n');
  fs.writeFileSync(testDeckPath, initialYdkContent, 'utf-8');

  // 1. Test Card Registration
  console.log('[Test 1] Registering unreleased card "Fiendsmith\'s Agony"...');
  const agonyRecord = registerCustomCard({
    name: "Fiendsmith's Agony",
    origin: 'unreleased_official',
    sourceUrl: 'https://ygorganization.com/fiendsmith-agony-preview',
    cardData: {
      type: 'Effect Monster',
      frameType: 'effect',
      race: 'Fiend',
      attribute: 'LIGHT',
      level: 4,
      atk: 1850,
      def: 0,
      archetype: 'Fiendsmith',
      desc: 'If you control no monsters, or control a LIGHT Fiend monster: You can Special Summon this card (from your hand). You can only use this effect of "Fiendsmith\'s Agony" once per turn. If this card is Normal or Special Summoned: You can add 1 "Fiendsmith" card from your Deck to your hand.',
    },
    effectsSpec: [
      {
        type: 'sp_summon',
        category: 'CATEGORY_SPECIAL_SUMMON',
        isHOPT: true,
        targets: false,
        range: 'LOCATION_HAND',
        description: 'Special Summon this card from hand',
      },
      {
        type: 'trigger',
        category: 'CATEGORY_SEARCH',
        isHOPT: true,
        targets: false,
        code: 'EVENT_SUMMON_SUCCESS',
        description: 'Search 1 Fiendsmith card on summon',
      },
    ],
  });

  console.log(`Registered Card: ${agonyRecord.name} with Temp ID: ${agonyRecord.tempId}`);
  assert(agonyRecord.tempId >= 990000001, 'Temp ID must be >= 990000001');
  assert(agonyRecord.status === 'active', 'Card status must be active');
  assert(agonyRecord.name === "Fiendsmith's Agony", 'Card name must match');

  // Verify generated Lua script file
  const fullLuaPath = path.resolve(cwd, agonyRecord.luaPath);
  assert(fs.existsSync(fullLuaPath), `Lua script file must exist at ${fullLuaPath}`);
  const luaContent = fs.readFileSync(fullLuaPath, 'utf-8');
  assert(luaContent.includes(`ID: ${agonyRecord.tempId}`), 'Lua script must include Temp ID in header');
  assert(luaContent.includes('CATEGORY_SPECIAL_SUMMON'), 'Lua script must include CATEGORY_SPECIAL_SUMMON');
  assert(luaContent.includes('CATEGORY_SEARCH'), 'Lua script must include CATEGORY_SEARCH');
  console.log('Generated Lua script verified successfully.');

  // 2. Test SVG Card Rendering
  console.log('\n[Test 2] Testing SVG Card Visual Rendering...');
  const svgOutput = renderCardSvg(agonyRecord.cardData, agonyRecord.tempId);
  const renderedSvgPath = path.resolve(cwd, `data/rendered_cards/${agonyRecord.tempId}.svg`);

  assert(svgOutput.length > 0, 'SVG output must not be empty');
  assert(svgOutput.includes("Fiendsmith's Agony"), 'SVG must contain card name');
  assert(svgOutput.includes('1850'), 'SVG must contain ATK value');
  assert(svgOutput.includes('LIGHT'), 'SVG must contain LIGHT attribute');
  assert(fs.existsSync(renderedSvgPath), `Rendered SVG file must exist at ${renderedSvgPath}`);
  console.log(`Rendered SVG verified and saved to data/rendered_cards/${agonyRecord.tempId}.svg`);

  // 3. Test Migration from Temp ID to Official ID
  console.log(`\n[Test 3] Migrating Temp ID ${agonyRecord.tempId} to Official ID 88889999...`);
  fs.writeFileSync(
    testDeckPath,
    ['#created by Yu-Gi-Oh! Assistant', '#main', String(agonyRecord.tempId), String(agonyRecord.tempId), '89631139', '#extra', '!side', String(agonyRecord.tempId)].join('\n'),
    'utf-8'
  );
  const officialId = 88889999;
  const migrationResult = migrateTempId(agonyRecord.tempId, officialId, [testDeckPath]);

  assert(migrationResult.success === true, 'Migration must succeed');
  assert(migrationResult.oldId === agonyRecord.tempId, 'Old ID must match tempId');
  assert(migrationResult.newId === officialId, 'New ID must match officialId');
  assert(migrationResult.updatedFiles.length > 0, 'At least 1 YDK file must be updated');
  console.log(`Migration result message: ${migrationResult.message}`);

  // Verify registry updated
  const migratedByOfficial = getCustomCard(officialId);
  assert(migratedByOfficial !== undefined, 'Card must be retrievable by officialId');
  assert(migratedByOfficial?.status === 'migrated', 'Status must be migrated');
  assert(migratedByOfficial?.officialId === officialId, 'officialId field must be populated');
  assert(migratedByOfficial?.cardData.id === officialId, 'cardData.id must be updated to officialId');

  const migratedByTemp = getCustomCard(agonyRecord.tempId);
  assert(migratedByTemp !== undefined, 'Card must still be retrievable by old tempId');
  assert(migratedByTemp?.status === 'migrated', 'Retrieved by tempId must show migrated status');

  // Verify migrated Lua files
  const migratedCustomLua = path.resolve(cwd, `data/custom_cards/c${officialId}.lua`);
  const migratedCacheLua = path.resolve(cwd, `data/cache/scripts/c${officialId}.lua`);
  assert(fs.existsSync(migratedCustomLua), `Migrated custom Lua file must exist at ${migratedCustomLua}`);
  assert(fs.existsSync(migratedCacheLua), `Migrated cache Lua file must exist at ${migratedCacheLua}`);

  const migratedLuaContent = fs.readFileSync(migratedCustomLua, 'utf-8');
  assert(migratedLuaContent.includes(`(ID: ${officialId})`), 'Migrated Lua must contain official ID');
  assert(!migratedLuaContent.includes(`(ID: ${agonyRecord.tempId})`), 'Migrated Lua must not contain temp ID in header');

  // Verify YDK file updated
  const updatedYdkContent = fs.readFileSync(testDeckPath, 'utf-8');
  assert(updatedYdkContent.includes(String(officialId)), 'YDK file must contain official ID');
  assert(!updatedYdkContent.includes(String(agonyRecord.tempId)), 'YDK file must not contain temp ID');
  console.log('YDK deck file contents updated with official ID.');

  // 4. Test SVG Rendering for Migrated Card
  console.log('\n[Test 4] Rendering SVG for Migrated Official Card...');
  const migratedSvg = renderCardSvg(migratedByOfficial!.cardData, officialId);
  const migratedSvgPath = path.resolve(cwd, `data/rendered_cards/${officialId}.svg`);
  assert(fs.existsSync(migratedSvgPath), `Official SVG file must exist at ${migratedSvgPath}`);
  assert(migratedSvg.includes(String(officialId)), 'Official SVG must contain official ID in footer');
  console.log(`Official SVG verified at data/rendered_cards/${officialId}.svg`);

  // Clean up temporary test YDK deck
  if (fs.existsSync(testDeckPath)) {
    fs.unlinkSync(testDeckPath);
  }

  // 5. Verify listCustomCards
  const allCards = listCustomCards();
  assert(allCards.length > 0, 'listCustomCards must return registered cards');
  console.log(`\nRegistry contains ${allCards.length} custom card(s).`);

  console.log('\n=== All Tests Passed Successfully! ===');
}

runTests().catch((err) => {
  console.error('\nTest execution failed:', err);
  process.exit(1);
});
