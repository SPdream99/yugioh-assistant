import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ArchetypeMasterSpec,
  MasterCardData,
  SimulatorProfile,
  DocxValidationResult,
  DatabaseAndScriptExportResult,
  ArtPromptsExportResult,
  GridSliceResult,
  FullPipelineResult,
  ValidationIssue
} from './types.js';
import { validateCardForProfile, generateAdaptedLuaScript, validateGeneratedLua, PROFILE_CONSTANTS } from './engine_adapter.js';
import { resolvePythonScript, getDataRoot } from '../../utils/paths.js';
import { guardOutputPath } from '../../utils/safe-path.js';

const execFileAsync = promisify(execFile);

const DOCX_PIPELINE_SCRIPT = resolvePythonScript('core/archetype-studio/docx_pipeline.py');
const SQLITE_EXPORTER_SCRIPT = resolvePythonScript('core/archetype-studio/sqlite_exporter.py');
const ART_SLICER_SCRIPT = resolvePythonScript('core/archetype-studio/art_slicer.py');

/**
 * 1. Creates a Master Specification DOCX from spec data.
 */
export async function createArchetypeDocx(spec: ArchetypeMasterSpec, outputPath?: string): Promise<{ success: boolean; docxPath: string }> {
  const cwd = process.cwd();
  const safeName = (spec.archetypeName || 'Custom_Archetype').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const targetPath = outputPath
    ? (path.isAbsolute(outputPath) ? outputPath : path.resolve(cwd, outputPath))
    : path.resolve(cwd, `data/archetype_studio/${safeName}_Spec.docx`);
  const targetGuard = guardOutputPath(targetPath);
  if (!targetGuard.ok) throw new Error(targetGuard.reason || 'Refusing to write outside the project directory.');
  const safeTarget = targetGuard.resolved;

  const tempJson = path.resolve(cwd, `data/cache/temp_spec_${Date.now()}.json`);
  const cacheDir = path.dirname(tempJson);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  fs.writeFileSync(tempJson, JSON.stringify(spec, null, 2), 'utf-8');

  try {
    const { stdout } = await execFileAsync('python', [DOCX_PIPELINE_SCRIPT, 'build', tempJson, safeTarget]);
    const res = JSON.parse(stdout);

    // Sidecar: DOCX cannot carry arbitrary Lua payloads, so keep them next to the spec.
    const sidecarCards = (spec.cards || [])
      .filter(card => (card.lua && card.lua.trim().length > 0) || card.linkmarkers !== undefined)
      .map(card => ({ id: card.id, lua: card.lua, linkmarkers: card.linkmarkers }));
    if (sidecarCards.length > 0) {
      const sidecarPath = `${safeTarget}.lua.json`;
      fs.writeFileSync(sidecarPath, JSON.stringify({ cards: sidecarCards }, null, 2), 'utf-8');
    }

    return { success: true, docxPath: res.savedPath || safeTarget };
  } finally {
    if (fs.existsSync(tempJson)) {
      try { fs.unlinkSync(tempJson); } catch {}
    }
  }
}

/**
 * 2. Parses and validates a Master Specification DOCX.
 */
