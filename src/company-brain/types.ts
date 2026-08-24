export type KnowledgeSourceType = "document" | "email" | "calendar" | "crm" | "database" | "web" | "manual";

export interface KnowledgeSource {
  id: string;
  organizationId: string;
  type: KnowledgeSourceType;
  title: string;
  externalRef?: string;
  uri?: string;
  metadata: Record<string, unknown>;
  contentHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  organizationId: string;
  sourceId: string;
  ordinal: number;
  content: string;
  metadata: Record<string, unknown>;
}

export interface BrainQuery {
  organizationId: string;
  query: string;
  limit?: number;
}

export interface BrainHit {
  chunk: KnowledgeChunk;
  source: KnowledgeSource;
  score: number;
  reasons: string[];
}
