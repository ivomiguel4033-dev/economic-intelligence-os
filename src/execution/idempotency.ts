import { createHash } from "node:crypto";

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

function canonicalIdempotencyComponent(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid idempotency ${field}`);
  if (value.length === 0 || value !== value.trim()) throw new Error(`Invalid idempotency ${field}`);
  if (value.length > 256 || CONTROL_CHARACTERS.test(value)) throw new Error(`Invalid idempotency ${field}`);
  if (value.includes(":")) throw new Error(`Invalid idempotency ${field}: reserved separator`);
  return value;
}

export function executionIdempotencyKey(input: {
  organizationId: string;
  actionId: string;
  actionType: string;
}): string {
  const organizationId = canonicalIdempotencyComponent(input.organizationId, "organizationId");
  const actionId = canonicalIdempotencyComponent(input.actionId, "actionId");
  const actionType = canonicalIdempotencyComponent(input.actionType, "actionType");

  return createHash("sha256")
    .update(`${organizationId}:${actionId}:${actionType}`)
    .digest("hex");
}

export interface IdempotencyStore<T> {
  get(key: string): Promise<T | undefined>;
  putIfAbsent(key: string, value: T): Promise<boolean>;
}
