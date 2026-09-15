import { randomUUID } from "node:crypto";

export function requestId(headers: Headers): string {
  const supplied = headers.get("x-request-id")?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  return randomUUID();
}