export async function readAndValidateDocx(docxPath: string, targetSimulator?: SimulatorProfile): Promise<DocxValidationResult> {
  const cwd = process.cwd();
  const resolvedDocx = path.isAbsolute(docxPath) ? docxPath : path.resolve(cwd, docxPath);

  if (!fs.existsSync(resolvedDocx)) {
    throw new Error(`DOCX file not found at: ${resolvedDocx}`);
  }

  const { stdout } = await execFileAsync('python', [DOCX_PIPELINE_SCRIPT, 'parse', resolvedDocx]);
  const parsed: ArchetypeMasterSpec = JSON.parse(stdout);

  const profile: SimulatorProfile = targetSimulator || parsed.targetSimulator || 'omega';
  const issues: ValidationIssue[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check Setcode
  if (!parsed.setcode || parsed.setcode.trim().length === 0) {
    errors.push('Missing Archetype Setcode (e.g. 0x99f).');
  }

  // Check unique IDs
  const seenIds = new Set<number>();
  for (const card of parsed.cards) {
    if (seenIds.has(card.id)) {
      const msg = `Duplicate ID detected: card #${card.id} appears more than once in the document.`;
      errors.push(msg);
      issues.push({ cardId: card.id, cardName: card.name, severity: 'error', message: msg });
    }
    seenIds.add(card.id);

    // Validate per-profile rules (int32 overflow for Omega, empty text, strings, etc.)
    const cardIssues = validateCardForProfile(card, profile);
    for (const issue of cardIssues) {
      issues.push(issue);
      if (issue.severity === 'error') {
        errors.push(`[${card.name} (#${card.id})] ${issue.message}`);
      } else {
        warnings.push(`[${card.name} (#${card.id})] ${issue.message}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    archetypeName: parsed.archetypeName,
    setcode: parsed.setcode,
    targetSimulator: profile,
    cardCount: parsed.cards.length,
    errors,
    warnings,
    issues,
    cards: parsed.cards
  };
}

/**
 * 3. Compiles SQLite database (.cdb or gm.db) and generates c<id>.lua scripts.
 */
export async function exportDatabaseAndScripts(
  docxPath: string,
  outputDbPath?: string,
  outputScriptsDir?: string,
  simulatorProfile?: SimulatorProfile
): Promise<DatabaseAndScriptExportResult> {
  const validation = await readAndValidateDocx(docxPath, simulatorProfile);
  if (!validation.valid) {
    throw new Error(`Invalid DOCX document. Errors:\n${validation.errors.join('\n')}`);
  }

  // Merge optional per-card Lua sidecar (full scripts authored outside the DOCX).
  const sidecarPath = `${path.isAbsolute(docxPath) ? docxPath : path.resolve(process.cwd(), docxPath)}.lua.json`;
  if (fs.existsSync(sidecarPath)) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')) as { cards?: { id: number; lua?: string; linkmarkers?: number }[] };
      const byId = new Map((sidecar.cards || []).map(c => [Number(c.id), c]));
      for (const card of validation.cards) {
        const extra = byId.get(card.id);
        if (!extra) continue;
        if (extra.lua) card.lua = extra.lua;
        if (extra.linkmarkers !== undefined) card.linkmarkers = extra.linkmarkers;
      }
    } catch {
      // Ignore malformed sidecar
    }
  }

  const cwd = process.cwd();
  const profile = validation.targetSimulator;
  const constants = PROFILE_CONSTANTS[profile];

  const safeName = validation.archetypeName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const baseOutDir = path.resolve(cwd, `data/archetype_studio/${safeName}_build`);

  const dbTarget = outputDbPath
    ? (path.isAbsolute(outputDbPath) ? outputDbPath : path.resolve(cwd, outputDbPath))
    : path.resolve(baseOutDir, constants.dbFileName);

  const scriptsTargetDir = outputScriptsDir
    ? (path.isAbsolute(outputScriptsDir) ? outputScriptsDir : path.resolve(cwd, outputScriptsDir))
    : path.resolve(baseOutDir, constants.scriptsSubdir);

  if (!fs.existsSync(scriptsTargetDir)) {
    fs.mkdirSync(scriptsTargetDir, { recursive: true });
  }

  // YGO Omega does not ship the EDOPro procedure libraries. Copy them next to the
  // card scripts so Duel.LoadScript("proc_link.lua") etc. resolve at runtime.
  // They are downloaded by `ygo fetch-data` from ProjectIgnis, not bundled here.
  const procSourceDir = path.resolve(getDataRoot(), 'data', 'ocgcore-scripts');
  if (fs.existsSync(procSourceDir)) {
    for (const file of fs.readdirSync(procSourceDir)) {
      if (!file.startsWith('proc_') || !file.endsWith('.lua')) continue;
      fs.copyFileSync(path.join(procSourceDir, file), path.resolve(scriptsTargetDir, file));
    }
  } else {
    console.warn('Procedure libraries are missing; run `ygo fetch-data` before exporting to a simulator.');
  }

  // 1. Generate engine-adapted Lua scripts first (so the DB `script` column can be filled).
  const generatedScripts: string[] = [];
  const cardsForDb = validation.cards.map(card => {
    const luaContent = generateAdaptedLuaScript(card, profile, validation.setcode);
    const luaFile = path.resolve(scriptsTargetDir, `c${card.id}.lua`);
    fs.writeFileSync(luaFile, luaContent, 'utf-8');
    generatedScripts.push(luaFile);
    return { ...card, lua: luaContent };
  });

  // 1b. Static safety checks for generated Lua (Omega constants / missing globals / stubs).
  const luaIssues = cardsForDb.flatMap(card =>
    validateGeneratedLua(card.lua || '', profile, card.name, card.id)
  );
  validation.issues.push(...luaIssues);
  const luaErrors = luaIssues.filter(issue => issue.severity === 'error');
  if (luaErrors.length > 0) {
    throw new Error(`Lua validation failed:\n${luaErrors.map(e => `[${e.cardName} (#${e.cardId})] ${e.message}`).join('\n')}`);
  }

  // 2. Compile / merge SQLite Database via python script (never deletes the target DB).
  const tempJson = path.resolve(cwd, `data/cache/temp_export_${Date.now()}.json`);
  fs.writeFileSync(tempJson, JSON.stringify({ cards: cardsForDb, setcode: validation.setcode }), 'utf-8');

  try {
    await execFileAsync('python', [SQLITE_EXPORTER_SCRIPT, tempJson, dbTarget, validation.setcode, profile]);
  } finally {
    if (fs.existsSync(tempJson)) {
      try { fs.unlinkSync(tempJson); } catch {}
    }
  }

  return {
    success: true,
    databasePath: dbTarget,
    scriptsDir: scriptsTargetDir,
    simulatorProfile: profile,
    cardsCompiled: validation.cards.length,
    scriptsGenerated: generatedScripts,
    message: `Compiled the SQLite database at ${dbTarget} and generated ${generatedScripts.length} Lua scripts in ${scriptsTargetDir}`
  };
}

/**
 * 4. Generates ART_PROMPTS.md with Master Grid Prompt & individual prompts.
 */
export async function generateArtPrompts(
  docxPath: string,
  outputMdPath?: string,
  gridLayout: '2x2' | '3x3' | '4x4' = '3x3'
): Promise<ArtPromptsExportResult> {
  const validation = await readAndValidateDocx(docxPath);
  const cwd = process.cwd();
  const safeName = validation.archetypeName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const targetMd = outputMdPath
    ? (path.isAbsolute(outputMdPath) ? outputMdPath : path.resolve(cwd, outputMdPath))
    : path.resolve(cwd, `data/archetype_studio/${safeName}_ART_PROMPTS.md`);

  const tempJson = path.resolve(cwd, `data/cache/temp_art_${Date.now()}.json`);
  fs.writeFileSync(tempJson, JSON.stringify({ cards: validation.cards }), 'utf-8');

  try {
    const { stdout } = await execFileAsync('python', [
      ART_SLICER_SCRIPT,
      'prompts',
      tempJson,
      targetMd,
      validation.archetypeName,
      gridLayout
    ]);
    const res: ArtPromptsExportResult = JSON.parse(stdout);
    return res;
  } finally {
    if (fs.existsSync(tempJson)) {
      try { fs.unlinkSync(tempJson); } catch {}
    }
  }
}

/**
 * 5. Slices AI-generated contact sheet image into square <id>.jpg arts.
 */
export async function sliceArtGrid(
  imagePath: string,
  docxPathOrIds: string | number[],
  outputArtsDir?: string,
  rows: number = 3,
  cols: number = 3
): Promise<GridSliceResult> {
  const cwd = process.cwd();
  const resolvedImg = path.isAbsolute(imagePath) ? imagePath : path.resolve(cwd, imagePath);

  let targetArtsDir = outputArtsDir
    ? (path.isAbsolute(outputArtsDir) ? outputArtsDir : path.resolve(cwd, outputArtsDir))
    : path.resolve(cwd, 'data/archetype_studio/Arts');

  let idArg: string;
  if (typeof docxPathOrIds === 'string' && docxPathOrIds.endsWith('.docx')) {
    const validation = await readAndValidateDocx(docxPathOrIds);
    const ids = validation.cards.map(c => c.id);
    idArg = ids.join(',');
    if (!outputArtsDir) {
      const constants = PROFILE_CONSTANTS[validation.targetSimulator];
      const safeName = validation.archetypeName.replace(/[^a-zA-Z0-9_\-]/g, '_');
      targetArtsDir = path.resolve(cwd, `data/archetype_studio/${safeName}_build`, constants.artsSubdir);
    }
  } else if (Array.isArray(docxPathOrIds)) {
    idArg = docxPathOrIds.join(',');
  } else {
    idArg = String(docxPathOrIds);
  }

  const { stdout } = await execFileAsync('python', [
    ART_SLICER_SCRIPT,
    'slice',
    resolvedImg,
    idArg,
    targetArtsDir,
    String(rows),
    String(cols)
  ]);

  return JSON.parse(stdout);
}

/**
 * 6. Executes the complete end-to-end pipeline from .docx to game files.
 */
export async function buildFullPipeline(
  docxPath: string,
  gameRootDir: string,
  simulatorProfile: SimulatorProfile,
  gridImagePath?: string
): Promise<FullPipelineResult> {
  const cwd = process.cwd();
  const resolvedGameRoot = path.isAbsolute(gameRootDir) ? gameRootDir : path.resolve(cwd, gameRootDir);
  const constants = PROFILE_CONSTANTS[simulatorProfile];

  // 1. Read & Validate DOCX
  const validation = await readAndValidateDocx(docxPath, simulatorProfile);
  if (!validation.valid) {
    throw new Error(`Pipeline halted due to DOCX validation errors:\n${validation.errors.join('\n')}`);
  }

  // 2. Export Database & Scripts directly into game directory structure
  const dbTarget = path.resolve(resolvedGameRoot, constants.dbFileName);
  const scriptsTarget = path.resolve(resolvedGameRoot, constants.scriptsSubdir);

  const dbExport = await exportDatabaseAndScripts(docxPath, dbTarget, scriptsTarget, simulatorProfile);

  // 3. Generate Art Prompts
  const safeName = validation.archetypeName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const promptsFile = path.resolve(resolvedGameRoot, `${safeName}_ART_PROMPTS.md`);
  const artPromptsExport = await generateArtPrompts(docxPath, promptsFile, '3x3');

  // 4. Optionally slice grid image if supplied
  let artSliceExport: GridSliceResult | undefined;
  if (gridImagePath && fs.existsSync(gridImagePath)) {
    const artsTarget = path.resolve(resolvedGameRoot, constants.artsSubdir);
    artSliceExport = await sliceArtGrid(gridImagePath, docxPath, artsTarget, 3, 3);
  }

  return {
    success: true,
    docxPath,
    spec: {
      archetypeName: validation.archetypeName,
      setcode: validation.setcode,
      lore: '',
      playstyle: '',
      targetSimulator: simulatorProfile,
      cards: validation.cards
    },
    validation,
    databaseExport: dbExport,
    artPromptsExport,
    artSliceExport,
    message: `Completed the full pipeline for archetype '${validation.archetypeName}', exported to ${simulatorProfile.toUpperCase()} in: ${resolvedGameRoot}`
  };
}
