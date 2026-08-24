export interface ConfidenceSignals {
  modelAgreement: number;
  evidenceCoverage: number;
  evidenceQuality: number;
  historicalAccuracy?: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function calibratedConfidence(signals: ConfidenceSignals): number {
  const agreement = clamp(signals.modelAgreement);
  const coverage = clamp(signals.evidenceCoverage);
  const quality = clamp(signals.evidenceQuality);
  const history = clamp(signals.historicalAccuracy ?? 0.5);
  return agreement * 0.3 + coverage * 0.25 + quality * 0.3 + history * 0.15;
}

export function uncertaintyLabel(confidence: number): "very-low" | "low" | "medium" | "high" {
  const c = clamp(confidence);
  if (c >= 0.85) return "very-low";
  if (c >= 0.7) return "low";
  if (c >= 0.5) return "medium";
  return "high";
}
