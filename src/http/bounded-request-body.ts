export type BoundedPayloadResult =
  | { status: "ok"; payload: string }
  | { status: "too_large" }
  | { status: "timeout" };

export function declaredPayloadTooLarge(request: Request, maxBytes: number): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;
  if (!/^\d+$/.test(contentLength)) return true;
  const bytes = Number(contentLength);
  return !Number.isSafeInteger(bytes) || bytes > maxBytes;
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason: string): void {
  void reader.cancel(reason).catch(() => undefined);
}

export async function readBoundedPayload(
  request: Request,
  maxBytes: number,
  timeoutMs: number,
): Promise<BoundedPayloadResult> {
  if (!request.body) return { status: "ok", payload: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const deadline = Date.now() + timeoutMs;

  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        cancelReader(reader, "Request payload read timed out");
        return { status: "timeout" };
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read().then((value) => ({ kind: "read" as const, value })),
        new Promise<{ kind: "timeout" }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "timeout" }), remainingMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });

      if (result.kind === "timeout") {
        cancelReader(reader, "Request payload read timed out");
        return { status: "timeout" };
      }

      const { done, value } = result.value;
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        cancelReader(reader, "Request payload exceeds limit");
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { status: "ok", payload: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { status: "ok", payload: "" };
  }
}
