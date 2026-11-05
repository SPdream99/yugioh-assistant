import http from 'node:http';
import { httpFetch, getHttpStats, __resetHttpState } from './fetch-client.js';

/**
 * Contract test for the shared HTTP client. Uses a local server so it is
 * deterministic and does not depend on any live API.
 */

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`ok - ${message}`);
}

interface ServerHandle {
  port: number;
  counts: Record<string, number>;
  close: () => Promise<void>;
}

async function startServer(): Promise<ServerHandle> {
  const counts: Record<string, number> = { flaky: 0, limited: 0, ok: 0, notfound: 0 };
  const server = http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0].replace('/', '');
    counts[path] = (counts[path] || 0) + 1;

    if (path === 'flaky') {
      if (counts[path] < 3) {
        res.writeHead(503).end('try later');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (path === 'limited') {
      if (counts[path] < 2) {
        res.writeHead(429, { 'retry-after': '0' }).end('slow down');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (path === 'notfound') {
      res.writeHead(404).end('missing');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    counts,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}

async function run() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.port}`;
  __resetHttpState();

  console.log('=== RETRY ON 503 ===');
  const flaky = await httpFetch(`${base}/flaky`, { retries: 2, minSpacingMs: 0 });
  assert(flaky.status === 200, 'a 503 is retried until success');
  assert(server.counts.flaky === 3, 'exactly three attempts were made');

  console.log('\n=== RETRY-AFTER ON 429 ===');
  __resetHttpState();
  const limited = await httpFetch(`${base}/limited`, { retries: 2, minSpacingMs: 0 });
  assert(limited.status === 200, 'a 429 is retried and honoured');
  assert(server.counts.limited === 2, 'one retry after the 429');

  const statsAfterRetry = getHttpStats().find(s => s.host.startsWith('127.0.0.1'));
  console.log('retries counted:', statsAfterRetry?.retries);
  assert((statsAfterRetry?.retries ?? 0) >= 1, 'retries are counted per host');

  console.log('\n=== NO RETRY ON 404 ===');
  __resetHttpState();
  const missing = await httpFetch(`${base}/notfound`, { retries: 2, minSpacingMs: 0 });
  assert(missing.status === 404, '4xx (non-retryable) is returned as-is');
  assert(server.counts.notfound === 1, 'a 404 is never retried');

  console.log('\n=== PER-HOST RATE LIMIT ===');
  __resetHttpState();
  server.counts.ok = 0;
  const started = Date.now();
  await httpFetch(`${base}/ok`, { minSpacingMs: 120 });
  await httpFetch(`${base}/ok`, { minSpacingMs: 120 });
  await httpFetch(`${base}/ok`, { minSpacingMs: 120 });
  const elapsed = Date.now() - started;
  console.log(`3 requests took ${elapsed} ms`);
  assert(elapsed >= 220, 'requests are spaced (at least 2 x 120 ms between 3 calls)');
  assert(server.counts.ok === 3, 'all three requests reached the server');

  console.log('\n=== OFFLINE MODE ===');
  process.env.YGO_OFFLINE = '1';
  let offlineError: any;
  try {
    await httpFetch(`${base}/ok`, { retries: 0 });
  } catch (error) {
    offlineError = error;
  }
  delete process.env.YGO_OFFLINE;
  assert(offlineError?.code === 'OFFLINE', 'YGO_OFFLINE=1 refuses network access before any request');

  console.log('\n=== STATS ===');
  const stats = getHttpStats();
  const host = stats.find(s => s.host.startsWith('127.0.0.1'));
  console.log(host);
  assert(host !== undefined, 'per-host stats are recorded');
  assert(typeof host?.averageLatencyMs === 'number', 'latency is measured');

  await server.close();
  console.log('\nAll HTTP client checks passed.');
}

run().catch(err => {
  console.error('HTTP client test failed:', err);
  process.exit(1);
});
