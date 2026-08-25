import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyStripeSignature(payload: string, header: string, secret: string, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((item) => item.split("=", 2)));
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
