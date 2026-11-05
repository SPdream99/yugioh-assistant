import fs from 'node:fs';
import path from 'node:path';
import type { Card } from '../../types/card.js';

export interface RenderCardOptions {
  artworkUrl?: string;
  artworkPath?: string;
  outputPath?: string;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wraps text into lines that fit within maxCharsPerLine.
 */
function wrapText(text: string, maxCharsPerLine = 48): string[] {
  if (!text) return [];
  const paragraphs = text.split('\n');
  const result: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      result.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
        currentLine += ' ' + word;
      } else {
        result.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

/**
 * Returns accurate hex color for card frame.
 */
function getFrameColor(card: Partial<Card>): { frame: string; border: string; textDark: boolean } {
  const frameType = (card.frameType || '').toLowerCase();
  const cardType = (card.type || '').toLowerCase();

  if (frameType === 'normal' || (cardType.includes('normal') && !cardType.includes('spell') && !cardType.includes('trap'))) {
    return { frame: '#D29548', border: '#9E6D30', textDark: true };
  }
  if (frameType === 'effect' || cardType.includes('effect')) {
    return { frame: '#C6682B', border: '#8A4114', textDark: false };
  }
  if (frameType === 'ritual' || cardType.includes('ritual')) {
    return { frame: '#6488BE', border: '#3C5C8C', textDark: false };
  }
  if (frameType === 'fusion' || cardType.includes('fusion')) {
    return { frame: '#8D54A2', border: '#5C316C', textDark: false };
  }
  if (frameType === 'synchro' || cardType.includes('synchro')) {
    return { frame: '#EFEFEF', border: '#B5B5B5', textDark: true };
  }
  if (frameType === 'xyz' || cardType.includes('xyz')) {
    return { frame: '#222222', border: '#444444', textDark: false };
  }
  if (frameType === 'link' || cardType.includes('link')) {
    return { frame: '#004D99', border: '#002E5C', textDark: false };
  }
  if (frameType === 'spell' || cardType.includes('spell')) {
    return { frame: '#1D9E74', border: '#11684B', textDark: false };
  }
  if (frameType === 'trap' || cardType.includes('trap')) {
    return { frame: '#BD2976', border: '#7E174D', textDark: false };
  }

  return { frame: '#C6682B', border: '#8A4114', textDark: false };
}

/**
 * Returns attribute circle color and label.
 */
function getAttributeInfo(card: Partial<Card>): { color: string; label: string } {
  const attr = (card.attribute || '').toUpperCase();
  const cardType = (card.type || '').toLowerCase();

  if (cardType.includes('spell')) return { color: '#1D9E74', label: 'SPELL' };
  if (cardType.includes('trap')) return { color: '#BD2976', label: 'TRAP' };

  switch (attr) {
    case 'DARK':
      return { color: '#56255E', label: 'DARK' };
    case 'LIGHT':
      return { color: '#C8A836', label: 'LIGHT' };
    case 'EARTH':
      return { color: '#7D5737', label: 'EARTH' };
    case 'WATER':
      return { color: '#276E9B', label: 'WATER' };
    case 'FIRE':
      return { color: '#B3261E', label: 'FIRE' };
    case 'WIND':
      return { color: '#2B8A62', label: 'WIND' };
    case 'DIVINE':
      return { color: '#D4AF37', label: 'DIVINE' };
    default:
      return { color: '#444444', label: attr || 'DARK' };
  }
}

/**
 * Generates an SVG 5-pointed star.
 */
function renderStar(x: number, y: number, radius: number, isRank: boolean): string {
  const points: string[] = [];
  const spikes = 5;
  const innerRadius = radius * 0.45;

  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? radius : innerRadius;
    const angle = (i * Math.PI) / spikes - Math.PI / 2;
    points.push(`${(x + Math.cos(angle) * r).toFixed(1)},${(y + Math.sin(angle) * r).toFixed(1)}`);
  }

  const bgFill = isRank ? '#1A1A1A' : '#E65100';
  const starFill = isRank ? '#FFD700' : '#FFEB3B';

  return `
    <circle cx="${x}" cy="${y}" r="${radius}" fill="${bgFill}" stroke="#000" stroke-width="0.8" />
    <polygon points="${points.join(' ')}" fill="${starFill}" stroke="#B78103" stroke-width="0.5" />
  `;
}

/**
 * Generates high-fidelity SVG representation of a Yu-Gi-Oh card.
 */
export function renderCardSvg(
  card: Card,
  tempIdOrOfficialId: number,
  options?: RenderCardOptions
): string {
  const width = 420;
  const height = 610;

  const { frame, border, textDark } = getFrameColor(card);
  const cardName = escapeXml(card.name || 'Unnamed Card');
  const cardType = (card.type || '').toLowerCase();
  const frameType = (card.frameType || '').toLowerCase();
  const isMonster = !cardType.includes('spell') && !cardType.includes('trap');
  const isXyz = frameType === 'xyz' || cardType.includes('xyz');
  const isLink = frameType === 'link' || cardType.includes('link');
  const level = card.level || 0;
  const linkVal = card.linkval || (card.linkmarkers ? card.linkmarkers.length : 2);
  const attrInfo = getAttributeInfo(card);
  const formattedId = String(tempIdOrOfficialId).padStart(8, '0');

  const nameTextColor = textDark ? '#111111' : '#FFFFFF';
  const nameShadowColor = textDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.8)';

