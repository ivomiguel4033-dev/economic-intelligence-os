export interface LoginRiskSignals {
  failedAttempts: number;
  newDevice: boolean;
  impossibleTravel: boolean;
  credentialRecentlyChanged: boolean;
  privilegedAction: boolean;
}

export interface LoginRiskAssessment {
  score: number;
  action: "allow" | "step-up" | "block";
  reasons: string[];
}

export function assessLoginRisk(signals: LoginRiskSignals): LoginRiskAssessment {
  let score = 0;
  const reasons: string[] = [];
  if (signals.failedAttempts >= 5) { score += 0.35; reasons.push("repeated authentication failures"); }
  if (signals.newDevice) { score += 0.15; reasons.push("new device"); }
  if (signals.impossibleTravel) { score += 0.45; reasons.push("impossible travel"); }
  if (signals.credentialRecentlyChanged) { score += 0.15; reasons.push("recent credential change"); }
  if (signals.privilegedAction) { score += 0.15; reasons.push("privileged action"); }
  score = Math.min(1, score);
  return { score, action: score >= 0.7 ? "block" : score >= 0.3 ? "step-up" : "allow", reasons };
}
