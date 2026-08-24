export type SafetyCategory = "self-harm" | "violence" | "illegal" | "none";

export interface SafetyAssessment {
  category: SafetyCategory;
  highRisk: boolean;
  allowNormalResponse: boolean;
  guidance?: string;
}

const SELF_HARM_PATTERNS = [
  /kill myself/i,
  /suicide/i,
  /end my life/i,
  /matar[- ]?me/i,
  /suic[ií]dio/i,
];

export function assessHighRiskContent(input: string): SafetyAssessment {
  if (SELF_HARM_PATTERNS.some((pattern) => pattern.test(input))) {
    return {
      category: "self-harm",
      highRisk: true,
      allowNormalResponse: false,
      guidance: "Route to the dedicated supportive safety response. Do not provide methods, optimization, instructions or lethal details. Encourage immediate human support when danger appears imminent.",
    };
  }

  return { category: "none", highRisk: false, allowNormalResponse: true };
}
