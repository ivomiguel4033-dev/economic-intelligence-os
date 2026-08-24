export interface EvidenceReference {
  sourceId: string;
  chunkId?: string;
  uri?: string;
  title: string;
  capturedAt?: string;
  publishedAt?: string;
  authorityScore?: number;
}

export interface SupportedClaim {
  claim: string;
  evidence: EvidenceReference[];
  confidence: number;
  status: "supported" | "conflicted" | "insufficient";
}

export function assessClaim(claim: SupportedClaim): SupportedClaim {
  if (!claim.claim.trim()) throw new Error("Claim is required");
  if (claim.confidence < 0 || claim.confidence > 1) throw new Error("Confidence must be between 0 and 1");
  if (claim.status === "supported" && claim.evidence.length === 0) {
    return { ...claim, status: "insufficient", confidence: Math.min(claim.confidence, 0.49) };
  }
  return claim;
}
