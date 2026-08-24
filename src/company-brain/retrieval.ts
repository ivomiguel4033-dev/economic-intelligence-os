import type { BrainHit, BrainQuery } from "@/company-brain/types";

export interface KnowledgeRetriever {
  retrieve(query: BrainQuery): Promise<BrainHit[]>;
}

export interface RetrievalSignal {
  semantic: number;
  lexical: number;
  recency: number;
  authority: number;
}

export function rankEvidence(signal: RetrievalSignal): number {
  const semantic = Math.max(0, Math.min(1, signal.semantic));
  const lexical = Math.max(0, Math.min(1, signal.lexical));
  const recency = Math.max(0, Math.min(1, signal.recency));
  const authority = Math.max(0, Math.min(1, signal.authority));
  return semantic * 0.45 + lexical * 0.2 + recency * 0.15 + authority * 0.2;
}

export function enforceTenantHits(hits: BrainHit[], organizationId: string): BrainHit[] {
  return hits.filter(
    (hit) => hit.chunk.organizationId === organizationId && hit.source.organizationId === organizationId,
  );
}
