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
      const body = Readable.toWeb(response) as ReadableStream<Uint8Array>;
      resolve(new Response(body, {
        status: response.statusCode ?? 502,
        statusText: response.statusMessage,
        headers,
      }));
    });

    request.once("error", reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  }).finally(() => agent.destroy());
}
