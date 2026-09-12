function normalizedHostname(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isPrivateIpv4(host: string): boolean {
  return /^10\./.test(host) || /^127\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) || host === "0.0.0.0";
}

function isPrivateIpv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;

  const mappedIpv4 = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

export function assertSafeProviderUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("AI provider endpoint must use HTTPS");
  if (url.username || url.password) throw new Error("AI provider endpoint must not include credentials");
  if (url.hash) throw new Error("AI provider endpoint must not include a fragment");

  const host = normalizedHostname(url);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local AI provider endpoints are not allowed in production");
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error("Private-network AI provider endpoints are not allowed");
  }
  return url;
}
