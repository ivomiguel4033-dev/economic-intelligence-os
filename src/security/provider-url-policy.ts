import { lookup } from "node:dns/promises";

const PROVIDER_DNS_TIMEOUT_MS = 5_000;

function normalizedHostname(url: URL): string {
  const rawHost = url.hostname.toLowerCase();
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;

  // DNS names with a trailing root label are equivalent to their non-dotted
  // form (for example localhost. -> localhost). Canonicalize them before
  // applying local/private host policy so an absolute DNS spelling cannot
  // bypass the production SSRF guard.
  return host.replace(/\.+$/, "");
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;

  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;

  const [first, second, third] = octets;

  // Provider endpoints must be globally routable. Reject special-use IPv4
  // space as well as RFC1918 ranges so SSRF cannot reach loopback, link-local,
  // carrier-grade NAT, protocol-assignment, documentation, benchmarking,
  // multicast, or reserved destinations.
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPrivateIpv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;

  // Reject special-use IPv6 prefixes that are not suitable as globally
  // reachable production provider destinations: discard-only, benchmarking,
  // documentation, multicast, and the original documentation allocation.
  if (
    /^100:0*:/i.test(host) ||
    /^2001:0*2:/i.test(host) ||
    /^2001:db8:/i.test(host) ||
    /^3fff:/i.test(host) ||
    /^ff[0-9a-f]{2}:/i.test(host)
  ) {
    return true;
  }

  // URL parsers may canonicalize IPv4-mapped IPv6 addresses into hexadecimal
  // form (for example ::ffff:127.0.0.1 -> ::ffff:7f00:1). Treat the entire
  // IPv4-mapped range as unsafe rather than relying on dotted-decimal parsing.
  if (/^::ffff:/i.test(host)) return true;

  return false;
}

function isUnsafeResolvedAddress(address: string): boolean {
  return isPrivateIpv4(address) || isPrivateIpv6(address);
}

function canonicalAddressSet(addresses: Array<{ address: string }>): string[] {
  return [...new Set(addresses.map(({ address }) => address.toLowerCase()))].sort();
}

async function lookupWithTimeout(host: string): Promise<Array<{ address: string }>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("AI provider DNS resolution timed out")), PROVIDER_DNS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function resolvePublicProviderAddresses(url: URL): Promise<string[]> {
  const host = normalizedHostname(url);
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error("Private-network AI provider endpoints are not allowed");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupWithTimeout(host);
  } catch {
    throw new Error("AI provider hostname could not be resolved safely");
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isUnsafeResolvedAddress(address))) {
    throw new Error("AI provider hostname resolved to a non-public address");
  }
  return canonicalAddressSet(addresses);
}

export function assertSafeProviderUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("AI provider endpoint must use HTTPS");
  if (url.username || url.password) throw new Error("AI provider endpoint must not include credentials");
  if (url.hash) throw new Error("AI provider endpoint must not include a fragment");
  if (url.search) throw new Error("AI provider endpoint must not include query parameters");

  const host = normalizedHostname(url);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local AI provider endpoints are not allowed in production");
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error("Private-network AI provider endpoints are not allowed");
  }
  return url;
}

export async function assertSafeProviderDnsResolution(url: URL): Promise<string[]> {
  // Return the approved address set so callers can revalidate it immediately
  // before transport hand-off. This narrows the DNS-rebinding/TOCTOU window and
  // fails closed if a hostname changes between security checks.
  return resolvePublicProviderAddresses(url);
}

export async function assertStableProviderDnsResolution(url: URL, approvedAddresses: readonly string[]): Promise<void> {
  if (approvedAddresses.length === 0) throw new Error("AI provider DNS approval set is empty");
  const current = await resolvePublicProviderAddresses(url);
  const approved = [...new Set(approvedAddresses.map((address) => address.toLowerCase()))].sort();
  if (current.length !== approved.length || current.some((address, index) => address !== approved[index])) {
    throw new Error("AI provider DNS resolution changed during request validation");
  }
}