  // Build Stars or Spell/Trap/Link banner
  let levelStarsSvg = '';
  if (isMonster) {
    if (isXyz) {
      // Rank stars: Left to Right
      const starRadius = 8.5;
      const startX = 54;
      const starSpacing = 20;
      let stars = '';
      for (let i = 0; i < Math.min(level, 13); i++) {
        stars += renderStar(startX + i * starSpacing, 74, starRadius, true);
      }
      levelStarsSvg = stars;
    } else if (isLink) {
      // Link Rating indicator at the top right of the level area
      levelStarsSvg = `
        <text x="364" y="80" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#00E5FF" text-anchor="end">LINK - ${linkVal}</text>
      `;
    } else if (level > 0) {
      // Level stars: Right to Left
      const starRadius = 8.5;
      const startX = 364;
      const starSpacing = 20;
      let stars = '';
      for (let i = 0; i < Math.min(level, 13); i++) {
        stars += renderStar(startX - i * starSpacing, 74, starRadius, false);
      }
      levelStarsSvg = stars;
    }
  } else {
    // Spell or Trap label
    const typeLabel = cardType.includes('spell') ? '[Spell Card]' : '[Trap Card]';
    let icon = '';
    if (cardType.includes('quick-play')) icon = ' [Quick-Play]';
    else if (cardType.includes('continuous')) icon = ' [Continuous]';
    else if (cardType.includes('counter')) icon = ' [Counter]';
    else if (cardType.includes('equip')) icon = ' [Equip]';
    else if (cardType.includes('field')) icon = ' [Field]';

    levelStarsSvg = `
      <text x="370" y="80" font-family="'Times New Roman', serif" font-size="14" font-weight="bold" fill="${nameTextColor}" text-anchor="end">${escapeXml(typeLabel + icon)}</text>
    `;
  }

  // Type line text
  let typeLine = '';
  if (isMonster) {
    const race = card.race || 'Warrior';
    const subTypes: string[] = [];
    if (cardType.includes('synchro')) subTypes.push('Synchro');
    if (cardType.includes('xyz')) subTypes.push('Xyz');
    if (cardType.includes('fusion')) subTypes.push('Fusion');
    if (cardType.includes('ritual')) subTypes.push('Ritual');
    if (cardType.includes('link')) subTypes.push('Link');
    if (cardType.includes('tuner')) subTypes.push('Tuner');
    if (cardType.includes('effect')) subTypes.push('Effect');
    else if (cardType.includes('normal')) subTypes.push('Normal');

    typeLine = `[ ${race} / ${subTypes.join(' / ')} ]`;
  }

  // Wrapped Description lines
  const descLines = wrapText(card.desc || '', 52);
  const maxLinesToShow = 11;
  const truncatedDesc = descLines.slice(0, maxLinesToShow);
  const descTspans = truncatedDesc
    .map((line, idx) => `<tspan x="42" y="${402 + idx * 13}">${escapeXml(line)}</tspan>`)
    .join('\n');

