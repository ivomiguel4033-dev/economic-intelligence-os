import type { BoardOpinion, BoardVerdict } from "@/ai/ai-board";

function validConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateBoardOpinion(value: BoardOpinion): BoardOpinion {
  if (!value.recommendation?.trim() || !value.reasoning?.trim()) throw new Error("Invalid AI Board opinion");
  if (!Array.isArray(value.risks)) throw new Error("Invalid AI Board risks");
  if (!validConfidence(value.confidence)) throw new Error("Invalid AI Board confidence");
  return value;
}

export function validateBoardVerdict(value: BoardVerdict): BoardVerdict {
  if (!value.synthesis?.trim()) throw new Error("Invalid AI Board synthesis");
  if (!Array.isArray(value.dissent)) throw new Error("Invalid AI Board dissent");
  if (!validConfidence(value.confidence)) throw new Error("Invalid AI Board confidence");
  value.opinions.forEach(validateBoardOpinion);
  return value;
}
