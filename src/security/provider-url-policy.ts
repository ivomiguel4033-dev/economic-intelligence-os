import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PROVIDER_DNS_TIMEOUT_MS = 5_000;
const MAX_PROVIDER_DNS_ADDRESSES = 32;

function normalizedHostname(url: URL): string {
  const rawHost = url.hostname.toLowerCase();
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
  return host.replace(/\.+$/, "");
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [first, second, third] = octets;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) || first >= 224;
}

function isPrivateIpv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  if (/^100:0*:/i.test(host) || /^2001:0*2:/i.test(host) || /^2001:db8:/i.test(host) || /^3fff:/i.test(host) || /^ff[0-9a-f]{2}:/i.test(host)) return true;
  // NAT64 prefixes can translate an apparently public IPv6 endpoint into an
  // arbitrary IPv4 destination. Fail closed so provider SSRF policy is not
  // bypassed through the well-known or local-use translation prefixes.
  if (/^64:ff9b::/i.test(host) || /^64:ff9b:0:0:0:0:/i.test(host) || /^64:ff9b:1:/i.test(host)) return true;
  if (/^::ffff:/i.test(host)) return true;
  return false;
}

function isUnsafeResolvedAddress(address: string): boolean {
  return isPrivateIpv4(address) || isPrivateIpv6(address);
}

export function assertSafeProviderAddress(address: string): void {
  if (isIP(address) === 0 || isUnsafeResolvedAddress(address)) {
    throw new Error("AI provider address must be a public IP address");
  }
}

function canonicalAddressSet(addresses: Array<{ address: string }>): string[] {
  return [...new Set(addresses.map(({ address }) => address.toLowerCase()))].sort();
}

async function lookupWithTimeout(host: string, signal?: AbortSignal): Promise<Array<{ address: string }>> {
  if (signal?.aborted) throw signal.reason ?? new Error("AI provider DNS resolution aborted");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    const abortPromise = new Promise<never>((_resolve, reject) => {
      if (!signal) return;
      abortHandler = () => reject(signal.reason ?? new Error("AI provider DNS resolution aborted"));
      signal.addEventListener("abort", abortHandler, { once: true });
    });
    return await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("AI provider DNS resolution timed out")), PROVIDER_DNS_TIMEOUT_MS);
      }),
      abortPromise,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

async function resolvePublicProviderAddresses(url: URL, signal?: AbortSignal): Promise<string[]> {
  const host = normalizedHostname(url);
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) throw new Error("Private-network AI provider endpoints are not allowed");
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupWithTimeout(host, signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw new Error("AI provider hostname could not be resolved safely");
  }
  if (addresses.length > MAX_PROVIDER_DNS_ADDRESSES) {
    throw new Error("AI provider hostname resolved to too many addresses");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isIP(address) === 0 || isUnsafeResolvedAddress(address))) {
    throw new Error("AI provider hostname resolved to a non-public address");
  }
  return canonicalAddressSet(addresses);
}

export function assertSafeProviderUrl(value: string): URL {
  // WHATWG URL parsing strips control characters and normalizes backslashes.
  // Validate the literal endpoint before it can be silently rewritten.
  if (/[\u0000-\u001f\u007f]/.test(value) || value !== value.trim() || value.includes("\\")) {
    throw new Error("AI provider endpoint must not contain whitespace, control characters or backslashes");
  }
  // Require explicit percent-encoding instead of silently rewriting spaces in paths.
  if (value.includes(" ")) throw new Error("AI provider endpoint must not contain literal spaces");
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || authority.includes("@")) {
    throw new Error("AI provider endpoint must include an explicit authority without credentials");
  }
  // URL parsing decodes percent-encoded host bytes (for example %61 -> a).
  // Keep the runtime policy aligned with the production preflight: never
  // approve a hostname whose literal configured authority was rewritten.
  if (authority.includes("%")) {
    throw new Error("AI provider endpoint must not contain percent-encoded authority characters");
  }
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("AI provider endpoint must use HTTPS");
  // Match the production preflight: port zero is a bind sentinel, not a reachable provider endpoint.
  if (url.port === "0") throw new Error("AI provider endpoint must not use port 0");
  if (url.username || url.password) throw new Error("AI provider endpoint must not include credentials");
  if (value.includes("#") || url.hash) throw new Error("AI provider endpoint must not include a fragment");
  if (value.includes("?") || url.search) throw new Error("AI provider endpoint must not include query parameters");
  const host = normalizedHostname(url);
  if (host === "localhost" || host.endsWith(".localhost") ||
      host === "local" || host.endsWith(".local") ||
      host === "localdomain" || host.endsWith(".localdomain")) throw new Error("Local AI provider endpoints are not allowed in production");
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) throw new Error("Private-network AI provider endpoints are not allowed");
  return url;
}

export async function assertSafeProviderDnsResolution(url: URL, signal?: AbortSignal): Promise<string[]> {
  return resolvePublicProviderAddresses(url, signal);
}

export async function assertStableProviderDnsResolution(url: URL, approvedAddresses: readonly string[], signal?: AbortSignal): Promise<void> {
  if (approvedAddresses.length === 0) throw new Error("AI provider DNS approval set is empty");
  const current = await resolvePublicProviderAddresses(url, signal);
  const approved = [...new Set(approvedAddresses.map((address) => address.toLowerCase()))].sort();
  if (current.length !== approved.length || current.some((address, index) => address !== approved[index])) {
    throw new Error("AI provider DNS resolution changed during request validation");
  }
}
