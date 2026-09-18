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

  // URL parsers may canonicalize IPv4-mapped IPv6 addresses into hexadecimal
  // form (for example ::ffff:127.0.0.1 -> ::ffff:7f00:1). Treat the entire
  // IPv4-mapped range as unsafe rather than relying on dotted-decimal parsing.
  if (/^::ffff:/i.test(host)) return true;

  return false;
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
