import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Card } from '../../types/card.js';
import { renderCardSvg } from './card-renderer.js';
import { listCustomCards } from './registry.js';
import { resolvePythonScript } from '../../utils/paths.js';
import { guardOutputPath } from '../../utils/safe-path.js';

const execFileAsync = promisify(execFile);

export interface BatchCardArtRequest {
  cards: {
    id?: number;
    name: string;
    artDescription?: string;
    type?: string;
    attribute?: string;
    frameType?: string;
    desc?: string;
    atk?: number;
    def?: number;
    level?: number;
    race?: string;
    [key: string]: any;
  }[];
  style?: string;
}

export interface BatchGridPromptResult {
  rows: number;
  cols: number;
  prompt: string;
  negativePrompt: string;
  manifest: {
    rows: number;
    cols: number;
    cells: {
      index: number;
      cardId: number;
      cardName: string;
      row: number;
      col: number;
      artDescription?: string;
      [key: string]: any;
    }[];
  };
}

export interface SlicedImageInfo {
  cardId: number;
  cardName: string;
  artPath: string;
}

export interface SlicingResult {
  success: boolean;
  slicedImages: SlicedImageInfo[];
  svgCards: string[];
}

/**
 * Returns human-readable grid position name (e.g. "top-left", "bottom-right").
 */
function getPositionName(row: number, col: number, rows: number, cols: number): string {
  const rowName = rows === 1 ? '' : row === 0 ? 'top' : row === rows - 1 ? 'bottom' : 'middle';
  const colName = cols === 1 ? '' : col === 0 ? 'left' : col === cols - 1 ? 'right' : 'center';
  if (!rowName && !colName) return 'center';
  if (!rowName) return colName;
  if (!colName) return rowName;
  return `${rowName}-${colName}`;
}

/**
 * Calculates optimal grid dimensions and formats a unified batch prompt for image models.
 */
export function generateBatchGridPrompt(request: BatchCardArtRequest): BatchGridPromptResult {
  const defaultStyle = "Modern anime Yu-Gi-Oh official card art, high dynamic range, vibrant colors, clean lighting";
  const style = request.style?.trim() || defaultStyle;
  const cards = request.cards || [];
  const n = cards.length;

  let rows = 2;
  let cols = 2;

  if (n <= 1) {
    rows = 1;
    cols = 1;
  } else if (n === 2) {
    rows = 1;
    cols = 2;
  } else if (n <= 4) {
    rows = 2;
    cols = 2;
  } else if (n <= 6) {
    rows = 2;
    cols = 3;
  } else if (n <= 9) {
    rows = 3;
    cols = 3;
  } else {
    cols = 3;
    rows = Math.ceil(n / 3);
  }

  const cells = cards.map((card, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    return {
      index: idx,
      cardId: card.id ?? (idx + 1),
      cardName: card.name,
      row,
      col,
      artDescription: card.artDescription,
      type: card.type,
      attribute: card.attribute,
      frameType: card.frameType,
      desc: card.desc,
      atk: card.atk,
      def: card.def,
      level: card.level,
      race: card.race
    };
  });

  const panelDescriptions = cells.map(cell => {
    const pos = getPositionName(cell.row, cell.col, rows, cols);
    const desc = cell.artDescription?.trim() || `${cell.cardName}, ${cell.attribute || ''} ${cell.type || 'Monster'}, dynamic anime action pose`;
    return `Panel ${cell.index + 1} (${pos}) [${cell.cardName}]: ${desc}`;
  }).join("\n");

  const prompt = [
    `A clean ${rows}x${cols} grid sheet containing ${n} distinct square anime Yu-Gi-Oh card artworks on a dark background, sharp thin dividing borders between cells.`,
    `Style: ${style}.`,
    `Each cell depicts a unique monster or spell/trap illustration:`,
    panelDescriptions,
    `Masterpiece, 8k resolution, vibrant dramatic lighting, highly detailed anime fantasy illustration in each quadrant, perfectly square composition per panel.`
  ].join("\n\n");

  const negativePrompt = "text, watermark, signature, card border, card template, trading card frame, blurry, low resolution, deformed, bad anatomy, distorted limbs, cut off, duplicate characters";

  return {
    rows,
    cols,
    prompt,
    negativePrompt,
    manifest: {
      rows,
      cols,
      cells
    }
  };
}

/**
 * Executes slice_grid.py to crop each cell, matches cells to cards, and renders cards with embedded artwork.
 */
