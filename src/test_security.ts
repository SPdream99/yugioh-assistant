import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSafeHttpUrl } from './utils/net-guard.js';
import { guardOutputPath, readTextFileSafe } from './utils/safe-path.js';
import { extractCardFromArticle } from './core/news-rulings/news-card-extractor.js';
import { renderDeckGridPng } from './core/deck-export/deck-image.js';

/**
 * Security regression tests: the guards that stop a tool call from becoming a
 * shell command, an arbitrary file write/read, or an SSRF probe.
 */

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`ok - ${message}`);
}

async function rejects(url: string, label: string): Promise<void> {
  let blocked = false;
  try {
    await assertSafeHttpUrl(url);
  } catch {
    blocked = true;
  }
  assert(blocked, label);
}

async function run() {
  console.log('=== SSRF GUARD ===');
  await rejects('http://127.0.0.1/', 'loopback is refused');
  await rejects('http://localhost:8080/', 'localhost is refused');
  await rejects('http://169.254.169.254/latest/meta-data/', 'cloud metadata is refused');
  await rejects('http://10.0.0.5/', 'private IPv4 is refused');
  await rejects('http://[::1]/', 'IPv6 loopback is refused');
  await rejects('file:///etc/passwd', 'non-http scheme is refused');

  const safe = await assertSafeHttpUrl('https://ygoprodeck.com/api-guide/');
  assert(safe.hostname === 'ygoprodeck.com', 'a public https URL is accepted');

  const ssrf = await extractCardFromArticle('http://127.0.0.1:9/secret');
  assert(ssrf.available === false, 'the article extractor refuses a loopback URL');

  console.log('\n=== OUTPUT PATH GUARD ===');
  const outside = guardOutputPath(process.platform === 'win32' ? 'C:\\Windows\\evil.png' : '/etc/evil.png');
  assert(!outside.ok, 'a write outside the project is refused');
  const inside = guardOutputPath(path.join(process.cwd(), 'data', 'deck_exports', 'ok.png'));
  assert(inside.ok, 'a write inside the project is allowed');
  assert(!guardOutputPath('/tmp/not-a-game/YGO Omega-file').ok, 'a lookalike game-root name is refused');

  console.log('\n=== FILE READ GUARD ===');
  const big = path.join(os.tmpdir(), `ygo-big-${Date.now()}.ydk`);
  fs.writeFileSync(big, 'x'.repeat(2_000_001));
  const bigRead = readTextFileSafe(big);
  fs.rmSync(big, { force: true });
  assert(!bigRead.ok, 'a text read above the size cap is refused');

  const binary = path.join(os.tmpdir(), `ygo-bin-${Date.now()}.ydk`);
  fs.writeFileSync(binary, Buffer.from([0, 1, 2, 3]));
  const binaryRead = readTextFileSafe(binary);
  fs.rmSync(binary, { force: true });
  assert(!binaryRead.ok, 'a binary file is refused as a deck list');

  console.log('\n=== COMMAND INJECTION (deck title) ===');
  const marker = path.join(os.tmpdir(), `ygo-pwned-${Date.now()}`);
  const title = `x"; require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', 'pwned'); echo "`;
  try {
    await renderDeckGridPng({
      input: { main: [14558127, 14558127, 14558127], extra: [], side: [] },
      title,
      lang: 'en',
      outputPath: path.join(process.cwd(), 'data', 'deck_exports', `security-${Date.now()}.png`)
    });
  } catch {
    // Rendering may fail without the image assets; the marker is what matters.
  }
  assert(!fs.existsSync(marker), 'a title containing shell metacharacters executes nothing');

  console.log('\nAll security checks passed.');
}

run().catch(err => {
  console.error('Security test failed:', err);
  process.exit(1);
});
