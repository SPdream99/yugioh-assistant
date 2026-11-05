import type { DeckData } from '../../types/deck.js';

/**
 * Decodes a base64 encoded section of 32-bit unsigned little-endian integers.
 */
function decodeSection(base64Str: string): number[] {
  const trimmed = base64Str.trim();
  if (!trimmed) {
    return [];
  }

  // Handle URL-safe base64 conversion
  let normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4 !== 0) {
    normalized += '=';
  }

  const buffer = Buffer.from(normalized, 'base64');
  const passcodes: number[] = [];

  for (let offset = 0; offset + 4 <= buffer.length; offset += 4) {
    passcodes.push(buffer.readUInt32LE(offset));
  }

  return passcodes;
}

/**
 * Encodes an array of card passcodes into a 32-bit unsigned little-endian base64 string.
 */
function encodeSection(items: (number | string | any)[]): string {
  if (!items || items.length === 0) {
    return '';
  }

  const passcodes = items.map(item => {
    if (typeof item === 'number') return item;
    if (typeof item === 'string') {
      const parsed = parseInt(item, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return item && typeof item.id === 'number' ? item.id : 0;
  });

  const buffer = Buffer.alloc(passcodes.length * 4);
  for (let i = 0; i < passcodes.length; i++) {
    buffer.writeUInt32LE(passcodes[i], i * 4);
  }

  return buffer.toString('base64');
}

/**
 * Parses a YDKE URL / string into a DeckData object.
 *
 * YDKE specification:
 * ydke://<base64_main>!<base64_extra>!<base64_side>!
 */
export function parseYdke(ydkeUrl: string, name?: string): DeckData {
  let cleaned = ydkeUrl.trim();
  if (cleaned.startsWith('ydke://')) {
    cleaned = cleaned.substring(7);
  }

  const parts = cleaned.split('!');
  const mainStr = parts[0] || '';
  const extraStr = parts[1] || '';
  const sideStr = parts[2] || '';

  return {
    name,
    main: decodeSection(mainStr),
    extra: decodeSection(extraStr),
    side: decodeSection(sideStr)
  };
}

/**
 * Formats DeckData into a standard YDKE URL string.
 */
export function formatYdke(deck: DeckData): string {
  const mainBase64 = encodeSection(deck.main || []);
  const extraBase64 = encodeSection(deck.extra || []);
  const sideBase64 = encodeSection(deck.side || []);

  return `ydke://${mainBase64}!${extraBase64}!${sideBase64}!`;
}