export async function sliceAndAssignArtworks(
  inputImagePath: string,
  manifest: any,
  outputDir?: string
): Promise<SlicingResult> {
  const scriptPath = resolvePythonScript('core/custom-cards/slice_grid.py');

  const resolvedInputPath = path.resolve(inputImagePath);
  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`Input grid image does not exist: ${resolvedInputPath}`);
  }

  const targetOutputDir = outputDir ? path.resolve(outputDir) : path.resolve(process.cwd(), 'data/sliced_artworks');
  const outputGuard = guardOutputPath(targetOutputDir, { allowGameRoots: true });
  if (!outputGuard.ok) throw new Error(outputGuard.reason || 'Refusing to write outside the project directory.');
  const safeOutputDir = outputGuard.resolved;
  if (!fs.existsSync(safeOutputDir)) {
    fs.mkdirSync(safeOutputDir, { recursive: true });
  }

  const rows = manifest.rows || 2;
  const cols = manifest.cols || 2;
  const cells = manifest.cells || [];
  const cardIds = cells.map((c: any) => String(c.cardId));

  const args = [
    scriptPath,
    '--input', resolvedInputPath,
    '--rows', String(rows),
    '--cols', String(cols),
    '--output-dir', safeOutputDir,
    '--margin-percent', '1.5',
    '--card-ids', cardIds.join(',')
  ];

  let stdout = '';
  try {
    const res = await execFileAsync('python', args, { encoding: 'utf-8' });
    stdout = res.stdout;
  } catch (err: any) {
    // If python failed, try 'py'
    if (err.code === 'ENOENT') {
      const res = await execFileAsync('py', args, { encoding: 'utf-8' });
      stdout = res.stdout;
    } else {
      throw new Error(`slice_grid.py failed: ${err.message || err}`);
    }
  }

  const parsed = JSON.parse(stdout.trim());
  if (!parsed.success) {
    throw new Error(`Image slicing failed: ${parsed.error || 'Unknown error'}`);
  }

  const slicedCells: { index: number; cardId: string; path: string; width: number; height: number }[] = parsed.cells || [];

  // Query custom cards registry for full card records if available
  let registryCards: any[] = [];
  try {
    registryCards = listCustomCards();
  } catch {
    registryCards = [];
  }
  const registryMap = new Map<number, any>(registryCards.map(r => [r.tempId, r.cardData]));

  const renderedDir = path.resolve(process.cwd(), 'data/rendered_cards');
  if (!fs.existsSync(renderedDir)) {
    fs.mkdirSync(renderedDir, { recursive: true });
  }

  const slicedImages: SlicedImageInfo[] = [];
  const svgCards: string[] = [];

  for (const sliced of slicedCells) {
    const cellManifest = cells.find((c: any) => String(c.cardId) === String(sliced.cardId) || c.index === sliced.index);
    const cardIdNum = typeof cellManifest?.cardId === 'number'
      ? cellManifest.cardId
      : parseInt(sliced.cardId, 10) || (sliced.index + 1);

    const cardName = cellManifest?.cardName || `Custom Card ${cardIdNum}`;

    slicedImages.push({
      cardId: cardIdNum,
      cardName,
      artPath: sliced.path
    });

    // Resolve or construct card data
    const existingCardData = registryMap.get(cardIdNum);
    const cardObj: Card = existingCardData || {
      id: cardIdNum,
      name: cardName,
      type: cellManifest?.type || 'Effect Monster',
      frameType: cellManifest?.frameType || (cellManifest?.type?.toLowerCase().includes('xyz') ? 'xyz' : cellManifest?.type?.toLowerCase().includes('synchro') ? 'synchro' : 'effect'),
      desc: cellManifest?.desc || cellManifest?.artDescription || `Custom card: ${cardName}`,
      atk: cellManifest?.atk ?? 2000,
      def: cellManifest?.def ?? 1500,
      level: cellManifest?.level ?? 4,
      attribute: cellManifest?.attribute || 'DARK',
      race: cellManifest?.race || 'Warrior'
    };

    const svgDestPath = path.resolve(renderedDir, `${cardIdNum}.svg`);
    renderCardSvg(cardObj, cardIdNum, {
      artworkPath: sliced.path,
      outputPath: svgDestPath
    });

    svgCards.push(svgDestPath.replace(/\\/g, '/'));
  }

  return {
    success: true,
    slicedImages,
    svgCards
  };
}
