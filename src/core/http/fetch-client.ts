import { getVersion } from '../../utils/version.js';

/**
 * One HTTP entry point for every outbound call.
 *
 * Why: the public APIs this server depends on are free and rate-limited. TCGCSV
 * explicitly asks for a custom User-Agent and modest request rates, and YGOPRODeck
 * / Master Duel Meta will answer 429 or 5xx under load. A published tool must not
 * hammer them, and a transient 503 must not become a failed answer.
 *
 * Behaviour:
 *  - per-host FIFO queue with a minimum spacing between requests
 *  - retry on 408/425/429/500/502/503/504 and network errors
 *  - honours Retry-After (seconds or HTTP date)
 *  - exponential backoff with jitter for everything else
 *  - per-host stats exposed for `ygo doctor`
 */

export interface HttpStats {  host: string;
  requests: number;
  retries: number;
  failures: number;
  lastStatus?: number;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  averageLatencyMs?: number;
}

interface HostState {
  queue: Promise<unknown>;
  lastRequestAt: number;
  requests: number;
  retries: number;
  failures: number;
  latencySum: number;
  latencyCount: number;
  lastStatus?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  /** Next time a request is allowed (used when a Retry-After is received). */
  blockedUntil: number;
}

const hostStates = new Map<string, HostState>();
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Thrown when the process is running with YGO_OFFLINE=1. */
export class OfflineError extends Error {
  readonly code = 'OFFLINE';
  constructor(url: string) {
    super(`Offline mode is on; refusing network request to ${new URL(url).host}`);
    this.name = 'OfflineError';
  }
}

export function isOfflineMode(): boolean {
  const value = process.env.YGO_OFFLINE;
  return value === '1' || value?.toLowerCase() === 'true';
}
const DEFAULT_RETRIES = 2; // 3 attempts total
const DEFAULT_TIMEOUT_MS = 20_000;

/** TCGCSV asks for slower pacing than the other APIs. */
const DEFAULT_SPACING: Record<string, number> = {
  'tcgcsv.com': 250
};
const FALLBACK_SPACING_MS = 120;

export interface HttpOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  /** Override the per-host spacing (used by tests). */
  minSpacingMs?: number;
  /** Short label for diagnostics, e.g. "tcgcsv:prices". */
  label?: string;
}

function stateFor(host: string): HostState {
  let state = hostStates.get(host);
  if (!state) {
    state = {
      queue: Promise.resolve(),
      lastRequestAt: 0,
      requests: 0,
      retries: 0,
      failures: 0,
      latencySum: 0,
      latencyCount: 0,
      blockedUntil: 0
    };
    hostStates.set(host, state);
  }
  return state;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function defaultHeaders(): Headers {
  return new Headers({
    'User-Agent': `yugioh-assistant-mcp/${getVersion()}`,
    Accept: 'application/json, text/html;q=0.9, */*;q=0.8'
  });
}

async function execute(url: string, options: HttpOptions, state: HostState): Promise<Response> {
  const host = new URL(url).host;
  const spacing = options.minSpacingMs ?? DEFAULT_SPACING[host] ?? FALLBACK_SPACING_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;

  const headers = options.headers ? new Headers(options.headers) : defaultHeaders();
  if (!headers.has('User-Agent')) headers.set('User-Agent', `yugioh-assistant-mcp/${getVersion()}`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const wait = Math.max(0, state.lastRequestAt + spacing - Date.now(), state.blockedUntil - Date.now());
    if (wait > 0) await sleep(wait);

    state.lastRequestAt = Date.now();
    state.requests++;

    const controller = new AbortController();
    const callerSignal = options.signal;
    const onAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) throw new DOMException('Aborted', 'AbortError');
      callerSignal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(url, { ...options, headers, signal: controller.signal });
      state.latencySum += Date.now() - started;
      state.latencyCount++;
      state.lastStatus = response.status;

      if (!response.ok && RETRYABLE.has(response.status) && attempt < maxRetries) {
        state.retries++;
        const retryAfter = retryAfterMs(response);
        const backoff = retryAfter ?? Math.round(250 * Math.pow(2, attempt) + Math.random() * 120);
        if (response.status === 429) state.blockedUntil = Date.now() + backoff;
        await sleep(backoff);
        continue;
      }

      if (!response.ok) state.failures++;
      else state.lastSuccessAt = Date.now();
      return response;
    } catch (error) {
      state.failures++;
      state.lastErrorAt = Date.now();
      state.lastError = (error as Error).message;
      if (callerSignal?.aborted || attempt >= maxRetries) throw error;
      state.retries++;
      await sleep(Math.round(250 * Math.pow(2, attempt) + Math.random() * 120));
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onAbort);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new Error(`Request failed after retries: ${url}`);
}

/**
 * Queued, retried, rate-limited fetch. Same signature surface as `fetch` plus
 * timeout/retry/spacing overrides.
 */
export async function httpFetch(url: string, options: HttpOptions = {}): Promise<Response> {
  if (isOfflineMode()) throw new OfflineError(url);
  const host = new URL(url).host;
  const state = stateFor(host);
  const run = () => execute(url, options, state);
  // Serialise per host: the next request starts only after the previous settled.
  const task = state.queue.then(run, run);
  state.queue = task.catch(() => undefined);
  return task;
}

export function getHttpStats(): HttpStats[] {
  return [...hostStates.entries()]
    .map(([host, state]) => ({
      host,
      requests: state.requests,
      retries: state.retries,
      failures: state.failures,
      lastStatus: state.lastStatus,
      lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : undefined,
      lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt).toISOString() : undefined,
      lastError: state.lastError,
      averageLatencyMs:
        state.latencyCount > 0 ? Math.round(state.latencySum / state.latencyCount) : undefined
    }))
    .sort((a, b) => b.requests - a.requests);
}

/** Test hook: forget counters and queues. */
export function __resetHttpState(): void {
  hostStates.clear();
}
