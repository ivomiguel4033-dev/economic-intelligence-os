import type { BoardOpinion, BoardRole, BoardVerdict } from "@/ai/ai-board";

const BOARD_ROLES = new Set<BoardRole>(["strategist", "risk", "finance", "operator", "critic"]);
const MAX_RECOMMENDATION_CHARS = 16_000;
const MAX_REASONING_CHARS = 64_000;
const MAX_SYNTHESIS_CHARS = 64_000;
const MAX_LIST_ITEMS = 64;
const MAX_LIST_ITEM_CHARS = 8_000;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid AI Board ${label}`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== "string") throw new Error(`Invalid AI Board ${label}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxChars) throw new Error(`Invalid AI Board ${label}`);
  return normalized;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new Error(`Invalid AI Board ${label}`);
  }
  return value.map((entry) => boundedString(entry, label, MAX_LIST_ITEM_CHARS));
}

function confidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Invalid AI Board confidence");
  }
  return value;
}

function role(value: unknown): BoardRole {
  if (typeof value !== "string" || !BOARD_ROLES.has(value as BoardRole)) {
    throw new Error("Invalid AI Board role");
  }
  return value as BoardRole;
}

export function validateBoardOpinion(value: unknown, expectedRole?: BoardRole): BoardOpinion {
  const candidate = asRecord(value, "opinion");
  return {
    role: expectedRole ?? role(candidate.role),
    recommendation: boundedString(candidate.recommendation, "recommendation", MAX_RECOMMENDATION_CHARS),
    reasoning: boundedString(candidate.reasoning, "reasoning", MAX_REASONING_CHARS),
    risks: stringList(candidate.risks, "risks"),
    confidence: confidence(candidate.confidence),
  };
}

export function validateBoardSynthesis(
  value: unknown,
): Pick<BoardVerdict, "synthesis" | "dissent" | "confidence"> {
  const candidate = asRecord(value, "synthesis");
  return {
    synthesis: boundedString(candidate.synthesis, "synthesis", MAX_SYNTHESIS_CHARS),
    dissent: stringList(candidate.dissent, "dissent"),
    confidence: confidence(candidate.confidence),
  };
}

export function validateBoardVerdict(value: unknown): BoardVerdict {
  const candidate = asRecord(value, "verdict");
  if (!Array.isArray(candidate.opinions) || candidate.opinions.length === 0 || candidate.opinions.length > 5) {
    throw new Error("Invalid AI Board opinions");
  }
  const opinions = candidate.opinions.map((opinion) => validateBoardOpinion(opinion));
  if (new Set(opinions.map((opinion) => opinion.role)).size !== opinions.length) {
    throw new Error("Invalid AI Board roles");
  }
  const synthesis = validateBoardSynthesis(candidate);

  return {
    decisionId: boundedString(candidate.decisionId, "decisionId", 256),
    opinions,
    synthesis: synthesis.synthesis,
    dissent: synthesis.dissent,
    confidence: synthesis.confidence,
    generatedAt: boundedString(candidate.generatedAt, "generatedAt", 128),
  };
}