  // Link Arrows SVG (if Link monster)
  let linkArrowsSvg = '';
  if (isLink) {
    const markers = (card.linkmarkers || []).map((m) => m.toLowerCase());
    const hasMarker = (name: string) => markers.includes(name);

    // 8 Arrow directions around artwork (x=44, y=94, w=332, h=258)
    const arrow = (x: number, y: number, rot: number, active: boolean) => `
      <polygon points="0,-10 8,6 -8,6" fill="${active ? '#FF3D00' : 'rgba(100,100,100,0.3)'}" stroke="${active ? '#FFD600' : 'none'}" stroke-width="1" transform="translate(${x},${y}) rotate(${rot})" />
    `;

    linkArrowsSvg = `
      <!-- Link Arrows -->
      ${arrow(44, 94, -45, hasMarker('top-left'))}
      ${arrow(210, 88, 0, hasMarker('top'))}
      ${arrow(376, 94, 45, hasMarker('top-right'))}
      ${arrow(382, 223, 90, hasMarker('right'))}
      ${arrow(376, 352, 135, hasMarker('bottom-right'))}
      ${arrow(210, 358, 180, hasMarker('bottom'))}
      ${arrow(44, 352, -135, hasMarker('bottom-left'))}
      ${arrow(38, 223, -90, hasMarker('left'))}
    `;
  }

  // Artwork image or placeholder
  let artworkHref = options?.artworkUrl || card.card_images?.[0]?.image_url;

  if (options?.artworkPath && fs.existsSync(options.artworkPath)) {
    try {
      const ext = path.extname(options.artworkPath).toLowerCase().replace('.', '');
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
      const fileBuffer = fs.readFileSync(options.artworkPath);
      artworkHref = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
    } catch (err) {
      console.warn(`Warning: Could not read artwork file ${options.artworkPath}:`, err);
    }
  }

  const artworkSvg = artworkHref
    ? `<image href="${escapeXml(artworkHref)}" x="46" y="96" width="328" height="254" preserveAspectRatio="xMidYMid slice" />`
    : `
      <rect x="46" y="96" width="328" height="254" fill="url(#artworkGrad)" />
      <circle cx="210" cy="223" r="54" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3" />
      <text x="210" y="220" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="rgba(255,255,255,0.7)" text-anchor="middle">${escapeXml(card.name || 'ARTWORK')}</text>
      <text x="210" y="240" font-family="Arial, sans-serif" font-size="11" fill="rgba(255,255,255,0.5)" text-anchor="middle">${escapeXml(card.archetype || 'Custom Card')}</text>
    `;

