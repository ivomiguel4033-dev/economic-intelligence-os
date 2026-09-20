import { Agent, request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

export interface PinnedHttpsRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

function selectPinnedAddress(approvedAddresses: readonly string[]): { address: string; family: 4 | 6 } {
  for (const address of approvedAddresses) {
    const family = isIP(address);
    if (family === 4 || family === 6) return { address, family };
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
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else {
          headers.set(name, value);
        }
      }
      const status = response.statusCode ?? 502;
      const mayHaveBody = responseMayHaveBody(init.method, status);
      const body = mayHaveBody
        ? Readable.toWeb(response) as ReadableStream<Uint8Array>
        : null;

      // A null Fetch Response body does not consume the Node IncomingMessage.
      // Drain it explicitly so malformed/upstream body bytes cannot leave the
      // pinned socket and agent resources hanging until timeout.
      if (!mayHaveBody) response.resume();

      resolve(new Response(body, {
        status,
        statusText: response.statusMessage,
        headers,
      }));
    });

    request.once("error", reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}
