import fs from 'node:fs';
import path from 'node:path';
import { getDataRoot } from '../../utils/paths.js';
import { httpFetch } from '../http/fetch-client.js';

/**
 * Konami's official deck registration form is not redistributed with this
 * project. It is downloaded on first use into the local data directory (or
 * supplied by the user through `YGO_KDE_TEMPLATE`), and only used to fill a
 * blank form for personal deck registration.
 */

const SOURCES = [
  'https://www.yugioh-card.com/en/downloads/forms/KDE_DeckList.pdf',
  'https://img.yugioh-card.com/en/downloads/forms/KDE_DeckList.pdf'
];

const MIN_BYTES = 50_000;

export function kdeTemplatePath(): string {
  const override = process.env.YGO_KDE_TEMPLATE;
  if (override && override.trim()) return path.resolve(override);
  return path.join(getDataRoot(), 'data', 'templates', 'KDE_DeckList.pdf');
}

function looksLikePdf(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (stat.size < MIN_BYTES) return false;
    const fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    return header.toString('latin1') === '%PDF';
  } catch {
    return false;
  }
}

export interface KdeTemplateResult {
  path: string;
  downloaded: boolean;
  bytes: number;
}

export async function ensureKdeTemplate(force = false): Promise<KdeTemplateResult> {
  const target = kdeTemplatePath();

  if (!force && looksLikePdf(target)) {
    return { path: target, downloaded: false, bytes: fs.statSync(target).size };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const errors: string[] = [];

  for (const url of SOURCES) {
    try {
      const response = await httpFetch(url, {
        timeoutMs: 30_000,
        retries: 1,
        headers: { Accept: 'application/pdf' }
      });
      if (!response.ok) {
        errors.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < MIN_BYTES || bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
        errors.push(`${url}: response is not the deck-list PDF`);
        continue;
      }
      const temp = `${target}.part`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, target);
      return { path: target, downloaded: true, bytes: bytes.length };
    } catch (error) {
      errors.push(`${url}: ${(error as Error).message}`);
    }
  }

  throw new Error(
    `Could not download Konami's deck-list form (${errors.join(' | ')}). ` +
      'Run `ygo fetch-data` when the network is available, or set YGO_KDE_TEMPLATE to a local copy.'
  );
}
