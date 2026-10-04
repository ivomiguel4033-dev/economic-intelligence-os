import { Agent, request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { assertSafeProviderAddress } from "@/security/provider-url-policy";

const MAX_PROVIDER_RESPONSE_HEADER_BYTES = 32 * 1024;
const MAX_PROVIDER_RESPONSE_HEADERS = 128;
const MAX_PROVIDER_REQUEST_HEADERS = 64;
const MAX_PROVIDER_REQUEST_HEADER_BYTES = 16 * 1024;
const MAX_APPROVED_PROVIDER_ADDRESSES = 32;

export interface PinnedHttpsRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

function selectPinnedAddress(approvedAddresses: readonly string[]): { address: string; family: 4 | 6 } {
  if (approvedAddresses.length > MAX_APPROVED_PROVIDER_ADDRESSES) {
    throw new Error("AI provider DNS approval set exceeds address limit");
  }
  for (const address of approvedAddresses) {
    const family = isIP(address);
    if (family !== 4 && family !== 6) continue;
    assertSafeProviderAddress(address);
    return { address, family };
  }
  throw new Error("AI provider DNS approval set contains no usable IP address");
}

function responseMayHaveBody(method: string, status: number): boolean {
  if (method.toUpperCase() === "HEAD") return false;
  return status !== 204 && status !== 205 && status !== 304;
}

/**
 * HTTPS transport that binds the TCP connection to an IP address from the
 * previously approved DNS set while preserving the original hostname for
 * HTTP Host, TLS SNI and certificate verification.
 *
 * Redirects are deliberately unsupported: callers must validate a new URL and
 * DNS set before following any redirect.
 */
export async function pinnedHttpsFetch(
  url: URL,
  init: PinnedHttpsRequestInit,
  approvedAddresses: readonly string[],
): Promise<Response> {
  if (url.protocol !== "https:") throw new Error("Pinned provider transport requires HTTPS");
  if (url.username || url.password || url.hash || url.search) {
    throw new Error("Pinned provider transport forbids URL credentials, query parameters and fragments");
  }
  const method = init.method.toUpperCase();
  const allowedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
  if (!allowedMethods.has(method)) {
    throw new Error(`Pinned provider transport forbids HTTP method ${method}`);
  }
  const requestHeaderEntries = Object.entries(init.headers);
  if (requestHeaderEntries.length > MAX_PROVIDER_REQUEST_HEADERS) {
    throw new Error("Pinned provider transport request header count exceeds limit");
  }
  const requestHeaderBytes = requestHeaderEntries.reduce(
    (total, [name, value]) => total + Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8") + 4,
    0,
  );
  if (requestHeaderBytes > MAX_PROVIDER_REQUEST_HEADER_BYTES) {
    throw new Error("Pinned provider transport request headers exceed size limit");
  }
  const forbiddenRequestHeaders = new Set(["host", "connection", "content-length", "transfer-encoding", "upgrade", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer"]);
  const validHeaderName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
  for (const [name, value] of requestHeaderEntries) {
    if (!validHeaderName.test(name) || /[\r\n\0]/.test(value)) {
      throw new Error(`Pinned provider transport rejects invalid HTTP header ${name}`);
    }
    if (forbiddenRequestHeaders.has(name.toLowerCase())) {
      throw new Error(`Pinned provider transport forbids caller-controlled HTTP header ${name}`);
    }
  }
  const pinned = selectPinnedAddress(approvedAddresses);

  const agent = new Agent({
    keepAlive: false,
    lookup: (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: pinned.address, family: pinned.family }]);
        return;
      }
      callback(null, pinned.address, pinned.family);
    },
  });

  // Do not destroy the agent when the response headers arrive. The returned
  // Response body is streamed and the caller still needs the active socket to
  // consume it. keepAlive=false ensures the socket is not reused after EOF.
  return await new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: init.method,
      headers: init.headers,
      agent,
      signal: init.signal,
      servername: url.hostname,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      maxHeaderSize: MAX_PROVIDER_RESPONSE_HEADER_BYTES,
    }, (response) => {
      // Never expose hop-by-hop response metadata beyond this transport. In
      // addition to the standard names, Connection may nominate arbitrary
      // headers that apply only to this single pinned connection.
      const forbiddenResponseHeaders = new Set([
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "proxy-connection",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
      ]);
      for (const token of response.headers.connection?.split(",") ?? []) {
        const name = token.trim().toLowerCase();
        if (name) forbiddenResponseHeaders.add(name);
      }

      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined || forbiddenResponseHeaders.has(name.toLowerCase())) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else {
          headers.set(name, value);
        }
      }
      const status = response.statusCode ?? 502;
      if (status < 200 || status > 599) {
        response.destroy();
        reject(new Error(`AI provider returned invalid HTTP status ${status}`));
        return;
      }
      const mayHaveBody = responseMayHaveBody(init.method, status);
      const body = mayHaveBody
        ? Readable.toWeb(response) as ReadableStream<Uint8Array>
        : null;

      // A null Fetch Response body does not consume the Node IncomingMessage.
      // Drain it explicitly so malformed/upstream body bytes cannot leave the
      // pinned socket and agent resources hanging until timeout.
      if (!mayHaveBody) response.resume();

      // Do not forward the upstream reason phrase into the Fetch Response.
      // It is not used by provider logic and keeping parser-controlled text
      // out of the Web Response avoids an unnecessary constructor boundary.
      resolve(new Response(body, {
        status,
        headers,
      }));
    });

    // A 101 response transfers ownership of the socket out of Node's HTTP
    // parser and does not enter the normal response callback. Providers are
    // never allowed to upgrade protocols, so fail closed and release the
    // pinned socket immediately instead of leaving the request unresolved.
    // Bound response header cardinality as well as aggregate bytes. This keeps
    // a malicious upstream from creating excessive header entries within the
    // byte budget.
    request.maxHeadersCount = MAX_PROVIDER_RESPONSE_HEADERS;

    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new Error("AI provider protocol upgrades are not supported"));
    });

    // CONNECT responses also detach the socket from the HTTP parser and skip
    // the normal response callback. Provider transport must never become a
    // tunnel, even if a future caller accidentally supplies CONNECT.
    request.once("connect", (_response, socket) => {
      socket.destroy();
      reject(new Error("AI provider CONNECT tunnels are not supported"));
    });

    request.once("error", reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}
