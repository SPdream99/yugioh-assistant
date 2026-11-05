import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import {
  createArchetypeDocx,
  readAndValidateDocx,
  exportDatabaseAndScripts,
  generateArtPrompts,
  sliceArtGrid,
  buildFullPipeline
} from './studio_manager.js';
import { ArchetypeMasterSpec } from './types.js';

async function runStudioTests() {
  console.log('=== STARTING YGO ARCHETYPE STUDIO PIPELINE TESTS ===\n');

  const cwd = process.cwd();
  const testDir = path.resolve(cwd, 'data/test_studio_output');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const sampleSpec: ArchetypeMasterSpec = {
    archetypeName: 'Chronofreeze',
    setcode: '0x88e',
    lore: 'Time-space warriors seal their enemies inside eternal time crystals.',
    playstyle: "Lock down the opponent's attack rhythm, Xyz Summon Rank 4 monsters and activate time traps from the Graveyard.",
    targetSimulator: 'omega',
    author: 'Duelist Architect',
    cards: [
      {
        id: 77000101, // 8-digit ID valid for YGO Omega
        name: 'Chronofreeze Cryomancer',
        type: 'Effect Monster',
        attribute: 'WATER',
        race: 'Spellcaster',
        level: 4,
        atk: 1850,
        def: 1000,
        desc: 'When this card is Normal Summoned: You can add 1 "Chronofreeze" Spell/Trap from your Deck to your hand. (Quick Effect): You can banish this card from your field; freeze 1 monster your opponent controls until the end of this turn.',
        strings: ['Add 1 Chronofreeze Spell/Trap', 'Freeze target monster'],
        visualPrompt: 'A master cryomancer wizard in frozen glowing crystalline robes holding an hourglass staff, frost mist, anime Yu-Gi-Oh card art'
      },
      {
        id: 77000102,
        name: 'Chronofreeze Glacial Knight',
        type: 'Effect Monster',
        attribute: 'WATER',
        race: 'Warrior',
        level: 4,
        atk: 1900,
        def: 1200,
        desc: 'If you control a "Chronofreeze" monster: You can Special Summon this card (from your hand). Monsters this card points to or battles cannot activate their effects.',
        strings: ['Special Summon from hand'],
        visualPrompt: 'A towering knight clad in diamond ice plate armor with a colossal crystalline broadsword, frozen fortress background'
      },
      {
        id: 77000103,
        name: 'Chronofreeze Temporal Zero',
        type: 'XYZ Monster',
        attribute: 'WATER',
        race: 'Aqua',
        level: 4,
        atk: 2500,
        def: 2000,
        desc: '2 Level 4 "Chronofreeze" monsters. (Quick Effect): You can detach 1 material from this card; negate the effects of all face-up cards your opponent controls until the end of this turn.',
        strings: ['Negate all face-up cards'],
        visualPrompt: 'A cosmic frozen deity hovering inside a giant shattered clock mechanism, glowing azure clock hands, dramatic anime art'
      },
      {
        id: 77000104,
        name: 'Chronofreeze Absolute Domain',
        type: 'Continuous Trap Card',
        attribute: 'Trap',
        race: 'Continuous',
        desc: 'Continuous Trap Card. All "Chronofreeze" monsters you control gain 500 ATK. Once per turn, when an opponent monster declares an attack: You can negate that attack.',
        strings: ['Negate attack'],
        visualPrompt: 'An expansive glacial landscape with giant ticking clock towers encased in icebergs under an aurora borealis'
      }
    ]
  };

  // [Test 1] Create Master Specification DOCX
  console.log('[Test 1] Creating the Master Specification DOCX from the Archetype config...');
  const docxFile = path.resolve(testDir, 'Chronofreeze_Spec.docx');
  const createRes = await createArchetypeDocx(sampleSpec, docxFile);
  assert(createRes.success === true, 'DOCX creation must succeed');
  assert(fs.existsSync(createRes.docxPath), `DOCX file must exist at ${createRes.docxPath}`);
  console.log(`✓ Successfully created DOCX file: ${createRes.docxPath}`);

  // [Test 2] Parse & Validate DOCX
  console.log('\n[Test 2] Parsing and validating integrity from the DOCX file...');
  const validation = await readAndValidateDocx(createRes.docxPath, 'omega');
  assert(validation.valid === true, 'DOCX must be valid');
  assert.strictEqual(validation.archetypeName.toLowerCase(), 'chronofreeze');
  assert.strictEqual(validation.setcode, '0x88e');
  assert.strictEqual(validation.cardCount, 4);
  assert.strictEqual(validation.cards[0].name, 'Chronofreeze Cryomancer');
  assert.strictEqual(validation.cards[0].id, 77000101);
  assert.strictEqual(validation.cards[2].type, 'XYZ Monster');
  console.log(`✓ Parsed successfully: 4 cards, Setcode: ${validation.setcode}, 0 errors.`);

  // [Test 3] Export Database SQLite & Lua Scripts (Adapter: Omega)
  console.log('\n[Test 3] Compiling the SQLite database and generating Lua scripts for YGO Omega...');
  const dbExport = await exportDatabaseAndScripts(createRes.docxPath, path.resolve(testDir, 'Databases/gm.db'), path.resolve(testDir, 'Scripts'), 'omega');
  assert(dbExport.success === true, 'DB and Script compilation must succeed');
  assert(fs.existsSync(dbExport.databasePath), `SQLite database file must exist at ${dbExport.databasePath}`);
  assert.strictEqual(dbExport.scriptsGenerated.length, 4);

  // Check generated Lua script contents for Omega adapter
  const cryoLua = fs.readFileSync(path.resolve(testDir, 'Scripts/c77000101.lua'), 'utf-8');
  assert(cryoLua.includes('LOCATION_GRAVE'), 'Omega profile must use LOCATION_GRAVE');

  const trapLua = fs.readFileSync(path.resolve(testDir, 'Scripts/c77000104.lua'), 'utf-8');
  assert(trapLua.includes('TIMINGS_CHECK_MONSTER + TIMING_END_PHASE'), 'Omega profile Trap must include the standard TIMING_END_PHASE');
  console.log(`✓ Successfully compiled SQLite DB (${dbExport.databasePath}) and 4 Lua script files!`);

  // [Test 4] Generate Art Prompts & Master Grid Prompt
  console.log('\n[Test 4] Exporting the art prompt guide ART_PROMPTS.md...');
  const promptsFile = path.resolve(testDir, 'Chronofreeze_ART_PROMPTS.md');
  const promptsRes = await generateArtPrompts(createRes.docxPath, promptsFile, '2x2');
  assert(fs.existsSync(promptsRes.markdownPath), `Markdown prompt file must exist at ${promptsRes.markdownPath}`);
  assert(promptsRes.masterGridPrompt.includes('Chronofreeze'), 'Master Grid Prompt must contain the archetype name');
  assert(promptsRes.masterGridPrompt.includes('Panel 1'), 'Master Grid Prompt must include Panel 1');
  console.log(`✓ Successfully created ART_PROMPTS.md with a 2x2 Master Grid Prompt layout!`);

  // [Test 5] Slicing Test Grid Image into <id>.jpg
  console.log('\n[Test 5] Creating a sample grid image and smart-slicing it into <id>.jpg files under Arts/...');
  const testGridImg = path.resolve(testDir, 'sample_grid_2x2.png');
  const { execSync } = await import('node:child_process');
  execSync(`python -c "from PIL import Image, ImageDraw; img = Image.new('RGB', (1024, 1024), '#111827'); draw = ImageDraw.Draw(img); draw.rectangle([10, 10, 500, 500], fill='#3B82F6'); draw.rectangle([514, 10, 1014, 500], fill='#EF4444'); draw.rectangle([10, 514, 500, 1014], fill='#10B981'); draw.rectangle([514, 514, 1014, 1014], fill='#F59E0B'); img.save(r'${testGridImg}')"`);

  const artsDir = path.resolve(testDir, 'Arts');
  const sliceRes = await sliceArtGrid(testGridImg, createRes.docxPath, artsDir, 2, 2);
  assert(sliceRes.success === true, 'Grid image slicing must succeed');
  assert.strictEqual(sliceRes.slicedCount, 4);
  assert(fs.existsSync(path.resolve(artsDir, '77000101.jpg')), 'File 77000101.jpg must exist');
  assert(fs.existsSync(path.resolve(artsDir, '77000102.jpg')), 'File 77000102.jpg must exist');
  assert(fs.existsSync(path.resolve(artsDir, '77000103.jpg')), 'File 77000103.jpg must exist');
  assert(fs.existsSync(path.resolve(artsDir, '77000104.jpg')), 'File 77000104.jpg must exist');
  console.log(`✓ Successfully sliced 4 high-quality JPEG images into ${artsDir}`);

  // [Test 6] Full Pipeline Execution (A-Z)
  console.log('\n[Test 6] Verifying the One-Click Full Pipeline command buildFullPipeline...');
  const gameRoot = path.resolve(testDir, 'Omega_Game_Root');
  const pipelineRes = await buildFullPipeline(createRes.docxPath, gameRoot, 'omega', testGridImg);
  assert(pipelineRes.success === true, 'Full pipeline must succeed');
  assert(fs.existsSync(path.resolve(gameRoot, 'Databases/gm.db')), 'gm.db must exist inside the game root');
  assert(fs.existsSync(path.resolve(gameRoot, 'Scripts/c77000101.lua')), 'Script must exist inside the game root');
  assert(fs.existsSync(path.resolve(gameRoot, 'Arts/77000101.jpg')), 'Artwork must exist inside the game root');
  console.log(`✓ The One-Click Full Pipeline command passed 100%!`);

  console.log('\n========================================================');
  console.log('ALL 6 YGO ARCHETYPE STUDIO TESTS PASSED 100%!');
  console.log('========================================================');
}

runStudioTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
