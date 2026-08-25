import { createHash } from "node:crypto";

export function executionIdempotencyKey(input: {
  organizationId: string;
  actionId: string;
  actionType: string;
}): string {
  return createHash("sha256")
    .update(`${input.organizationId}:${input.actionId}:${input.actionType}`)
    .digest("hex");
}

export interface IdempotencyStore<T> {
  get(key: string): Promise<T | undefined>;
  putIfAbsent(key: string, value: T): Promise<boolean>;
}
