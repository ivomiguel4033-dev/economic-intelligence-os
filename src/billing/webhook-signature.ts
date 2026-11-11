import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_STRIPE_SIGNATURE_HEADER_BYTES = 4_096;
const MAX_STRIPE_SIGNATURE_PARTS = 32;
const SHA256_HEX_LENGTH = 64;

function parseStripeSignatureHeader(header: string): { timestamp: number; signatures: string[] } | null {
  if (!header || Buffer.byteLength(header, "utf8") > MAX_STRIPE_SIGNATURE_HEADER_BYTES) return null;

  const parts = header.split(",");
  if (parts.length > MAX_STRIPE_SIGNATURE_PARTS) return null;

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === "t") {
      if (!/^\d+$/.test(value)) return null;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
      if (timestamp !== null && timestamp !== parsed) return null;
      timestamp = parsed;
    } else if (key === "v1" && /^[a-fA-F0-9]{64}$/.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function verifyStripeSignature(payload: string, header: string, secret: string, toleranceSeconds = 300): boolean {
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) return false;

  const parsed = parseStripeSignatureHeader(header);
  if (!parsed) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${parsed.timestamp}.${payload}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return parsed.signatures.some((signature) => {
    const candidate = Buffer.from(signature, "hex");
    return candidate.length === expectedBuffer.length &&
      candidate.length === SHA256_HEX_LENGTH / 2 &&
      timingSafeEqual(candidate, expectedBuffer);
  });
}
