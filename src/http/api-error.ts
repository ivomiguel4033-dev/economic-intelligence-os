import { NextResponse } from "next/server";

export type ApiErrorCode = "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "INTERNAL_ERROR" | "SERVICE_UNAVAILABLE";

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function apiError(code: ApiErrorCode, message: string, requestId?: string, details?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, requestId, details } }, { status: STATUS[code] });
}
