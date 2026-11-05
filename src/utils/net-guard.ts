import dns from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard for URLs supplied by the caller.
 *
 * Tool inputs can be influenced by untrusted content (an article, a deck
 * description, a prompt injection). Any URL that the server will fetch on the
 * caller's behalf must be a public http(s) endpoint: no loopback, no private
 * ranges, no link-local metadata service, no file/gopher schemes.
 */

export class UnsafeUrlError extends Error {
  readonly code = "UNSAFE_URL";
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "instance-data"
]);

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    return net.isIPv4(mapped) ? isPrivateIPv4(mapped) : true;
  }
  return false;
}

export async function assertSafeHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`Not a valid URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http(s) URLs can be fetched (got ${url.protocol}).`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are refused.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) throw new UnsafeUrlError("URL has no host.");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError(`Refusing to fetch a local host: ${hostname}.`);
  }
  if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".localhost")) {
    throw new UnsafeUrlError(`Refusing to fetch an internal host: ${hostname}.`);
  }

  if (net.isIP(hostname)) {
    if (net.isIPv4(hostname) ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)) {
      throw new UnsafeUrlError(`Refusing to fetch a private address: ${hostname}.`);
    }
    return url;
  }

  // Resolve before connecting so a public name pointing at 127.0.0.1 or the
  // cloud metadata service is refused as well.
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve host: ${hostname}.`);
  }
  if (addresses.length === 0) throw new UnsafeUrlError(`Could not resolve host: ${hostname}.`);
  for (const entry of addresses) {
    const blocked = entry.family === 4 ? isPrivateIPv4(entry.address) : isPrivateIPv6(entry.address);
    if (blocked) {
      throw new UnsafeUrlError(`${hostname} resolves to a private address (${entry.address}).`);
    }
  }

  return url;
}
