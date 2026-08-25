export interface FactualityClaim {
  text: string;
  supported: boolean;
  contradicted: boolean;
  evidenceCount: number;
  confidence: number;
}

export interface FactualityReport {
  score: number;
  unsupportedClaims: number;
  contradictedClaims: number;
  lowEvidenceClaims: number;
}

export function scoreFactuality(claims: FactualityClaim[]): FactualityReport {
  if (!claims.length) return { score: 1, unsupportedClaims: 0, contradictedClaims: 0, lowEvidenceClaims: 0 };
  let penalty = 0;
  let unsupportedClaims = 0;
  let contradictedClaims = 0;
  let lowEvidenceClaims = 0;
  for (const claim of claims) {
    if (!claim.supported) { unsupportedClaims++; penalty += 0.25; }
    if (claim.contradicted) { contradictedClaims++; penalty += 0.5; }
    if (claim.evidenceCount === 0 && claim.confidence >= 0.7) { lowEvidenceClaims++; penalty += 0.2; }
  }
  return {
    score: Math.max(0, 1 - penalty / claims.length),
    unsupportedClaims,
    contradictedClaims,
    lowEvidenceClaims,
  };
}
