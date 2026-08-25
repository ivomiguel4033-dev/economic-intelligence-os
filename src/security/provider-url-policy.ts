export function assertSafeProviderUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("AI provider endpoint must use HTTPS");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    throw new Error("Local AI provider endpoints are not allowed in production");
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)) {
    throw new Error("Private-network AI provider endpoints are not allowed");
  }
  return url;
}
