import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `execFileSync('npm', …, { shell: true })` is the portable way to run npm on
// Windows; Node emits DEP0190 for it. Silence only this script's warning.
process.noDeprecation = true;

/**
 * Publish smoke test: pack the package, install it into a clean temp project,
 * then speak MCP to the installed copy.
 *
 * `npm test` runs from the repo, so it cannot catch a missing `files` entry, a
 * broken `bin`, or a `dist` that only works because `src/` is still around.
 * This can.
 */

const EXPECTED_TOOLS = 54;
const root = process.cwd();

function log(step) {
  console.log(`\n== ${step}`);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

async function mcpHandshake(entry, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let replied = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timeout waiting for tools/list'));
    }, 20_000);

    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      for (const line of buffer.split('\n')) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          if (!message.result?.instructions) {
            child.kill();
            clearTimeout(timer);
            reject(new Error('initialize result is missing instructions'));
            return;
          }
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
        }
        if (message.id === 2) {
          replied = true;
          const tools = message.result?.tools || [];
          child.kill();
          clearTimeout(timer);
          resolve({ toolCount: tools.length, names: tools.map(t => t.name) });
        }
      }
      buffer = buffer.includes('\n') ? buffer.slice(buffer.lastIndexOf('\n') + 1) : buffer;
    });

    child.stderr.on('data', () => undefined);
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', code => {
      if (!replied) {
        clearTimeout(timer);
        reject(new Error(`server exited early (code ${code})`));
      }
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'pack-smoke', version: '0.0.0' }
        }
      }) + '\n'
    );
  });
}

async function run() {
  const version = packageVersion();
  log(`packing yugioh-assistant-mcp@${version}`);
  const packedRaw = JSON.parse(
    execFileSync('npm', ['pack', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: true
    })
  );
  const info = Array.isArray(packedRaw) ? packedRaw[0] : Object.values(packedRaw)[0];
  const tarball = path.join(root, info.filename);
  if (!fs.existsSync(tarball)) fail('npm pack did not produce a tarball');
  console.log(`${info.filename} — ${info.size} bytes, ${info.entryCount ?? info.files?.length ?? '?'} files`);

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ygo-pack-smoke-'));
  const projectDir = path.join(workdir, 'app');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'ygo-pack-smoke', private: true, version: '0.0.0' }, null, 2)
  );

  try {
    log('installing the tarball into a clean project');
    execFileSync('npm', ['install', tarball, '--no-audit', '--no-fund', '--ignore-scripts'], {
      cwd: projectDir,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: true
    });

    const installed = path.join(projectDir, 'node_modules', 'yugioh-assistant-mcp');
    if (!fs.existsSync(installed)) fail('package was not installed');

    log('checking published files');
    for (const required of [
      'dist/index.js',
      'dist/cli/index.js',
      'dist/core/http/fetch-client.js',
      'src/core/deck-export/fill_kde_decklist_pdf.py',
      'src/core/deck-export/render_deck_grid.py',
      'src/core/custom-cards/slice_grid.py',
      'skills/yugioh-assistant-mcp/SKILL.md',
      'docs/TOOLS.md',
      'docs/TECHNICAL.md',
      'docs/CREDITS.md',
      'docs/LEGAL.md',
      'SECURITY.md',
      'NOTICE',
      'LICENSE',
      'CHANGELOG.md'
    ]) {
      if (!fs.existsSync(path.join(installed, required))) fail(`missing from the package: ${required}`);
    }
    if (fs.existsSync(path.join(installed, 'dist', 'test_e2e.js'))) fail('compiled tests leaked into the package');
    for (const excluded of ['src/core/deck-export/__pycache__']) {
      if (fs.existsSync(path.join(installed, excluded))) fail(`maintainer-only file leaked into the package: ${excluded}`);
    }
    if (fs.existsSync(path.join(installed, 'data', 'cache'))) fail('local cache leaked into the package');

    log('resolving the CLI bin');
    const bin = path.join(projectDir, 'node_modules', '.bin', process.platform === 'win32' ? 'ygo.cmd' : 'ygo');
    if (!fs.existsSync(bin)) fail('the ygo bin was not linked');

    log('MCP initialize + tools/list');
    const result = await mcpHandshake(path.join(installed, 'dist', 'index.js'), projectDir);
    console.log(`tools: ${result.toolCount}`);
    if (result.toolCount !== EXPECTED_TOOLS) fail(`expected ${EXPECTED_TOOLS} tools, got ${result.toolCount}`);
    for (const name of ['ygo_market_query', 'ygo_card_printing_prices', 'ygo_find_community_decks', 'ygo_find_counters']) {
      if (!result.names.includes(name)) fail(`tool missing from the installed package: ${name}`);
    }

    console.log('\nPACK SMOKE PASSED');
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
    fs.rmSync(tarball, { force: true });
  }
}

run().catch(error => {
  console.error('Pack smoke failed:', error);
  process.exit(1);
});