  // ATK / DEF bar
  let atkDefSvg = '';
  if (isMonster) {
    if (isLink) {
      atkDefSvg = `
        <line x1="38" y1="538" x2="382" y2="538" stroke="#333" stroke-width="0.8" />
        <text x="376" y="552" font-family="'Times New Roman', serif" font-size="14" font-weight="bold" fill="#111" text-anchor="end">
          ATK/ <tspan font-family="Arial, sans-serif" font-weight="bold">${card.atk ?? 0}</tspan>  LINK- <tspan font-family="Arial, sans-serif" font-weight="bold" fill="#004D99">${linkVal}</tspan>
        </text>
      `;
    } else {
      atkDefSvg = `
        <line x1="38" y1="538" x2="382" y2="538" stroke="#333" stroke-width="0.8" />
        <text x="376" y="552" font-family="'Times New Roman', serif" font-size="14" font-weight="bold" fill="#111" text-anchor="end">
          ATK/ <tspan font-family="Arial, sans-serif" font-weight="bold">${card.atk ?? 0}</tspan>  DEF/ <tspan font-family="Arial, sans-serif" font-weight="bold">${card.def ?? 0}</tspan>
        </text>
      `;
    }
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <!-- Background Frame Gradients -->
    <linearGradient id="frameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${frame}" />
      <stop offset="100%" stop-color="${border}" />
    </linearGradient>

    <!-- Name Bar Gradient -->
    <linearGradient id="nameBarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
      <stop offset="40%" stop-color="rgba(255,255,255,0.15)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.25)" />
    </linearGradient>

    <!-- Artwork Placeholder Gradient -->
    <linearGradient id="artworkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1B263B" />
      <stop offset="50%" stop-color="#0D1B2A" />
      <stop offset="100%" stop-color="#415A77" />
    </linearGradient>

    <!-- Text Box Parchment Gradient -->
    <linearGradient id="loreBoxGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFDF5" />
      <stop offset="100%" stop-color="#F2ECD8" />
    </linearGradient>

    <!-- Hologram Foil Gradient -->
    <linearGradient id="holoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#E0E0E0" />
      <stop offset="30%" stop-color="#FFD700" />
      <stop offset="60%" stop-color="#00E5FF" />
      <stop offset="100%" stop-color="#E0E0E0" />
    </linearGradient>

    <filter id="cardShadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="2" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.5" />
    </filter>
  </defs>

  <!-- Outer Card Frame -->
  <rect x="6" y="6" width="408" height="598" rx="14" ry="14" fill="url(#frameGrad)" stroke="#111" stroke-width="2" filter="url(#cardShadow)" />
  <rect x="18" y="18" width="384" height="574" rx="8" ry="8" fill="none" stroke="${border}" stroke-width="2.5" />

  <!-- Name Banner -->
  <rect x="26" y="24" width="324" height="36" rx="4" fill="url(#nameBarGrad)" stroke="#D4AF37" stroke-width="1.2" />
  <text x="36" y="49" font-family="'Times New Roman', Georgia, serif" font-size="19" font-weight="bold" fill="${nameTextColor}" style="text-shadow: 1px 1px 2px ${nameShadowColor}; letter-spacing: 0.3px;">
    ${cardName}
  </text>

  <!-- Attribute Circle -->
  <circle cx="374" cy="42" r="16" fill="${attrInfo.color}" stroke="#D4AF37" stroke-width="1.5" />
  <text x="374" y="46" font-family="Arial, sans-serif" font-size="9" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="0.5">
    ${attrInfo.label}
  </text>

  <!-- Level / Rank / Spell-Trap Banner -->
  ${levelStarsSvg}

  <!-- Artwork Outer Frame & Box -->
  <rect x="42" y="92" width="336" height="262" fill="#111111" stroke="#D4AF37" stroke-width="1.5" />
  ${artworkSvg}
  ${linkArrowsSvg}

  <!-- Lore / Description Box -->
  <rect x="30" y="364" width="360" height="200" rx="3" fill="url(#loreBoxGrad)" stroke="#D4AF37" stroke-width="1.5" />

  <!-- Type Line -->
  ${
    typeLine
      ? `<text x="38" y="382" font-family="'Times New Roman', serif" font-size="12.5" font-weight="bold" fill="#111">${escapeXml(typeLine)}</text>
         <line x1="38" y1="388" x2="382" y2="388" stroke="#444" stroke-width="0.8" />`
      : ''
  }

  <!-- Lore Description Text -->
  <text font-family="'Yu-Gi-Oh Matrix Book', 'Times New Roman', serif" font-size="11" fill="#111111" letter-spacing="0.1px">
    ${descTspans}
  </text>

  <!-- ATK / DEF Line -->
  ${atkDefSvg}

  <!-- Bottom Details: Passcode, Hologram, Copyright -->
  <text x="28" y="586" font-family="Consolas, monospace" font-size="10" font-weight="bold" fill="${textDark ? '#222' : '#EEE'}">
    ${formattedId}
  </text>

  <!-- Eye of Anubis Foil Hologram Stamp -->
  <rect x="376" y="572" width="14" height="14" fill="url(#holoGrad)" stroke="#888" stroke-width="0.5" />

  <text x="370" y="586" font-family="Arial, sans-serif" font-size="8.5" fill="${textDark ? '#222' : '#EEE'}" text-anchor="end">
    © 2026 Yu-Gi-Oh! / Studio Dice
  </text>
</svg>`.trim();

  // Handle output file if requested
  const destPath = options?.outputPath || path.resolve(process.cwd(), `data/rendered_cards/${tempIdOrOfficialId}.svg`);
  try {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(destPath, svg, 'utf-8');
  } catch (err) {
    console.warn(`Warning: Could not save rendered SVG to ${destPath}:`, err);
  }

  return svg;
}
